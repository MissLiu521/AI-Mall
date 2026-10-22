<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';
import type { Order } from '../../api/types';
import { formatTime } from '../../utils/format';

const toast = useToast();
const list = ref<Order[]>([]);
const total = ref(0);
const page = ref(1);
const totalPages = ref(1);
const PAGE_SIZE = 15;
const loading = ref(true);
const status = ref('');
const q = ref('');
const shipTarget = ref<Order | null>(null);
const carrier = ref('顺丰速运');
const trackingNo = ref('');
const shipping = ref(false);

const TABS = [
  { v: '', l: '全部' },
  { v: 'pending_payment', l: '待付款' },
  { v: 'paid', l: '待发货' },
  { v: 'shipped', l: '已发货' },
  { v: 'completed', l: '已完成' },
  { v: 'refunding', l: '退款中' },
  { v: 'refunded', l: '已退款' },
];

const TONE: Record<string, string> = {
  pending_payment: 'badge-warning', paid: 'badge-primary', shipped: 'badge-primary',
  completed: 'badge-success', cancelled: 'badge-muted', refunding: 'badge-warning', refunded: 'badge-danger',
};

async function load() {
  loading.value = true;
  try {
    const r = await api.adminOrders({ status: status.value, q: q.value, page: page.value, pageSize: PAGE_SIZE });
    list.value = r.items;
    total.value = r.total;
    totalPages.value = Math.max(1, Math.ceil((r.total || 0) / PAGE_SIZE));
    if (page.value > totalPages.value) { page.value = totalPages.value; return load(); }
  }
  catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}
onMounted(load);

function switchTab(v: string) { status.value = v; page.value = 1; load(); }

function search() { page.value = 1; load(); }

function goPage(p: number) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
  load();
}

async function ship() {
  if (!shipTarget.value) return;
  if (!trackingNo.value.trim()) { toast.push('请填写运单号', 'error'); return; }
  shipping.value = true;
  try {
    await api.ship(shipTarget.value.id, { carrier: carrier.value.trim(), trackingNo: trackingNo.value.trim() });
    toast.push('已发货，用户可在订单详情看到物流', 'success');
    shipTarget.value = null;
    trackingNo.value = '';
    load();
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { shipping.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="tabs">
      <button v-for="t in TABS" :key="t.v" class="tab" :class="{ active: status === t.v }" @click="switchTab(t.v)">
        {{ t.l }}
      </button>
      <div class="grow" />
      <input v-model="q" class="input" style="width: 220px" placeholder="订单号 / 收货人 / 电话 / 地址" @keyup.enter="search" />
      <button class="btn btn-secondary btn-sm" @click="search">查询</button>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 160px">订单号</th>
            <th>商品</th>
            <th style="width: 90px">金额</th>
            <th style="width: 90px">状态</th>
            <th style="width: 150px">下单时间</th>
            <th style="width: 100px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="6" class="dim" style="text-align: center; padding: 40px">加载中…</td></tr>
          <tr v-else-if="!list.length"><td colspan="6" class="empty">暂无订单</td></tr>
          <tr v-for="o in list" v-else :key="o.id">
            <td>
              <div class="mono" style="font-size: 12px">{{ o.orderNo }}</div>
              <span v-if="o.aiAssisted" class="badge badge-ai" style="margin-top: 4px">AI 协助</span>
            </td>
            <td>
              <div v-for="it in o.items" :key="it.id" class="oi">{{ it.title }} <span class="dim mono">×{{ it.qty }}</span></div>
            </td>
            <td class="mono">¥{{ o.total }}</td>
            <td><span class="badge" :class="TONE[o.status]">{{ o.statusLabel }}</span></td>
            <td class="dim mono" style="font-size: 11px">{{ formatTime(o.createdAt) }}</td>
            <td>
              <button v-if="o.status === 'paid'" class="btn btn-primary btn-sm" @click="shipTarget = o; trackingNo = ''">发货</button>
              <span v-else-if="o.trackingNo" class="dim mono" style="font-size: 11px">{{ o.carrier }}<br />{{ o.trackingNo }}</span>
              <span v-else class="dim" style="font-size: 12px">—</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="totalPages > 1" class="pager">
        <span class="dim" style="font-size: 12px">共 {{ total }} 单</span>
        <div class="row gap-8" style="margin-left: auto">
          <button class="pg-btn" :disabled="page <= 1" @click="goPage(page - 1)">‹ 上一页</button>
          <span class="pg-info">
            第
            <select v-model.number="page" class="pg-select" @change="load()">
              <option v-for="p in totalPages" :key="p" :value="p">{{ p }}</option>
            </select>
            / {{ totalPages }} 页
          </span>
          <button class="pg-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页 ›</button>
        </div>
      </div>
    </div>

    <!-- 发货弹窗：必须填运单号，用户才能看到物流 -->
    <div v-if="shipTarget" class="modal-mask" @click.self="shipTarget = null">
      <div class="modal card card-pad">
        <h3 class="modal-title">订单发货</h3>
        <p class="dim" style="font-size: 12px; margin: 0 0 14px">{{ shipTarget.orderNo }}</p>
        <div class="field">
          <label>承运商</label>
          <input v-model="carrier" class="input" maxlength="40" placeholder="顺丰速运 / 中通快递" />
        </div>
        <div class="field" style="margin-top: 12px">
          <label>运单号</label>
          <input v-model="trackingNo" class="input" maxlength="60" placeholder="如 SF1234567890" @keyup.enter="ship" />
        </div>
        <div class="row gap-8" style="margin-top: 16px; justify-content: flex-end">
          <button class="btn btn-secondary" @click="shipTarget = null">取消</button>
          <button class="btn btn-primary" :disabled="shipping" @click="ship">{{ shipping ? '提交中…' : '确认发货' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.tabs { display: flex; align-items: center; gap: 4px; }
.tab {
  height: 30px;
  padding: 0 12px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--text-2);
}
.tab:hover { background: var(--surface); }
.tab.active { background: var(--surface); border-color: var(--line); color: var(--text); font-weight: 500; }
.oi { font-size: 12px; }
.pager { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line); }
.pg-btn { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 4px 10px; font-size: 12px; color: var(--text-2); cursor: pointer; }
.pg-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.pg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pg-info { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 4px; }
.pg-select { border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px; font-size: 12px; }
.modal-mask {
  position: fixed; inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: grid; place-items: center;
  padding: 16px; z-index: 100;
}
.modal { width: min(420px, 100%); }
.modal-title { font-size: 16px; font-weight: 600; margin: 0 0 6px; }
</style>
