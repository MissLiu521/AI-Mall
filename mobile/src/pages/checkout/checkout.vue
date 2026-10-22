<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, useCart, toast, requireLogin } from '@/store';
import AddressForm from '@/components/address-form.vue';
import type { PreviewResult } from '@/api/types';

const auth = useAuth();
const cart = useCart();

const loading = ref(true);
const submitting = ref(false);
const pricing = ref(false);

// 单商品直购参数（购物车结算时为空）
const single = ref<{ productId: number; skuId: number; qty: number; title: string; specText: string; image: string; price: number } | null>(null);

// 服务端报价是唯一真相源，页面上所有金额都从 preview 读
const preview = ref<PreviewResult | null>(null);
const userCouponId = ref<number | null>(null);
const usePoints = ref(0);
// 余额（评价返现）可全额抵扣，默认不用
const useBalance = ref(0);
const balanceAvailable = computed(() => (preview.value as any)?.balanceCents || 0);
const showCoupons = ref(false);
// 秒杀场次：从详情页「立即购买」带过来，预览与下单必须用同一个场次，否则看到的价格和付的不一致
const flashSaleId = ref<number | null>(null);

const addresses = ref<any[]>([]);
const selectedId = ref<number | null>(null);
const showForm = ref(false);
const savingAddr = ref(false);
const formPayload = ref<any>(null);

const selected = computed(() => addresses.value.find((a) => a.id === selectedId.value) || null);
const display = computed(() => preview.value?.display || { subtotal: 0, discount: 0, shipping: 0, total: 0, saved: 0 });
const steps = computed(() => (preview.value?.steps || []).filter((s) => s.cents !== 0 || s.note));
const usableCoupons = computed(() => (preview.value?.coupons || []).filter((c) => c.usable));
const unusableCoupons = computed(() => (preview.value?.coupons || []).filter((c) => !c.usable));
const curCoupon = computed(() => usableCoupons.value.find((c) => c.userCouponId === userCouponId.value) || null);
const couponLabel = computed(() => {
  if (curCoupon.value) return `-¥${curCoupon.value.discount.toFixed(2)}`;
  return usableCoupons.value.length ? `${usableCoupons.value.length} 张可用` : '无可用券';
});

// 积分上限 = 券与满减后剩余应付的 30%，且不超过积分余额
const maxPoints = computed(() => {
  if (!preview.value) return 0;
  const p = preview.value;
  const remain = Math.max(0, p.subtotalCents - p.memberDiscountCents - p.couponDiscountCents - p.fullCutCents);
  return Math.min(p.pointsBalance, Math.floor(remain * 0.3));
});
const pointsValue = computed(() => +(usePoints.value / 100).toFixed(2));
const nextTip = computed(() => {
  const n = preview.value?.next;
  if (!n || !n.gapCents) return '';
  return `再买 ¥${(n.gapCents / 100).toFixed(2)} 可享 ${n.label}`;
});

onLoad(async (opt: any) => {
  if (!requireLogin(auth)) return;
  if (opt.flash) flashSaleId.value = Number(opt.flash) || null;
  if (opt.productId) {
    single.value = {
      productId: Number(opt.productId),
      skuId: Number(opt.skuId || 0),
      qty: Math.max(1, Number(opt.qty || 1)),
      title: '', specText: '', image: '', price: 0,
    };
  } else {
    await cart.refresh();
  }
  await loadAddresses();
  await refreshPreview();
  loading.value = false;
});

onShow(() => { if (auth.isLoggedIn && !loading.value) loadAddresses(); });

async function loadAddresses() {
  try {
    addresses.value = (await api.addresses()) as any[];
    const def = addresses.value.find((a) => a.isDefault) || addresses.value[0];
    selectedId.value = def?.id ?? null;
    showForm.value = !addresses.value.length;
  } catch {
    showForm.value = true;
  }
}

/** 参数变化就向服务端重新报价，避免前端自己算一套钱 */
async function refreshPreview() {
  if (pricing.value) return;
  pricing.value = true;
  try {
    const body: any = { userCouponId: userCouponId.value, usePoints: usePoints.value, useBalance: useBalance.value };
    if (flashSaleId.value) body.flashSaleId = flashSaleId.value;
    if (single.value) {
      body.productId = single.value.productId;
      body.qty = single.value.qty;
      if (single.value.skuId) body.skuId = single.value.skuId;
    }
    const r = (await api.previewOrder(body)) as PreviewResult;
    preview.value = r;
    // 服务端会把积分/余额请求收敛到上限，回写保持一致
    usePoints.value = r.pointsUsed;
    useBalance.value = (r as any).balanceUsed || 0;
    if (single.value && r.items?.[0]) {
      const it: any = r.items[0];
      single.value.title = it.title;
      single.value.specText = it.specText || '';
      single.value.image = it.image || '';
      single.value.price = +(it.priceCents / 100).toFixed(2);
    }
  } catch (e: any) {
    toast.err(e.message);
  } finally {
    pricing.value = false;
  }
}

function chooseCoupon(c: any) {
  userCouponId.value = userCouponId.value === c.userCouponId ? null : c.userCouponId;
  usePoints.value = 0;
  showCoupons.value = false;
  refreshPreview();
}

function onPoints(e: any) {
  usePoints.value = Number(e.detail?.value || 0);
  refreshPreview();
}

function togglePoints() {
  usePoints.value = usePoints.value > 0 ? 0 : maxPoints.value;
  refreshPreview();
}

function toggleBalance() {
  useBalance.value = useBalance.value > 0 ? 0 : balanceAvailable.value;
  refreshPreview();
}

function useNew() {
  showForm.value = true;
  selectedId.value = null;
  formPayload.value = null;
}

async function saveAddress(payload?: any) {
  const data = payload || formPayload.value;
  if (!data) { toast.err('请先补全收货信息'); return null; }
  savingAddr.value = true;
  try {
    const created: any = await api.addAddress({ ...data, isDefault: !addresses.value.length });
    await loadAddresses();
    selectedId.value = created.id;
    showForm.value = false;
    toast.ok('地址已保存');
    return created;
  } catch (e: any) { toast.err(e.message); return null; }
  finally { savingAddr.value = false; }
}

async function submit() {
  let addr = selected.value;
  if (!addr) {
    if (!showForm.value) { toast.err('请选择收货地址'); return; }
    addr = await saveAddress();
    if (!addr) return;
  }
  submitting.value = true;
  try {
    const idem = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body: any = {
      address: `${addr.region} ${addr.detail}（${addr.name} ${addr.phone}）`,
      remark: '',
      userCouponId: userCouponId.value || undefined,
      usePoints: usePoints.value || 0,
      useBalance: useBalance.value || 0,
    };
    if (flashSaleId.value) body.flashSaleId = flashSaleId.value;
    if (single.value) {
      body.productId = single.value.productId;
      body.qty = single.value.qty;
      if (single.value.skuId) body.skuId = single.value.skuId;
    }
    const order: any = await api.createOrder(body, idem);
    if (!single.value) await cart.refresh();
    toast.ok('订单已创建，请支付');
    setTimeout(() => {
      uni.redirectTo({ url: `/pages/order-detail/order-detail?id=${order.id}` });
    }, 400);
  } catch (e: any) {
    toast.err(e.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="empty"><text>加载中…</text></view>

    <template v-else>
      <!-- 收货地址 -->
      <view class="card block">
        <view class="row-between">
          <text class="block-title" style="margin:0">收货地址</text>
          <text v-if="!showForm" class="link" @tap="useNew">+ 新地址</text>
        </view>

        <view v-if="addresses.length && !showForm" class="addr-list">
          <view
            v-for="a in addresses" :key="a.id"
            class="addr" :class="{ active: selectedId === a.id }"
            @tap="selectedId = a.id"
          >
            <view class="radio" :class="{ on: selectedId === a.id }" />
            <view class="grow">
              <view class="addr-head">
                <text class="addr-name">{{ a.name }}</text>
                <text class="dim mono">{{ a.phone }}</text>
                <text v-if="a.isDefault" class="badge badge-primary">默认</text>
              </view>
              <text class="addr-detail">{{ a.region }} {{ a.detail }}</text>
            </view>
          </view>
        </view>

        <view v-if="showForm" class="form">
          <AddressForm
            :saving="savingAddr"
            show-cancel
            @submit="saveAddress"
            @cancel="showForm = false"
            @update:payload="formPayload = $event"
          />
        </view>
      </view>

      <!-- 商品清单：直接读服务端报价里的行，规格与活动价都不会和后台不一致 -->
      <view class="card block">
        <text class="block-title">商品清单</text>
        <view v-for="(it, i) in preview?.items || []" :key="i" class="item">
          <view class="thumb"><text class="thumb-emoji">{{ it.image || '📦' }}</text></view>
          <view class="grow">
            <text class="item-title">{{ it.title }}</text>
            <view class="row" style="gap: 10rpx; margin-top: 6rpx">
              <text v-if="it.specText" class="spec-tag">{{ it.specText }}</text>
              <text v-if="it.campaign" class="badge badge-danger">{{ it.campaign.title }}</text>
            </view>
            <text class="dim" style="font-size: 22rpx">¥{{ (it.priceCents / 100).toFixed(2) }} × {{ it.qty }}</text>
          </view>
          <text class="mono">¥{{ ((it.priceCents * it.qty) / 100).toFixed(2) }}</text>
        </view>
      </view>

      <!-- 券与积分 -->
      <view class="card block">
        <view class="opt-row" @tap="showCoupons = true">
          <text class="opt-label">优惠券</text>
          <view class="row" style="gap: 10rpx">
            <text class="opt-value" :class="{ hot: !!curCoupon }">{{ couponLabel }}</text>
            <text class="arrow">›</text>
          </view>
        </view>
        <view class="divider" />
        <view class="opt-row">
          <view class="col">
            <text class="opt-label">积分抵扣</text>
            <text class="dim" style="font-size: 20rpx">
              可用 {{ preview?.pointsBalance || 0 }} 积分，本单最多抵 {{ maxPoints }} 分（约 ¥{{ (maxPoints / 100).toFixed(2) }}）
            </text>
          </view>
          <view class="row" style="gap: 12rpx">
            <text class="opt-value" :class="{ hot: usePoints > 0 }">{{ usePoints ? '-¥' + pointsValue : '未使用' }}</text>
            <text class="switch" :class="{ on: usePoints > 0 }" @tap="togglePoints">{{ usePoints ? '关闭' : '使用' }}</text>
          </view>
        </view>
        <slider
          v-if="maxPoints > 0"
          class="pt-slider"
          :value="usePoints" :min="0" :max="maxPoints" :step="10"
          active-color="#2f5bea" background-color="#e4e7ee" block-size="20"
          @change="onPoints"
        />
        <view v-if="balanceAvailable > 0" class="divider" />
        <view v-if="balanceAvailable > 0" class="opt-row">
          <view class="col">
            <text class="opt-label">余额抵扣</text>
            <text class="dim" style="font-size: 20rpx">
              评价返现余额 ¥{{ (balanceAvailable / 100).toFixed(2) }}，本单可全额抵扣
            </text>
          </view>
          <view class="row" style="gap: 12rpx">
            <text class="opt-value" :class="{ hot: useBalance > 0 }">
              {{ useBalance > 0 ? '-¥' + (useBalance / 100).toFixed(2) : '未使用' }}
            </text>
            <text class="switch" :class="{ on: useBalance > 0 }" @tap="toggleBalance">{{ useBalance > 0 ? '关闭' : '使用' }}</text>
          </view>
        </view>
      </view>

      <!-- 金额明细：逐条展示优惠，不只给一个总数 -->
      <view class="card block">
        <view class="sum-row"><text class="muted">商品小计</text><text class="mono">¥{{ display.subtotal.toFixed(2) }}</text></view>
        <view v-for="(s, i) in steps" :key="i" class="sum-row step">
          <text class="muted">{{ s.label }}</text>
          <text class="mono" :class="s.cents > 0 ? 'cut' : ''">
            {{ s.cents > 0 ? '-¥' + (s.cents / 100).toFixed(2) : (s.note || ('¥' + (-s.cents / 100).toFixed(2))) }}
          </text>
        </view>
        <view class="sum-row"><text class="muted">运费</text><text class="mono">{{ display.shipping ? '¥' + display.shipping.toFixed(2) : '免运费' }}</text></view>
        <view v-if="preview?.couponNote" class="warn-tip">{{ preview.couponNote }}</view>
        <view v-if="nextTip" class="next-tip" @tap="uni.switchTab({ url: '/pages/index/index' })">{{ nextTip }} ›</view>
        <view class="divider" style="margin: 12rpx 0" />
        <view class="sum-row total">
          <text>应付</text>
          <view class="row" style="gap: 14rpx; align-items: baseline">
            <text v-if="display.saved > 0" class="dim" style="font-size: 22rpx">已省 ¥{{ display.saved.toFixed(2) }}</text>
            <text class="price" style="font-size: 38rpx">¥{{ display.total.toFixed(2) }}</text>
          </view>
        </view>
        <text class="note">提交后订单为「待付款」，需在订单详情点「模拟支付」完成演示</text>
      </view>

      <view class="spacer" />
      <view class="bottom-bar">
        <view class="bar-total">
          <text class="muted" style="font-size: 22rpx">合计 </text>
          <text class="price bar-price">¥{{ display.total.toFixed(2) }}</text>
        </view>
        <view class="btn btn-primary bar-btn" :class="{ dis: submitting || pricing }" @tap="submit">
          {{ submitting ? '提交中…' : pricing ? '算价中…' : '提交订单' }}
        </view>
      </view>
    </template>

    <!-- 券选择面板 -->
    <view v-if="showCoupons" class="mask" @tap="showCoupons = false">
      <view class="sheet" @tap.stop>
        <view class="row-between" style="margin-bottom: 20rpx">
          <text class="sheet-title">选择优惠券</text>
          <text class="dim" style="font-size: 24rpx" @tap="showCoupons = false">关闭</text>
        </view>

        <scroll-view scroll-y class="sheet-body">
          <view class="coupon none" :class="{ on: !userCouponId }" @tap="chooseCoupon({ userCouponId: null })">
            <text class="c-none">不使用优惠券</text>
            <view class="radio" :class="{ on: !userCouponId }" />
          </view>

          <view
            v-for="c in usableCoupons" :key="c.userCouponId"
            class="coupon" :class="{ on: userCouponId === c.userCouponId }"
            @tap="chooseCoupon(c)"
          >
            <view class="c-left">
              <text class="c-amount">{{ c.type === 'free_ship' ? '免邮' : c.type === 'discount' ? (c.value / 10).toFixed(1) + '折' : '¥' + (c.value / 100).toFixed(0) }}</text>
              <text class="c-cond">{{ c.threshold ? '满 ' + c.threshold + ' 可用' : '无门槛' }}</text>
            </view>
            <view class="c-mid">
              <text class="c-title">{{ c.title }}</text>
              <text class="dim" style="font-size: 20rpx">{{ c.category }} · 可省 ¥{{ c.discount.toFixed(2) }}</text>
            </view>
            <view class="radio" :class="{ on: userCouponId === c.userCouponId }" />
          </view>

          <view v-if="unusableCoupons.length" class="un-title">不满足使用条件</view>
          <view v-for="c in unusableCoupons" :key="'u' + c.userCouponId" class="coupon off">
            <view class="c-left">
              <text class="c-amount gray">{{ c.type === 'free_ship' ? '免邮' : c.type === 'discount' ? (c.value / 10).toFixed(1) + '折' : '¥' + (c.value / 100).toFixed(0) }}</text>
              <text class="c-cond">{{ c.threshold ? '满 ' + c.threshold + ' 可用' : '无门槛' }}</text>
            </view>
            <view class="c-mid">
              <text class="c-title">{{ c.title }}</text>
              <text class="c-reason">{{ c.reason }}</text>
            </view>
          </view>
        </scroll-view>

        <view class="btn btn-primary" style="margin-top: 20rpx" @tap="showCoupons = false">完成</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 20rpx 20rpx calc(180rpx + var(--window-bottom, 0px)); }
.block { padding: 26rpx; margin-bottom: 20rpx; }
.block-title { font-size: 28rpx; font-weight: 600; display: block; margin-bottom: 16rpx; }
.link { font-size: 24rpx; color: #2f5bea; }
.dim { color: #8d94a6; }

.addr-list { display: flex; flex-direction: column; gap: 12rpx; margin-top: 16rpx; }
.addr {
  display: flex; gap: 16rpx; align-items: flex-start;
  padding: 20rpx; border: 1rpx solid #e4e7ee; border-radius: 16rpx;
}
.addr.active { border-color: #2f5bea; background: #f3f6ff; }
.radio {
  width: 28rpx; height: 28rpx; border-radius: 50%;
  border: 2rpx solid #c2c8d4; margin-top: 6rpx; flex-shrink: 0;
}
.radio.on { border-color: #2f5bea; background: #2f5bea; box-shadow: inset 0 0 0 5rpx #fff; }
.addr-head { display: flex; align-items: center; gap: 12rpx; }
.addr-name { font-size: 26rpx; font-weight: 600; }
.addr-detail { display: block; font-size: 22rpx; color: #5a6072; margin-top: 6rpx; line-height: 1.5; }

.form { display: flex; flex-direction: column; gap: 18rpx; margin-top: 16rpx; }

.item { display: flex; align-items: center; gap: 16rpx; padding: 12rpx 0; border-bottom: 1rpx solid #f1f3f7; }
.item:last-child { border-bottom: none; }
.thumb {
  width: 96rpx; height: 96rpx; border-radius: 12rpx;
  background: #f1f3f7; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.thumb-emoji { font-size: 44rpx; }
.item-title { font-size: 26rpx; display: block; margin-bottom: 4rpx; }
.spec-tag { font-size: 20rpx; color: #5a6072; background: #f1f3f7; padding: 4rpx 12rpx; border-radius: 6rpx; }

.opt-row { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; }
.opt-label { font-size: 26rpx; }
.opt-value { font-size: 24rpx; color: #8d94a6; }
.opt-value.hot { color: #d93b4a; font-weight: 500; }
.arrow { font-size: 28rpx; color: #c2c8d4; }
.switch {
  font-size: 22rpx; color: #2f5bea; border: 1rpx solid #2f5bea;
  padding: 4rpx 16rpx; border-radius: 999rpx;
}
.switch.on { color: #8d94a6; border-color: #d3d8e3; }
.pt-slider { margin: 10rpx 8rpx 0; }

.sum-row { display: flex; justify-content: space-between; font-size: 26rpx; padding: 8rpx 0; }
.sum-row.step { font-size: 24rpx; }
.cut { color: #d93b4a; }
.total { align-items: baseline; font-weight: 500; }
.warn-tip { font-size: 22rpx; color: #e08b1e; background: #fdf3e4; padding: 10rpx 16rpx; border-radius: 8rpx; margin-top: 10rpx; }
.next-tip { font-size: 22rpx; color: #2f5bea; background: #edf1fe; padding: 10rpx 16rpx; border-radius: 8rpx; margin-top: 10rpx; }
.note { display: block; font-size: 20rpx; color: #8d94a6; line-height: 1.6; margin-top: 14rpx; }

.bottom-bar {
  position: fixed; left: 0; right: 0; bottom: var(--window-bottom, 0);
  display: flex; align-items: center; gap: 20rpx;
  padding: 16rpx 24rpx; background: #fff; border-top: 1rpx solid #e4e7ee;
}
.bar-total { flex: 1; display: flex; align-items: baseline; }
.bar-price { font-size: 40rpx; }
.bar-btn { flex: 1.2; }
.btn.dis { opacity: 0.5; }

.mask {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex; align-items: flex-end; z-index: 200;
}
.sheet {
  width: 100%;
  max-height: 76vh;
  display: flex; flex-direction: column;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  padding: 32rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
}
.sheet-title { font-size: 32rpx; font-weight: 600; }
.sheet-body { flex: 1; max-height: 56vh; }

.coupon {
  display: flex; align-items: center; gap: 18rpx;
  padding: 20rpx; border: 1rpx solid #e4e7ee; border-radius: 16rpx; margin-bottom: 14rpx;
}
.coupon.on { border-color: #2f5bea; background: #f3f6ff; }
.coupon.off { opacity: 0.55; }
.coupon.none { justify-content: space-between; }
.c-none { font-size: 26rpx; }
.c-left { width: 140rpx; text-align: center; }
.c-amount { display: block; font-size: 34rpx; font-weight: 600; color: #d93b4a; }
.c-amount.gray { color: #8d94a6; }
.c-cond { font-size: 18rpx; color: #8d94a6; }
.c-mid { flex: 1; }
.c-title { display: block; font-size: 24rpx; font-weight: 500; }
.c-reason { font-size: 20rpx; color: #e08b1e; }
.un-title { font-size: 22rpx; color: #8d94a6; margin: 16rpx 0 12rpx; }
</style>
