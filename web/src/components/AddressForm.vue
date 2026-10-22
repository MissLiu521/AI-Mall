<script setup lang="ts">
/**
 * 收货地址表单：智能识别 + 省市区级联 + 字段级校验
 * 只负责收集与校验，落库由父组件调用 API 完成，便于在结算页 / 地址管理页复用。
 */
import { reactive, ref, computed, watch, watchEffect } from 'vue';
import regionTree from '../data/regions.json';
import { parseAddress, validateAddress, type RegionTree } from '../utils/address';

const regions = regionTree as unknown as RegionTree;

const props = defineProps<{
  saving?: boolean;
  /** 编辑模式传入已有地址 */
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

// 编辑模式：把 "广东省 深圳市 南山区" 拆回三级
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
const cityList = computed(() => (form.province ? Object.keys(regions[form.province] || {}) : []));
const districtList = computed(() =>
  form.province && form.city ? regions[form.province]?.[form.city] || [] : []);

watch(() => form.province, () => {
  const cities = form.province ? Object.keys(regions[form.province] || {}) : [];
  // 只有当前城市不属于新省份时才重置，避免把智能识别刚填好的值清空
  if (cities.includes(form.city)) return;
  form.city = cities.length === 1 ? cities[0] : '';
  form.district = '';
});
watch(() => form.city, () => {
  const list = regions[form.province]?.[form.city] || [];
  if (!list.includes(form.district)) form.district = '';
});

const region = computed(() => {
  const city = form.city && form.city !== form.province ? form.city : '';
  return [form.province, city, form.district].filter(Boolean).join(' ');
});

const errors = computed(() => validateAddress(form));

const valid = computed(() => Object.keys(errors.value).length === 0);
const showError = (f: string) => touched[f] && errors.value[f];

// 让父组件知道表单能不能提交、以及当前填好的值（结算页「提交订单」可直接落库）
watch(valid, (v) => emit('update:valid', v), { immediate: true });
watchEffect(() => {
  emit('update:payload', valid.value
    ? { name: form.name.trim(), phone: form.phone.trim(), region: region.value, detail: form.detail.trim() }
    : null);
});

function smartFill() {
  const raw = paste.value.trim();
  if (!raw) { hint.value = '先粘贴一段地址，例如：张三 13800138000 北京市朝阳区建国路 88 号 1 单元 1203'; hintType.value = 'warn'; return; }

  const r = parseAddress(raw, regions);
  if (r.name) form.name = r.name;
  if (r.phone) form.phone = r.phone;
  if (r.province && regions[r.province]) {
    form.province = r.province;
    form.city = r.city && regions[r.province]?.[r.city] ? r.city : Object.keys(regions[r.province])[0] || '';
    form.district = r.district && (regions[r.province]?.[form.city] || []).includes(r.district) ? r.district : '';
  }
  if (r.detail) form.detail = r.detail;

  // 让校验立刻可见，用户能直接看到哪一项还缺
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
    paste.value = ''; hint.value = ''; hintType.value = '';
    Object.keys(touched).forEach((k) => { delete touched[k]; });
  },
});
</script>

<template>
  <div class="af">
    <!-- 智能识别 -->
    <div class="smart">
      <div class="smart-head">
        <span class="smart-title">✨ 智能识别</span>
        <span class="smart-tip">把姓名、电话、地址整段粘贴进来</span>
      </div>
      <textarea
        v-model="paste"
        class="textarea"
        rows="2"
        maxlength="300"
        placeholder="例：张三 13800138000 北京市朝阳区建国路 88 号 1 单元 1203"
        @input="hint = ''"
      />
      <button class="btn btn-secondary btn-sm" style="margin-top: 8px" @click="smartFill">自动拆分填入 ↓</button>
      <p v-if="hint" class="hint" :class="hintType">{{ hint }}</p>
    </div>

    <div class="grid-2" style="margin-top: 14px">
      <div class="field">
        <label>收件人 <i>*</i></label>
        <input
          v-model="form.name" class="input" :class="{ bad: showError('name') }"
          placeholder="姓名" maxlength="30" @blur="touched.name = true"
        />
        <p v-if="showError('name')" class="err">{{ errors.name }}</p>
      </div>
      <div class="field">
        <label>手机号 <i>*</i></label>
        <input
          v-model="form.phone" class="input" :class="{ bad: showError('phone') }"
          placeholder="11 位手机号" maxlength="20" inputmode="tel" @blur="touched.phone = true"
        />
        <p v-if="showError('phone')" class="err">{{ errors.phone }}</p>
      </div>
    </div>

    <div class="field" style="margin-top: 12px">
      <label>所在地区 <i>*</i></label>
      <div class="cascade">
        <select
          v-model="form.province" class="select" :class="{ bad: showError('province') }"
          @change="touched.province = true"
        >
          <option value="">省份</option>
          <option v-for="p in provinceList" :key="p" :value="p">{{ p }}</option>
        </select>
        <select
          v-model="form.city" class="select" :class="{ bad: showError('city') }"
          :disabled="!form.province" @change="touched.city = true"
        >
          <option value="">城市</option>
          <option v-for="c in cityList" :key="c" :value="c">{{ c }}</option>
        </select>
        <select
          v-model="form.district" class="select" :class="{ bad: showError('district') }"
          :disabled="!form.city" @change="touched.district = true"
        >
          <option value="">区 / 县</option>
          <option v-for="d in districtList" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <p v-if="showError('province') || showError('city') || showError('district')" class="err">
        {{ errors.province || errors.city || errors.district }}
      </p>
      <p v-else-if="region" class="ok-line">已选：{{ region }}</p>
    </div>

    <div class="field" style="margin-top: 12px">
      <label>详细地址 <i>*</i></label>
      <textarea
        v-model="form.detail" class="textarea" :class="{ bad: showError('detail') }" rows="2"
        maxlength="200" placeholder="街道、门牌号、楼栋单元房间"
        @blur="touched.detail = true"
      />
      <p v-if="showError('detail')" class="err">{{ errors.detail }}</p>
    </div>

    <div class="row gap-8" style="margin-top: 14px">
      <button class="btn btn-primary btn-sm" :disabled="props.saving" @click="submit">
        {{ props.saving ? '保存中…' : '保存地址' }}
      </button>
      <button v-if="props.showCancel" class="btn btn-secondary btn-sm" @click="emit('cancel')">取消</button>
      <span v-if="!valid" class="dim" style="font-size: 11px; align-self: center">* 为必填项</span>
    </div>
  </div>
</template>

<style scoped>
.af { width: 100%; }
.smart {
  padding: 12px;
  border: 1px dashed var(--line);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}
.smart-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.smart-title { font-size: 13px; font-weight: 600; }
.smart-tip { font-size: 11px; color: var(--text-3); }
.hint { font-size: 12px; margin: 8px 0 0; line-height: 1.5; }
.hint.ok { color: var(--success, #1a7f37); }
.hint.warn { color: var(--warning, #b45309); }

.field label { display: block; font-size: 12px; color: var(--text-2); margin-bottom: 6px; }
.field label i { color: var(--danger, #d93025); font-style: normal; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cascade { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.select {
  height: 38px; padding: 0 8px;
  border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--surface); color: var(--text);
  font-size: 13px; width: 100%;
}
.select:disabled { opacity: 0.55; cursor: not-allowed; }
.input.bad, .select.bad, .textarea.bad { border-color: var(--danger, #d93025); }
.err { font-size: 11px; color: var(--danger, #d93025); margin: 5px 0 0; line-height: 1.4; }
.ok-line { font-size: 11px; color: var(--text-3); margin: 5px 0 0; }

@media (max-width: 640px) {
  .grid-2 { grid-template-columns: 1fr; }
  .cascade { grid-template-columns: 1fr; }
}
</style>
