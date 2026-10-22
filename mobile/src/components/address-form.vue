<script setup lang="ts">
/**
 * 收货地址表单（移动端）
 * 智能识别 + picker 三级联动 + 字段级校验
 */
import { ref, reactive, computed, watch, watchEffect } from 'vue';
import regionTree from '@/data/regions.json';
import { parseAddress, validateAddress, type RegionTree } from '@/utils/address';

const regions = regionTree as unknown as RegionTree;

const props = defineProps<{
  saving?: boolean;
  initial?: { name: string; phone: string; region: string; detail: string } | null;
  showCancel?: boolean;
}>();

const emit = defineEmits<{
  (e: 'submit', payload: { name: string; phone: string; region: string; detail: string }): void;
  (e: 'cancel'): void;
  (e: 'update:valid', valid: boolean): void;
  (e: 'update:payload', payload: { name: string; phone: string; region: string; detail: string } | null): void;
}>();

const paste = ref('');
const hint = ref('');
const hintType = ref<'ok' | 'warn' | ''>('');
const touched = reactive<Record<string, boolean>>({});

const form = reactive({ name: '', phone: '', province: '', city: '', district: '', detail: '' });

if (props.initial) {
  const parts = String(props.initial.region || '').split(/\s+/).filter(Boolean);
  form.name = props.initial.name;
  form.phone = props.initial.phone;
  form.detail = props.initial.detail;
  form.province = parts[0] || '';
  form.city = parts[1] || parts[0] || '';
  form.district = parts[2] || '';
}

const provinceList = Object.keys(regions);
const cities = ref<string[]>(form.province ? Object.keys(regions[form.province] || {}) : []);
const districts = ref<string[]>(form.city ? regions[form.province]?.[form.city] || [] : []);

// picker 三列：省 / 市 / 区
const cascadeRange = computed(() => [provinceList, cities.value, districts.value]);
const cascadeIndex = computed(() => [
  Math.max(0, provinceList.indexOf(form.province)),
  Math.max(0, cities.value.indexOf(form.city)),
  Math.max(0, districts.value.indexOf(form.district)),
]);

function onColumnChange(e: any) {
  const { column, value } = e.detail;
  if (column === 0) {
    const p = provinceList[value];
    cities.value = Object.keys(regions[p] || {});
    districts.value = regions[p]?.[cities.value[0]] || [];
  } else if (column === 1) {
    districts.value = regions[form.province]?.[cities.value[value]] || [];
  }
}

function onCascadeChange(e: any) {
  const [pi, ci, di] = e.detail.value as number[];
  const p = provinceList[pi];
  if (!p) return;
  const cityList = Object.keys(regions[p] || {});
  const c = cityList[ci] || cityList[0] || '';
  const d = (regions[p]?.[c] || [])[di] || '';
  form.province = p;
  form.city = c;
  form.district = d;
  cities.value = cityList;
  districts.value = regions[p]?.[c] || [];
  touched.province = true;
}

const region = computed(() => {
  const city = form.city && form.city !== form.province ? form.city : '';
  return [form.province, city, form.district].filter(Boolean).join(' ');
});

const errors = computed(() => validateAddress(form));

const valid = computed(() => Object.keys(errors.value).length === 0);
const showError = (f: string) => touched[f] && errors.value[f];

watch(valid, (v) => emit('update:valid', v), { immediate: true });
watchEffect(() => {
  emit('update:payload', valid.value
    ? { name: form.name.trim(), phone: form.phone.trim(), region: region.value, detail: form.detail.trim() }
    : null);
});

function smartFill() {
  const raw = paste.value.trim();
  if (!raw) {
    hint.value = '先粘贴一段地址，例如：张三 13800138000 北京市朝阳区建国路 88 号';
    hintType.value = 'warn';
    return;
  }
  const r = parseAddress(raw, regions);
  if (r.name) form.name = r.name;
  if (r.phone) form.phone = r.phone;
  if (r.province && regions[r.province]) {
    form.province = r.province;
    const cityList = Object.keys(regions[r.province] || {});
    form.city = r.city && cityList.includes(r.city) ? r.city : cityList[0] || '';
    cities.value = cityList;
    const districtList = regions[r.province]?.[form.city] || [];
    form.district = r.district && districtList.includes(r.district) ? r.district : '';
    districts.value = districtList;
  }
  if (r.detail) form.detail = r.detail;

  ['name', 'phone', 'province', 'city', 'district', 'detail'].forEach((k) => { touched[k] = true; });

  if (r.missing.length) {
    hint.value = `已识别，但${r.missing.join('、')}需要手动补全`;
    hintType.value = 'warn';
  } else {
    hint.value = '已自动填好，请核对后保存';
    hintType.value = 'ok';
  }
}

function submit() {
  Object.keys(errors.value).forEach((k) => { touched[k] = true; });
  if (!valid.value) {
    hint.value = '还有必填项未完成';
    hintType.value = 'warn';
    return;
  }
  emit('submit', {
    name: form.name.trim(),
    phone: form.phone.trim(),
    region: region.value,
    detail: form.detail.trim(),
  });
}

defineExpose({
  reset() {
    form.name = ''; form.phone = ''; form.province = ''; form.city = ''; form.district = ''; form.detail = '';
    cities.value = []; districts.value = [];
    paste.value = ''; hint.value = ''; hintType.value = '';
    Object.keys(touched).forEach((k) => { delete touched[k]; });
  },
});
</script>

<template>
  <view class="af">
    <!-- 智能识别 -->
    <view class="smart">
      <view class="smart-head">
        <text class="smart-title">✨ 智能识别</text>
        <text class="smart-tip">整段粘贴，自动拆分</text>
      </view>
      <textarea
        v-model="paste"
        class="textarea smart-input"
        maxlength="300"
        placeholder="例：张三 13800138000 北京市朝阳区建国路 88 号 1 单元 1203"
        @input="hint = ''"
      />
      <view class="btn btn-ghost btn-sm" @tap="smartFill">自动拆分填入 ↓</view>
      <text v-if="hint" class="hint" :class="hintType">{{ hint }}</text>
    </view>

    <view class="field">
      <text class="label">收件人 <text class="req">*</text></text>
      <input
        v-model="form.name" class="input" :class="{ bad: showError('name') }"
        placeholder="姓名" maxlength="30" @blur="touched.name = true"
      />
      <text v-if="showError('name')" class="err">{{ errors.name }}</text>
    </view>

    <view class="field">
      <text class="label">手机号 <text class="req">*</text></text>
      <input
        v-model="form.phone" class="input" :class="{ bad: showError('phone') }"
        type="number" placeholder="11 位手机号" maxlength="11" @blur="touched.phone = true"
      />
      <text v-if="showError('phone')" class="err">{{ errors.phone }}</text>
    </view>

    <view class="field">
      <text class="label">所在地区 <text class="req">*</text></text>
      <picker
        mode="multiSelector"
        :range="cascadeRange"
        :value="cascadeIndex"
        @columnchange="onColumnChange"
        @change="onCascadeChange"
      >
        <view class="input picker" :class="{ bad: showError('province') || showError('city') || showError('district'), empty: !region }">
          {{ region || '请选择省 / 市 / 区' }}
          <text class="arrow">›</text>
        </view>
      </picker>
      <text v-if="showError('province') || showError('city') || showError('district')" class="err">
        {{ errors.province || errors.city || errors.district }}
      </text>
    </view>

    <view class="field">
      <text class="label">详细地址 <text class="req">*</text></text>
      <textarea
        v-model="form.detail" class="textarea" :class="{ bad: showError('detail') }"
        maxlength="200" placeholder="街道、门牌号、楼栋单元房间"
        @blur="touched.detail = true"
      />
      <text v-if="showError('detail')" class="err">{{ errors.detail }}</text>
    </view>

    <view class="actions">
      <view class="btn btn-primary btn-sm grow" :class="{ dis: props.saving }" @tap="submit">
        {{ props.saving ? '保存中…' : '保存地址' }}
      </view>
      <view v-if="props.showCancel" class="btn btn-ghost btn-sm grow" @tap="emit('cancel')">取消</view>
    </view>
    <text v-if="!valid" class="tip">* 为必填项</text>
  </view>
</template>

<style scoped>
.af { display: flex; flex-direction: column; gap: 18rpx; margin-top: 16rpx; }

.smart {
  padding: 20rpx;
  border: 1rpx dashed #d7dbe5;
  border-radius: 14rpx;
  background: #f9fafc;
}
.smart-head { display: flex; align-items: baseline; gap: 12rpx; margin-bottom: 12rpx; }
.smart-title { font-size: 24rpx; font-weight: 600; color: #2b3242; }
.smart-tip { font-size: 20rpx; color: #8d94a6; }
.smart-input { height: 120rpx; margin-bottom: 12rpx; }
.hint { display: block; font-size: 20rpx; margin-top: 10rpx; line-height: 1.5; color: #8d94a6; }
.hint.ok { color: #1a7f37; }
.hint.warn { color: #b45309; }

.field { display: flex; flex-direction: column; gap: 10rpx; }
.label { font-size: 22rpx; color: #5a6072; }
.req { color: #d93025; }
.input {
  height: 84rpx; background: #f7f8fa; border: 1rpx solid #e4e7ee;
  border-radius: 14rpx; padding: 0 20rpx; font-size: 26rpx; box-sizing: border-box;
}
.textarea {
  width: 100%; height: 140rpx; background: #f7f8fa; border: 1rpx solid #e4e7ee;
  border-radius: 14rpx; padding: 16rpx 20rpx; font-size: 26rpx; box-sizing: border-box;
}
.input.bad, .textarea.bad { border-color: #d93025; background: #fff6f5; }

.picker { display: flex; align-items: center; justify-content: space-between; line-height: 84rpx; }
.picker.empty { color: #b3b9c7; }
.arrow { color: #b3b9c7; font-size: 30rpx; }

.err { font-size: 20rpx; color: #d93025; line-height: 1.5; }
.tip { font-size: 20rpx; color: #8d94a6; }

.actions { display: flex; gap: 16rpx; margin-top: 4rpx; }
.grow { flex: 1; }
.btn.dis { opacity: 0.55; }
</style>
