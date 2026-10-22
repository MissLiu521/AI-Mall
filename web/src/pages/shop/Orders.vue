<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { useToast } from '../../store';
import type { Order } from '../../api/types';
import { formatTime } from '../../utils/format';

const router = useRouter();
const toast = useToast();
const orders = ref<Order[]>([]);
const loading = ref(true);

const TONE: Record<string, string> = {
  pending_payment: 'badge-warning',
  paid: 'badge-primary',
  shipped: 'badge-primary',
  completed: 'badge-success',
  cancelled: 'badge-muted',
  refunding: 'badge-warning',
  refunded: 'badge-danger',
};

onMounted(async () => {
  try { orders.value = await api.myOrders(); } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
});
</script>

<template>
  <div class="page">
    <h1 class="page-title">我的订单</h1>

    <div v-if="loading" class="col gap-12">
      <div v-for="i in 3" :key="i" class="skeleton" style="height: 110px" />
    </div>
    <div v-else-if="!orders.length" class="empty card">
      <div class="empty-icon">📦</div>
      <p>还没有订单</p>
      <button class="btn btn-primary" style="margin-top: 16px" @click="router.push('/shop')">去逛逛</button>
    </div>

    <div v-else class="col gap-12">
      <article v-for="o in orders" :key="o.id" class="order card">
        <header class="order-head">
          <div class="row gap-12">
            <span class="mono dim" style="font-size: 12px">{{ o.orderNo }}</span>
            <span class="badge" :class="TONE[o.status]">{{ o.statusLabel }}</span>
            <span v-if="o.aiAssisted" class="badge badge-ai">AI 协助</span>
          </div>
          <span class="dim" style="font-size: 12px">{{ formatTime(o.createdAt) }}</span>
        </header>
        <div class="order-body">
          <div class="order-items">
            <div v-for="it in o.items" :key="it.id" class="oi">
              <span class="oi-title">{{ it.title }}</span>
              <span class="dim mono">×{{ it.qty }}</span>
            </div>
          </div>
          <div class="order-total">
            <span class="dim" style="font-size: 12px">实付</span>
            <span class="price">¥{{ o.total }}</span>
          </div>
        </div>
        <footer class="order-foot">
          <button class="btn btn-secondary btn-sm" @click="router.push(`/orders/${o.id}`)">查看详情</button>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 900px; margin: 0 auto; padding: 24px 24px 64px; }
.page-title { font-size: 22px; font-weight: 600; margin: 0 0 20px; }
.order { overflow: hidden; }
.order-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 18px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
}
.order-body { display: flex; align-items: center; padding: 16px 18px; gap: 24px; }
.order-items { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.oi { display: flex; gap: 10px; align-items: baseline; font-size: 13px; }
.oi-title { flex: 1; }
.order-total { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.order-total .price { font-size: 18px; }
.order-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
@media (max-width: 640px) { .page { padding: 16px 16px 48px; } }
</style>
