<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useCart, useToast } from '../../store';
import { api } from '../../api';

const router = useRouter();
const cart = useCart();
const toast = useToast();

onMounted(() => cart.refresh());

const groups = computed(() => cart.data.groups || []);
const total = computed(() => +(cart.data.subtotal + cart.data.shipping).toFixed(2));
const freeGap = computed(() => Math.max(0, +(99 - cart.data.subtotal).toFixed(2)));
const invalidCount = computed(() => cart.data.invalidCount || 0);

async function change(id: number, qty: number) {
  try { await cart.update(id, qty); } catch (e: any) { toast.push(e.message, 'error'); }
}
async function remove(id: number) {
  try { await cart.remove(id); toast.push('已移除', 'info'); } catch (e: any) { toast.push(e.message, 'error'); }
}
async function toggle(id: number, selected: boolean) {
  try { await api.selectCart(id, selected); await cart.refresh(); } catch (e: any) { toast.push(e.message, 'error'); }
}
async function toggleAll(selected: boolean) {
  try { await api.selectAllCart(selected); await cart.refresh(); } catch (e: any) { toast.push(e.message, 'error'); }
}
async function clearInvalid() {
  try {
    const r = await api.removeInvalidCart();
    toast.push(`已清理 ${r.removed} 件失效商品`, 'success');
    await cart.refresh();
  } catch (e: any) { toast.push(e.message, 'error'); }
}
const allSelected = computed(() => cart.data.items.every((i: any) => i.selected || i.invalid));
</script>

<template>
  <div class="page">
    <h1 class="page-title">购物车</h1>

    <div v-if="!cart.data.items.length" class="empty card">
      <div class="empty-icon">🛒</div>
      <p>购物车是空的</p>
      <button class="btn btn-primary" style="margin-top: 16px" @click="router.push('/shop')">去逛逛</button>
    </div>

    <div v-else class="layout">
      <div class="main-col">
        <div v-if="invalidCount" class="invalid-tip">
          有 {{ invalidCount }} 件商品已下架或售罄
          <button class="link-btn" @click="clearInvalid">一键清理</button>
        </div>

        <div class="list card">
          <div class="list-head">
            <label class="check">
              <input type="checkbox" :checked="allSelected" @change="toggleAll(($event.target as HTMLInputElement).checked)" />
              全选
            </label>
            <span>商品</span><span class="c-qty">数量</span><span class="c-sub">小计</span><span />
          </div>

          <template v-for="g in groups" :key="g.shopName">
            <div class="shop-head">
              <span class="shop-name">{{ g.isSelf ? '🏬' : '🏪' }} {{ g.shopName }}</span>
              <span v-if="g.isSelf" class="badge badge-danger">自营</span>
            </div>
            <div v-for="it in g.items" :key="it.cartId" class="row-item" :class="{ invalid: it.invalid }">
              <label class="check">
                <input type="checkbox" :checked="it.selected" :disabled="it.invalid"
                       @change="toggle(it.cartId, ($event.target as HTMLInputElement).checked)" />
              </label>
              <div class="item-main">
                <div class="thumb">{{ it.image || it.product.image || '📦' }}</div>
                <div class="item-info">
                  <router-link :to="`/product/${it.product.id}`" class="item-title">{{ it.product.title }}</router-link>
                  <div v-if="it.specText" class="item-spec">{{ it.specText }}</div>
                  <div v-else class="item-sub dim">{{ it.product.subtitle }}</div>
                  <div class="item-price price">¥{{ it.unitPrice }}</div>
                  <div v-if="it.invalid" class="badge badge-danger" style="margin-top: 4px">{{ it.invalidReason }}</div>
                  <div v-else-if="!it.stockEnough" class="badge badge-danger" style="margin-top: 4px">库存不足</div>
                </div>
              </div>
              <div class="c-qty">
                <div class="stepper">
                  <button :disabled="it.qty <= 1" @click="change(it.cartId, it.qty - 1)">−</button>
                  <span class="mono">{{ it.qty }}</span>
                  <button :disabled="it.qty >= it.stock" @click="change(it.cartId, it.qty + 1)">＋</button>
                </div>
              </div>
              <div class="c-sub price">¥{{ it.subtotal }}</div>
              <button class="del-btn" aria-label="删除" @click="remove(it.cartId)">×</button>
            </div>
          </template>
        </div>
      </div>

      <aside class="summary card card-pad">
        <h2 class="sum-title">订单摘要</h2>
        <div class="sum-row"><span class="dim">已选 {{ cart.data.selectedCount }} 件</span><span class="mono">¥{{ cart.data.subtotal }}</span></div>
        <div class="sum-row">
          <span class="dim">运费</span>
          <span class="mono">{{ cart.data.shipping === 0 ? '免运费' : `¥${cart.data.shipping}` }}</span>
        </div>
        <div v-if="freeGap > 0" class="free-tip">再买 ¥{{ freeGap }} 免运费</div>
        <div class="sum-divider" />
        <div class="sum-row sum-total">
          <span>合计</span><span class="price">¥{{ total }}</span>
        </div>
        <button class="btn btn-primary btn-lg btn-block" style="margin-top: 16px"
                :disabled="!cart.data.selectedCount" @click="router.push('/checkout')">
          去结算
        </button>
        <p class="sum-note">结算页可用优惠券与积分，实付以结算页为准</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; padding: 24px 24px 64px; }
.page-title { font-size: 22px; font-weight: 600; margin: 0 0 20px; }
.layout { display: grid; grid-template-columns: 1fr 300px; gap: 20px; align-items: start; }
.main-col { display: flex; flex-direction: column; gap: 12px; }

.invalid-tip { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; font-size: 12px;
  padding: 9px 14px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; }
.link-btn { border: 0; background: transparent; color: var(--primary); font-size: 12px; cursor: pointer; }

.list { overflow: hidden; }
.list-head { display: grid; grid-template-columns: 56px 1fr 120px 100px 36px; padding: 10px 16px;
  background: var(--surface-2); font-size: 12px; color: var(--text-3); align-items: center; }
.c-qty, .c-sub { text-align: center; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); cursor: pointer; }

.shop-head { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: #fafbfc;
  border-top: 1px solid var(--line); font-size: 13px; }
.shop-name { font-weight: 600; }

.row-item { display: grid; grid-template-columns: 56px 1fr 120px 100px 36px; align-items: center;
  padding: 14px 16px; border-top: 1px solid var(--line); }
.row-item.invalid { opacity: .55; }
.item-main { display: flex; gap: 12px; align-items: center; }
.thumb { width: 68px; height: 68px; border-radius: var(--r-sm); background: var(--surface-2);
  display: grid; place-items: center; font-size: 28px; flex-shrink: 0; }
.item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.item-title { font-size: 14px; font-weight: 500; }
.item-title:hover { color: var(--primary); }
.item-sub { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-spec { font-size: 12px; color: var(--text-3); background: var(--surface-2); border-radius: 6px;
  padding: 2px 8px; align-self: flex-start; }
.item-price { font-size: 13px; }

.stepper { display: inline-flex; align-items: center; border: 1px solid var(--line-strong);
  border-radius: var(--r-sm); overflow: hidden; }
.stepper button { width: 26px; height: 28px; border: 0; background: var(--surface); color: var(--text-2); }
.stepper button:hover:not(:disabled) { background: var(--surface-2); }
.stepper button:disabled { opacity: 0.35; cursor: not-allowed; }
.stepper span { width: 34px; text-align: center; font-size: 13px; }

.c-sub { font-size: 15px; }
.del-btn { border: 0; background: transparent; color: var(--text-3); font-size: 18px; line-height: 1; }
.del-btn:hover { color: var(--danger); }

.summary { position: sticky; top: 80px; }
.sum-title { font-size: 15px; font-weight: 600; margin: 0 0 14px; }
.sum-row { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; }
.free-tip { font-size: 11px; color: var(--warning); background: var(--warning-soft);
  padding: 5px 9px; border-radius: 6px; margin-top: 8px; }
.sum-divider { height: 1px; background: var(--line); margin: 12px 0; }
.sum-total { font-size: 14px; font-weight: 500; align-items: baseline; }
.sum-total .price { font-size: 22px; }
.sum-note { font-size: 11px; color: var(--text-3); text-align: center; margin: 10px 0 0; }

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .summary { position: static; }
  .list-head { display: none; }
  .row-item { grid-template-columns: 40px 1fr auto; gap: 10px; }
  .row-item .c-qty { grid-column: 2; grid-row: 2; }
  .row-item .c-sub { grid-column: 3; grid-row: 1; text-align: right; }
  .del-btn { grid-column: 3; grid-row: 2; }
}
</style>
