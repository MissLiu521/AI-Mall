<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuth, useCart, toast, requireLogin } from '@/store';

const auth = useAuth();
const cart = useCart();
const busy = ref(false);

onShow(() => { cart.refresh(); });

const items = computed<any[]>(() => cart.data.items || []);
const groups = computed<any[]>(() => cart.data.groups || []);
const validCount = computed(() => items.value.filter((i: any) => !i.invalid).length);
const allSelected = computed(() => {
  const v = items.value.filter((i: any) => !i.invalid);
  return v.length > 0 && v.every((i: any) => i.selected);
});
const total = computed(() => +((cart.data.subtotal || 0) + (cart.data.shipping || 0)).toFixed(2));
const freeGap = computed(() => Math.max(0, +(99 - (cart.data.subtotal || 0)).toFixed(2)));

async function change(id: number, qty: number) {
  if (qty < 1 || busy.value) return;
  busy.value = true;
  try { await cart.update(id, qty); } catch (e: any) { toast.err(e.message); } finally { busy.value = false; }
}
async function remove(id: number) {
  try { await cart.remove(id); toast.info('已移除'); } catch (e: any) { toast.err(e.message); }
}
async function toggle(it: any) {
  if (it.invalid) return;
  try { await cart.select(it.cartId, !it.selected); } catch (e: any) { toast.err(e.message); }
}
function groupAllSelected(g: any) {
  const valid = g.items.filter((i: any) => !i.invalid);
  return valid.length > 0 && valid.every((i: any) => i.selected);
}
async function toggleGroup(g: any) {
  const valid = g.items.filter((i: any) => !i.invalid);
  const next = !valid.every((i: any) => i.selected);
  try {
    for (const i of valid) {
      if (!!i.selected !== next) await cart.select(i.cartId, next);
    }
  } catch (e: any) { toast.err(e.message); }
}
async function toggleAll() {
  try { await cart.selectAll(!allSelected.value); } catch (e: any) { toast.err(e.message); }
}
async function clearInvalid() {
  uni.showModal({
    title: '清理失效商品',
    content: '将移除已下架或库存不足的商品',
    success: async (r) => {
      if (!r.confirm) return;
      try {
        const n = await cart.removeInvalid();
        toast.ok(n ? `已清理 ${n} 件` : '没有失效商品');
      } catch (e: any) { toast.err(e.message); }
    },
  });
}

function checkout() {
  if (!requireLogin(auth)) return;
  if (!cart.data.selectedCount) { toast.err('请先勾选要结算的商品'); return; }
  uni.navigateTo({ url: '/pages/checkout/checkout' });
}

function goShop() { uni.switchTab({ url: '/pages/index/index' }); }
</script>

<template>
  <view class="page">
    <view v-if="!auth.isLoggedIn" class="empty">
      <text class="empty-icon">🛒</text>
      <text>登录后查看购物车</text>
      <view class="btn btn-primary btn-sm" style="display:inline-flex; margin-top: 24rpx"
            @tap="uni.navigateTo({ url: '/pages/login/login' })">去登录</view>
    </view>

    <view v-else-if="!items.length" class="empty">
      <text class="empty-icon">🛒</text>
      <text>购物车是空的</text>
      <view class="btn btn-primary btn-sm" style="display:inline-flex; margin-top: 24rpx" @tap="goShop">去逛逛</view>
    </view>

    <template v-else>
      <view v-if="cart.data.invalidCount" class="invalid-bar">
        <text class="invalid-txt">{{ cart.data.invalidCount }} 件商品已失效</text>
        <text class="invalid-act" @tap="clearInvalid">一键清理</text>
      </view>

      <!-- 按店铺分组：同一店铺的商品一起凑单，符合淘宝/京东的购物车心智 -->
      <view v-for="g in groups" :key="g.shopName" class="group card">
        <view class="g-head">
          <view class="check" :class="{ on: groupAllSelected(g) }" @tap="toggleGroup(g)">
            <text v-if="groupAllSelected(g)" class="check-txt">✓</text>
          </view>
          <text class="g-name">🏬 {{ g.shopName }}</text>
          <text v-if="g.isSelf" class="badge badge-primary">自营</text>
          <text class="g-sub mono">¥{{ (g.subtotal || 0).toFixed(2) }}</text>
        </view>

        <view v-for="it in g.items" :key="it.cartId" class="item" :class="{ off: it.invalid }">
          <view class="check" :class="{ on: it.selected && !it.invalid, dis: it.invalid }" @tap="toggle(it)">
            <text v-if="it.selected && !it.invalid" class="check-txt">✓</text>
          </view>
          <view class="thumb" @tap="uni.navigateTo({ url: `/pages/detail/detail?id=${it.product.id}` })">
            <text class="thumb-emoji">{{ it.image || it.product.image }}</text>
          </view>
          <view class="info">
            <text class="title">{{ it.product.title }}</text>
            <text v-if="it.specText" class="spec">{{ it.specText }}</text>
            <text v-if="it.invalid" class="badge badge-muted" style="align-self: flex-start">{{ it.invalidReason }}</text>
            <view class="row-between" style="margin-top: 10rpx">
              <text class="price">¥{{ it.unitPrice }}</text>
              <view class="stepper">
                <text class="s-btn" @tap="change(it.cartId, it.qty - 1)">−</text>
                <text class="s-num mono">{{ it.qty }}</text>
                <text class="s-btn" @tap="change(it.cartId, it.qty + 1)">＋</text>
              </view>
            </view>
          </view>
          <text class="del" @tap="remove(it.cartId)">×</text>
        </view>
      </view>

      <view class="summary card">
        <view class="sum-row"><text class="muted">已选商品</text><text class="mono">{{ cart.data.selectedCount }} 件 · ¥{{ (cart.data.subtotal || 0).toFixed(2) }}</text></view>
        <view class="sum-row">
          <text class="muted">运费</text>
          <text class="mono">{{ cart.data.shipping === 0 ? '免运费' : '¥' + cart.data.shipping }}</text>
        </view>
        <view v-if="freeGap > 0" class="free-tip">再买 ¥{{ freeGap }} 免运费</view>
        <view class="divider" style="margin: 16rpx 0" />
        <view class="sum-row total"><text>合计</text><text class="price total-price">¥{{ total }}</text></view>
        <text class="dim" style="font-size: 20rpx">会员折扣、优惠券、满减与积分在结算页统一叠加</text>
      </view>

      <view class="spacer" />

      <view class="bottom-bar safe-bottom">
        <view class="bar-check" @tap="toggleAll">
          <view class="check" :class="{ on: allSelected }">
            <text v-if="allSelected" class="check-txt">✓</text>
          </view>
          <text class="bar-check-txt">全选</text>
        </view>
        <view class="bar-total">
          <text class="muted" style="font-size: 22rpx">合计 </text>
          <text class="price bar-price">¥{{ total }}</text>
        </view>
        <view class="btn btn-primary bar-btn" @tap="checkout">结算（{{ cart.data.selectedCount }}）</view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { padding: 20rpx 20rpx calc(180rpx + var(--window-bottom, 0px)); }

.invalid-bar {
  display: flex; align-items: center; justify-content: space-between;
  background: #fdf3e4; border-radius: 14rpx; padding: 16rpx 22rpx; margin-bottom: 16rpx;
}
.invalid-txt { font-size: 24rpx; color: #e08b1e; }
.invalid-act { font-size: 24rpx; color: #e08b1e; font-weight: 500; }

.group { margin-bottom: 20rpx; padding: 20rpx 22rpx; }
.g-head { display: flex; align-items: center; gap: 14rpx; padding-bottom: 14rpx; border-bottom: 1rpx solid #f1f3f7; }
.g-name { font-size: 26rpx; font-weight: 600; }
.g-sub { font-size: 22rpx; color: #8d94a6; margin-left: auto; }

.check {
  width: 36rpx; height: 36rpx; border-radius: 50%;
  border: 2rpx solid #c2c8d4; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.check.on { border-color: #2f5bea; background: #2f5bea; }
.check.dis { background: #f1f3f7; border-color: #e4e7ee; }
.check-txt { font-size: 20rpx; color: #fff; }

.item { position: relative; display: flex; gap: 16rpx; padding: 18rpx 0; align-items: center; }
.item.off .thumb { opacity: 0.5; }
.thumb {
  width: 140rpx; height: 140rpx;
  border-radius: 14rpx;
  background: #f1f3f7;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.thumb-emoji { font-size: 62rpx; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.title {
  font-size: 26rpx; font-weight: 500;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.spec {
  font-size: 20rpx; color: #5a6072; background: #f1f3f7;
  padding: 4rpx 12rpx; border-radius: 6rpx; align-self: flex-start; margin-top: 6rpx;
}
.price { font-size: 30rpx; color: #d93b4a; font-weight: 600; font-family: 'SF Mono', Consolas, monospace; }
.stepper { display: flex; align-items: center; border: 1rpx solid #d3d8e3; border-radius: 10rpx; overflow: hidden; }
.s-btn { width: 52rpx; height: 50rpx; display: flex; align-items: center; justify-content: center; color: #5a6072; font-size: 26rpx; }
.s-num { width: 60rpx; text-align: center; font-size: 24rpx; }
.del {
  position: absolute;
  top: 4rpx; right: 0;
  font-size: 30rpx;
  color: #c2c8d4;
  padding: 4rpx 10rpx;
}

.summary { padding: 26rpx; }
.sum-row { display: flex; justify-content: space-between; font-size: 26rpx; padding: 8rpx 0; }
.free-tip { font-size: 22rpx; color: #e08b1e; background: #fdf3e4; padding: 10rpx 16rpx; border-radius: 8rpx; margin-top: 10rpx; }
.total { align-items: baseline; font-weight: 500; }
.total-price { font-size: 40rpx; }

.bottom-bar {
  position: fixed;
  bottom: var(--window-bottom, 0);
  left: 0; right: 0;
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 16rpx 24rpx;
  background: #fff;
  border-top: 1rpx solid #e4e7ee;
}
.bar-check { display: flex; align-items: center; gap: 10rpx; }
.bar-check-txt { font-size: 22rpx; color: #5a6072; }
.bar-total { flex: 1; display: flex; align-items: baseline; justify-content: flex-end; white-space: nowrap; }
.bar-price { font-size: 38rpx; }
.bar-btn { flex: 1.1; }
</style>
