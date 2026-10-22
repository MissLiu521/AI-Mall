<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';
import { useCart, useAuth, useToast } from '../../store';
import AddressForm from '../../components/AddressForm.vue';
import type { Address } from '../../api/types';

const route = useRoute();
const router = useRouter();
const cart = useCart();
const auth = useAuth();
const toast = useToast();

const remark = ref('');
const submitting = ref(false);
const single = ref<{ product: any; qty: number; skuId: number | null } | null>(null);
const loading = ref(true);

const quote = ref<any>(null);
const quoteLoading = ref(false);
const couponId = ref<number | null>(null);
const usePoints = ref(0);
const showCoupon = ref(false);
const flashSaleId = ref<number | null>(Number(route.query.flash) || null);
const groupBuyId = ref<number | null>(Number(route.query.group) || null);
const groupTeamId = ref<number | null>(Number(route.query.team) || null);
const groupInfo = ref<any>(null);

const addresses = ref<Address[]>([]);
const selectedId = ref<number | null>(null);
const showForm = ref(false);
const savingAddr = ref(false);
const formValid = ref(false);
const formPayload = ref<{ name: string; phone: string; region: string; detail: string } | null>(null);

/** 有服务端报价就用服务端的，保证与下单金额一致；报价失败时用本地估算兜底 */
const items = computed(() => {
  if (quote.value?.items?.length) {
    return quote.value.items.map((i: any) => ({
      title: i.title, price: +(i.priceCents / 100).toFixed(2), qty: i.qty,
      image: i.image, specText: i.specText,
      subtotal: +((i.priceCents * i.qty) / 100).toFixed(2),
    }));
  }
  if (single.value) {
    return [{
      title: single.value.product.title, price: single.value.product.price, qty: single.value.qty,
      image: single.value.product.image, specText: '',
      subtotal: +(single.value.product.price * single.value.qty).toFixed(2),
    }];
  }
  return cart.data.items.map((i: any) => ({
    title: i.product.title, price: i.unitPrice ?? i.product.price, qty: i.qty,
    image: i.image || i.product.image, specText: i.specText || '', subtotal: i.subtotal,
  }));
});

const localSubtotal = computed(() => +items.value.reduce((s: number, i: any) => s + i.subtotal, 0).toFixed(2));
const display = computed(() => quote.value?.display || {
  subtotal: localSubtotal.value,
  discount: 0,
  shipping: localSubtotal.value >= 99 || localSubtotal.value === 0 ? 0 : 8,
  total: +(localSubtotal.value + (localSubtotal.value >= 99 || localSubtotal.value === 0 ? 0 : 8)).toFixed(2),
  saved: 0,
});
const coupons = computed<any[]>(() => quote.value?.coupons || []);
const selectedCoupon = computed(() => coupons.value.find((c) => c.userCouponId === couponId.value) || null);
const pointsBalance = computed(() => quote.value?.pointsBalance || 0);
const maxPointsDiscount = computed(() => {
  // 后端上限是剩余应付的 30%，这里只做一个不超过余额的展示上限
  return Math.min(pointsBalance.value, 100000);
});

// 余额（评价返现所得）可全额抵扣，默认不使用，由用户显式勾选
const balanceAvailable = computed(() => quote.value?.balanceCents || 0);
const balanceOn = ref(false);
const useBalance = ref(0);
watch(balanceOn, (on) => {
  useBalance.value = on ? balanceAvailable.value : 0;
  scheduleQuote();
});
watch(balanceAvailable, (v) => {
  if (balanceOn.value && useBalance.value !== v) { useBalance.value = v; scheduleQuote(); }
});

const selected = computed(() => addresses.value.find((a) => a.id === selectedId.value) || null);
const addressReady = computed(() => !!selected.value || (showForm.value && formValid.value));

async function loadQuote() {
  quoteLoading.value = true;
  try {
    quote.value = await api.previewOrder({
      ...(single.value ? { productId: single.value.product.id, skuId: single.value.skuId, qty: single.value.qty } : {}),
      userCouponId: couponId.value,
      usePoints: usePoints.value,
      useBalance: useBalance.value,
      flashSaleId: flashSaleId.value,
      groupBuyId: groupBuyId.value,
    });
  } catch {
    quote.value = null;
  } finally {
    quoteLoading.value = false;
  }
}

let quoteTimer: number | undefined;
function scheduleQuote() {
  if (quoteTimer) clearTimeout(quoteTimer);
  quoteTimer = window.setTimeout(loadQuote, 250);
}
watch(couponId, loadQuote);
watch(usePoints, scheduleQuote);

onMounted(async () => {
  const pid = route.query.productId as string | undefined;
  const tasks: Promise<any>[] = [];
  tasks.push(api.addresses().then((list) => {
    addresses.value = list;
    const def = list.find((a) => a.isDefault) || list[0];
    selectedId.value = def?.id ?? null;
    showForm.value = !list.length;
  }).catch(() => { showForm.value = true; }));
  if (pid) {
    tasks.push(api.product(pid).then((p) => {
      single.value = {
        product: p,
        qty: Math.max(1, Number(route.query.qty || 1)),
        skuId: route.query.skuId ? Number(route.query.skuId) : null,
      };
    }).catch(() => { /* 商品不存在时保持空态 */ }));
  } else {
    tasks.push(cart.refresh());
  }
  if (groupBuyId.value) {
    tasks.push(api.groupBuy(groupBuyId.value).then((g) => { groupInfo.value = g; }).catch(() => { groupBuyId.value = null; }));
  }
  await Promise.all(tasks);
  await loadQuote();
  loading.value = false;
});

function useNewAddress() {
  showForm.value = true;
  selectedId.value = null;
  formValid.value = false;
  formPayload.value = null;
}

async function saveAddress(payload?: { name: string; phone: string; region: string; detail: string } | null) {
  const data = payload || formPayload.value;
  if (!data) {
    toast.push('请先补全收货信息（收件人、手机号、地区、详细地址）', 'error');
    return null;
  }
  savingAddr.value = true;
  try {
    const created = await api.addAddress({ ...data, isDefault: !addresses.value.length });
    addresses.value = await api.addresses();
    selectedId.value = created.id;
    showForm.value = false;
    toast.push('地址已保存', 'success');
    return created as Address;
  } catch (e: any) {
    toast.push(e.message, 'error');
    return null;
  } finally {
    savingAddr.value = false;
  }
}

async function submit() {
  let addr = selected.value;
  if (!addr) {
    if (!showForm.value) { toast.push('请选择收货地址', 'error'); return; }
    addr = await saveAddress();
    if (!addr) return;
  }
  submitting.value = true;
  const idemKey = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fullAddress = `${addr.region} ${addr.detail}（${addr.name} ${addr.phone}）`;
  try {
    // 拼团走专用入口：普通下单不会建团，用户会以为在拼团其实买成了原价单
    if (groupBuyId.value) {
      const r = await api.createGroupOrder({
        groupBuyId: groupBuyId.value,
        teamId: groupTeamId.value,
        address: fullAddress,
        idemKey,
      });
      toast.push(r.team.success
        ? '已成团，订单已确认，等待商家发货'
        : `下单成功，还差 ${r.team.need} 人成团`, 'success');
      router.replace(`/orders/${r.order.id}`);
      return;
    }

    const order = await api.createOrder({
      address: fullAddress,
      remark: remark.value.trim(),
      ...(single.value ? { productId: single.value.product.id, qty: single.value.qty, skuId: single.value.skuId } : {}),
      userCouponId: couponId.value,
      usePoints: usePoints.value,
      useBalance: useBalance.value,
      flashSaleId: flashSaleId.value,
    }, idemKey);
    if (!single.value) await cart.refresh();
    toast.push('订单已创建，请完成支付', 'success');
    // 支付必须由用户在订单详情页显式确认，下单不再自动置为已支付
    router.replace(`/orders/${order.id}`);
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">确认订单</h1>

    <div v-if="loading" class="skeleton" style="height: 300px" />
    <div v-else-if="!items.length" class="empty card">
      <div class="empty-icon">🧾</div>
      <p>没有可结算的商品</p>
      <button class="btn btn-primary" style="margin-top: 16px" @click="router.push('/shop')">去逛逛</button>
    </div>

    <div v-else class="layout">
      <div class="col gap-16">
        <section class="card card-pad">
          <div class="row-between" style="margin-bottom: 12px">
            <h2 class="block-title" style="margin: 0">收货信息</h2>
            <button v-if="!showForm" class="link-btn" @click="useNewAddress">+ 使用新地址</button>
          </div>

          <div v-if="addresses.length && !showForm" class="addr-list">
            <label v-for="a in addresses" :key="a.id" class="addr" :class="{ active: selectedId === a.id }">
              <input v-model="selectedId" type="radio" :value="a.id" />
              <div class="grow">
                <div class="addr-head">
                  <b>{{ a.name }}</b>
                  <span class="dim mono">{{ a.phone }}</span>
                  <span v-if="a.isDefault" class="badge badge-primary">默认</span>
                </div>
                <div class="addr-detail">{{ a.region }} {{ a.detail }}</div>
              </div>
            </label>
          </div>

          <div v-if="showForm" class="addr-form">
            <AddressForm
              :saving="savingAddr"
              show-cancel
              @submit="saveAddress"
              @cancel="showForm = false; formValid = false"
              @update:valid="formValid = $event"
              @update:payload="formPayload = $event"
            />
          </div>

          <div class="field" style="margin-top: 14px">
            <label>订单备注（可选）</label>
            <input v-model="remark" class="input" placeholder="如：需要发票请填写抬头与税号" maxlength="300" />
          </div>
        </section>

        <section class="card card-pad">
          <h2 class="block-title">商品清单</h2>
          <div class="item-list">
            <div v-for="(it, i) in items" :key="i" class="item">
              <div class="thumb">{{ it.image || '📦' }}</div>
              <div class="grow">
                <div class="item-title">{{ it.title }}</div>
                <div v-if="it.specText" class="dim" style="font-size: 12px">{{ it.specText }}</div>
                <div class="dim" style="font-size: 12px">¥{{ it.price }} × {{ it.qty }}</div>
              </div>
              <div class="price mono">¥{{ it.subtotal }}</div>
            </div>
          </div>
        </section>

        <!-- 优惠：券 + 积分，全部来自服务端报价；拼团价不再叠加 -->
        <section v-if="groupInfo" class="card card-pad">
          <div class="group-tip">
            <div class="gt-head">
              <span class="badge badge-danger">拼团订单</span>
              <b>{{ groupInfo.productTitle }}</b>
            </div>
            <p class="gt-desc">
              拼团价 <b class="price">¥{{ groupInfo.price }}</b>（原价 ¥{{ groupInfo.origin }}）已是活动最低价，
              不再叠加优惠券与积分。
              <template v-if="groupTeamId">提交并支付后即加入该团，人满自动成团。</template>
              <template v-else>还差 {{ Math.max(0, groupInfo.required - 1) }} 人成团，支付后可分享给好友。</template>
              {{ groupInfo.expireHours }} 小时内有效，超时未成团自动退款。
            </p>
            <p class="gt-desc dim">
              {{ groupTeamId ? '你正在参与已有团，成团后统一发货。' : '提交后会生成你的拼团订单，支付后邀请好友参团。' }}
            </p>
          </div>
        </section>

        <section v-else class="card card-pad">
          <div class="row-between" style="margin-bottom: 10px">
            <h2 class="block-title" style="margin: 0">优惠</h2>
            <span v-if="quoteLoading" class="dim" style="font-size: 12px">重新计算中…</span>
          </div>

          <div class="benefit-row" @click="showCoupon = !showCoupon">
            <span class="b-label">优惠券</span>
            <span class="b-value" :class="{ active: selectedCoupon }">
              {{ selectedCoupon ? `-¥${selectedCoupon.discount || 0}` + (selectedCoupon.freeShip ? ' + 免邮' : '') : `${coupons.filter(c => c.usable).length} 张可用` }}
            </span>
            <span class="b-arrow">{{ showCoupon ? '收起' : '选择' }}</span>
          </div>

          <div v-if="showCoupon" class="coupon-panel">
            <label class="cp-row" :class="{ on: couponId === null }">
              <input v-model="couponId" type="radio" :value="null" />
              <div class="grow">
                <div class="cp-name">不使用优惠券</div>
              </div>
            </label>
            <label v-for="c in coupons" :key="c.userCouponId" class="cp-row" :class="{ on: couponId === c.userCouponId, off: !c.usable }">
              <input v-model="couponId" type="radio" :value="c.userCouponId" :disabled="!c.usable" />
              <div class="grow">
                <div class="cp-name">{{ c.title }}</div>
                <div class="cp-rule">{{ c.rule || `满 ¥${c.threshold} 可用` }}<span v-if="!c.usable"> · {{ c.reason }}</span></div>
              </div>
              <div class="cp-save" v-if="c.usable">{{ c.freeShip ? '免邮' : `-¥${c.discount}` }}</div>
            </label>
            <div v-if="!coupons.length" class="dim" style="padding: 10px; font-size: 12px">
              暂无可用券，<router-link to="/promo">去领券中心 →</router-link>
            </div>
          </div>

          <div class="benefit-row">
            <span class="b-label">积分抵扣</span>
            <span class="b-value">余额 {{ pointsBalance }}（≈¥{{ (pointsBalance / 100).toFixed(2) }}）</span>
          </div>
          <div class="points-row">
            <input v-model.number="usePoints" type="range" min="0" :max="maxPointsDiscount" step="100" class="range" />
            <span class="mono points-val">{{ usePoints }} 分</span>
            <button class="link-btn" @click="usePoints = maxPointsDiscount">用满</button>
            <button class="link-btn" @click="usePoints = 0">不用</button>
          </div>

          <div v-if="balanceAvailable > 0" class="benefit-row">
            <span class="b-label">余额抵扣</span>
            <span class="b-value" :class="{ active: balanceOn }">
              {{ balanceOn ? `-¥${(useBalance / 100).toFixed(2)}` : `可用 ¥${(balanceAvailable / 100).toFixed(2)}（评价返现）` }}
            </span>
            <label class="switch">
              <input v-model="balanceOn" type="checkbox" />
              <span>{{ balanceOn ? '已使用' : '使用' }}</span>
            </label>
          </div>
        </section>
      </div>

      <aside class="summary card card-pad">
        <h2 class="sum-title">应付金额</h2>
        <div class="sum-row"><span class="dim">商品小计</span><span class="mono">¥{{ display.subtotal }}</span></div>

        <template v-if="quote">
          <div v-for="(s, i) in quote.steps" :key="i" class="sum-row">
            <span class="dim">{{ s.label }}</span>
            <span class="mono" :class="s.cents >= 0 ? 'minus' : ''">
              {{ s.cents >= 0 ? `-¥${(s.cents / 100).toFixed(2)}` : `+¥${(-s.cents / 100).toFixed(2)}` }}
            </span>
          </div>
        </template>
        <template v-else>
          <div class="sum-row"><span class="dim">运费</span><span class="mono">{{ display.shipping ? `¥${display.shipping}` : '免运费' }}</span></div>
        </template>

        <div class="sum-divider" />
        <div class="sum-row sum-total"><span>应付</span><span class="price">¥{{ display.total }}</span></div>
        <div v-if="display.saved > 0" class="saved-note">已为你省 ¥{{ display.saved }}</div>
        <div v-if="quote?.next" class="next-hint">
          再买 ¥{{ (quote.next.gapCents / 100).toFixed(2) }} 可 {{ quote.next.label }}
        </div>

        <button class="btn btn-primary btn-lg btn-block" style="margin-top: 16px" :disabled="submitting || !addressReady" @click="submit">
          {{ submitting ? '提交中…' : '提交订单' }}
        </button>
        <p class="sum-note">提交后进入待付款，需在订单详情页点「模拟支付」完成演示</p>
        <p class="sum-note">{{ auth.user?.name }} · {{ auth.user?.email }}</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; padding: 24px 24px 64px; }
.page-title { font-size: 22px; font-weight: 600; margin: 0 0 20px; }
.layout { display: grid; grid-template-columns: 1fr 300px; gap: 20px; align-items: start; }
.block-title { font-size: 15px; font-weight: 600; margin: 0 0 14px; }
.link-btn { border: 0; background: transparent; color: var(--primary); font-size: 12px; cursor: pointer; }

.addr-list { display: flex; flex-direction: column; gap: 8px; }
.addr {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.addr.active { border-color: var(--primary); background: var(--primary-soft); }
.addr input { margin-top: 3px; accent-color: var(--primary); }
.addr-head { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.addr-detail { font-size: 12px; color: var(--text-2); margin-top: 4px; line-height: 1.5; }
.addr-form { padding: 4px 0; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.item-list { display: flex; flex-direction: column; }
.item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.thumb {
  width: 48px; height: 48px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  display: grid; place-items: center;
  font-size: 22px;
  flex-shrink: 0;
}
.item-title { font-size: 13px; font-weight: 500; }

.summary { position: sticky; top: 80px; }
.sum-title { font-size: 15px; font-weight: 600; margin: 0 0 14px; }
.sum-row { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; }
.sum-divider { height: 1px; background: var(--line); margin: 12px 0; }
.sum-total { align-items: baseline; font-weight: 500; }
.sum-total .price { font-size: 22px; }
.sum-note { font-size: 11px; color: var(--text-3); text-align: center; margin: 10px 0 0; line-height: 1.6; }

@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .summary { position: static; } }
@media (max-width: 640px) { .page { padding: 16px 16px 48px; } .grid-2 { grid-template-columns: 1fr; } }

/* ── 优惠：券 + 积分 ── */
.benefit-row { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-top: 1px solid var(--line); font-size: 13px; }
.benefit-row:first-of-type { border-top: none; }
.b-label { color: var(--text-3); width: 72px; }
.b-value { flex: 1; color: var(--text-2); }
.b-value.active { color: var(--danger, #e53935); font-weight: 600; }
.b-arrow { font-size: 12px; color: var(--primary); cursor: pointer; }

.coupon-panel { border: 1px solid var(--line); border-radius: 10px; padding: 6px; margin: 4px 0 10px; max-height: 260px; overflow: auto; }
.cp-row { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; cursor: pointer; }
.cp-row:hover { background: var(--bg-2, #f8fafc); }
.cp-row.on { background: #fff5f5; }
.cp-row.off { opacity: .45; cursor: not-allowed; }
.cp-name { font-size: 13px; font-weight: 500; }
.cp-rule { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.cp-save { color: #e53935; font-weight: 600; font-size: 13px; white-space: nowrap; }

.points-row { display: flex; align-items: center; gap: 10px; padding: 6px 0 10px; }
.range { flex: 1; accent-color: #e53935; }
.points-val { font-size: 12px; color: var(--text-2); min-width: 56px; }
.switch { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--primary); cursor: pointer; }

.minus { color: #e53935; }
.saved-note { text-align: center; font-size: 12px; color: #e53935; margin-top: 6px; }
.next-hint { margin-top: 10px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
  font-size: 11px; border-radius: 8px; padding: 7px 10px; text-align: center; }

.group-tip { background: #fff7f7; border: 1px solid #ffd9d9; border-radius: 12px; padding: 14px 16px; }
.gt-head { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.gt-desc { font-size: 12px; color: var(--text-2); line-height: 1.7; margin-top: 8px; }
.gt-desc .price { font-size: 16px; }
</style>
