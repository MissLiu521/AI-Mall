<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';
import type { Refund } from '../../api/types';
import { formatTime } from '../../utils/format';

const toast = useToast();
const list = ref<Refund[]>([]);
const loading = ref(true);
const busy = ref<number | null>(null);

// 处理弹窗（通过 / 驳回统一走这里，告别 window.prompt）
const deciding = ref<Refund | null>(null);
const decideApprove = ref(true);
const rejectReason = ref('');
const customReason = ref('');
const showHistory = ref<number | null>(null);

const TONE: Record<string, string> = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger' };
const LABEL: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已驳回' };

/** 驳回原因快选 */
const QUICK_REASONS = [
  '不符合七天无理由退款条件（已超期）',
  '商品已拆封/使用，影响二次销售',
  '退款原因与实际情况不符',
  '缺少凭证，请补充图片或说明后再申请',
  '该商品为特价清仓品，不支持无理由退款',
];

async function load() {
  loading.value = true;
  try { list.value = await api.refunds(); } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}
onMounted(load);

function openDecide(r: Refund, approve: boolean) {
  deciding.value = r;
  decideApprove.value = approve;
  rejectReason.value = '';
  customReason.value = '';
}

async function confirmDecide() {
  const r = deciding.value;
  if (!r) return;
  let reason = '';
  if (!decideApprove.value) {
    reason = (rejectReason.value === '其他' ? customReason.value : rejectReason.value).trim();
    if (!reason) { toast.push('请选择或填写驳回原因', 'error'); return; }
  }
  busy.value = r.id;
  try {
    await api.decideRefund(r.id, decideApprove.value, reason);
    toast.push(decideApprove.value ? '已通过，库存已回补，退款将原路退回' : '已驳回，订单已恢复到退款前状态', 'success');
    deciding.value = null;
    await load();
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { busy.value = null; }
}

function toggleHistory(id: number) {
  showHistory.value = showHistory.value === id ? null : id;
}
</script>

<template>
  <div class="page">
    <div class="hint-bar">
      退款审核通过后，订单状态变为「已退款」，库存自动回补；驳回后订单恢复到退款前的状态。每一步处理都会留下记录。
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 60px">ID</th>
            <th style="width: 160px">订单号</th>
            <th style="width: 100px">用户</th>
            <th>退款原因</th>
            <th style="width: 100px">金额</th>
            <th style="width: 90px">状态</th>
            <th style="width: 150px">申请时间</th>
            <th style="width: 190px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="8" class="dim" style="text-align: center; padding: 40px">加载中…</td></tr>
          <tr v-else-if="!list.length"><td colspan="8" class="empty">暂无退款申请</td></tr>
          <template v-for="r in list" v-else :key="r.id">
            <tr>
              <td class="mono dim">{{ r.id }}</td>
              <td class="mono" style="font-size: 12px">{{ r.orderNo }}</td>
              <td>{{ r.userName }}</td>
              <td style="font-size: 12px">{{ r.reason }}</td>
              <td class="mono price">¥{{ r.amount }}</td>
              <td><span class="badge" :class="TONE[r.status]">{{ LABEL[r.status] }}</span></td>
              <td class="dim mono" style="font-size: 11px">{{ formatTime(r.createdAt) }}</td>
              <td>
                <div class="ops-cell">
                  <template v-if="r.status === 'pending'">
                    <button class="btn btn-primary btn-sm" :disabled="busy === r.id" @click="openDecide(r, true)">通过</button>
                    <button class="btn btn-reject btn-sm" :disabled="busy === r.id" @click="openDecide(r, false)">驳回</button>
                  </template>
                  <span v-else class="dim" style="font-size: 12px">
                    {{ r.status === 'approved' ? '已通过' : '已驳回' }}{{ r.decidedAt ? ' · ' + formatTime(r.decidedAt) : '' }}
                  </span>
                  <button class="link-btn" @click="toggleHistory(r.id)">
                    {{ showHistory === r.id ? '收起记录' : '处理记录' }}
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="showHistory === r.id" class="history-row">
              <td colspan="8">
                <div class="history">
                  <div class="h-title">处理记录 · 退款单 #{{ r.id }}</div>
                  <div class="timeline">
                    <div
                      v-for="n in (r.timeline?.nodes || [])" :key="n.key"
                      class="t-node" :class="{ done: n.done, active: n.active }"
                    >
                      <span class="t-dot" />
                      <div class="t-body">
                        <div class="t-head">
                          <b>{{ n.title }}</b>
                          <span v-if="n.at" class="dim mono">{{ formatTime(n.at) }}</span>
                        </div>
                        <div class="t-desc">{{ n.desc }}</div>
                      </div>
                    </div>
                  </div>
                  <div v-if="r.status === 'rejected'" class="h-reject">
                    <b>驳回原因：</b>{{ r.rejectReason || '未填写' }}
                    <template v-if="r.operator"><span class="dim">（处理人：{{ r.operator }}）</span></template>
                  </div>
                  <div v-else-if="r.status === 'approved' && r.operator" class="h-ok">
                    处理人：{{ r.operator }}
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 处理弹窗（通过 / 驳回） -->
    <div v-if="deciding" class="modal-mask" @click.self="deciding = null">
      <div class="modal card" :class="decideApprove ? 'm-ok' : 'm-reject'">
        <div class="m-icon">{{ decideApprove ? '✅' : '🚫' }}</div>
        <h3 class="modal-title">{{ decideApprove ? '通过退款申请' : '驳回退款申请' }}</h3>
        <div class="m-info">
          <div><span>订单</span><b class="mono">{{ deciding.orderNo }}</b></div>
          <div><span>买家</span><b>{{ deciding.userName }}</b></div>
          <div><span>退款金额</span><b class="price">¥{{ deciding.amount }}</b></div>
          <div class="m-reason"><span>申请原因</span><p>{{ deciding.reason }}</p></div>
        </div>

        <template v-if="!decideApprove">
          <div class="m-label">驳回原因 <i class="req">*</i>（将展示给买家）</div>
          <div class="reason-chips">
            <button
              v-for="qr in QUICK_REASONS" :key="qr"
              class="r-chip" :class="{ sel: rejectReason === qr }"
              @click="rejectReason = qr"
            >{{ qr }}</button>
          </div>
          <div v-if="rejectReason === '其他'" class="m-custom">
            <textarea v-model="customReason" class="textarea" rows="3" maxlength="200" placeholder="填写具体驳回原因（200 字内）" />
          </div>
          <p class="m-note">驳回后订单将恢复到退款前状态，买家会收到通知，可补充材料后再次申请。</p>
        </template>
        <template v-else>
          <p class="m-note">通过后：订单变为「已退款」，库存自动回补，退款金额原路退回买家账户。</p>
        </template>

        <div class="m-actions">
          <button class="btn btn-secondary" @click="deciding = null">取消</button>
          <button
            class="btn btn-sm" :class="decideApprove ? 'btn-primary' : 'btn-reject'"
            :disabled="busy === deciding.id" @click="confirmDecide"
          >
            {{ busy === deciding.id ? '处理中…' : decideApprove ? '确认通过' : '确认驳回' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.hint-bar {
  font-size: 12px;
  color: var(--text-2);
  background: var(--primary-soft);
  border-radius: var(--r-sm);
  padding: 10px 14px;
}
.ops-cell { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.link-btn { border: 0; background: transparent; color: var(--primary); font-size: 12px; cursor: pointer; padding: 0; }
.link-btn:hover { text-decoration: underline; }

.btn-reject { background: var(--danger); color: #fff; border: 1px solid var(--danger); }
.btn-reject:hover { opacity: 0.9; }

/* 处理记录展开区 */
.history-row td { background: var(--surface-2); padding: 14px 16px; }
.history { max-width: 860px; }
.h-title { font-size: 12px; font-weight: 600; margin-bottom: 10px; color: var(--text-2); }
.timeline { display: flex; flex-direction: column; gap: 0; }
.t-node { display: flex; gap: 10px; position: relative; padding-bottom: 14px; }
.t-node:not(:last-child)::before {
  content: ''; position: absolute; left: 5px; top: 14px; bottom: 0;
  width: 2px; background: var(--line);
}
.t-dot {
  width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
  background: var(--line); margin-top: 3px; z-index: 1;
}
.t-node.done .t-dot { background: var(--success); }
.t-node.active .t-dot { background: var(--warning, #f59e0b); box-shadow: 0 0 0 3px #fef3c7; }
.t-body { min-width: 0; }
.t-head { display: flex; align-items: baseline; gap: 10px; font-size: 12px; }
.t-head b { font-weight: 600; }
.t-desc { font-size: 12px; color: var(--text-3); margin-top: 2px; line-height: 1.6; }
.h-reject, .h-ok {
  margin-top: 4px; font-size: 12px; padding: 8px 12px; border-radius: 8px; line-height: 1.6;
}
.h-reject { background: #fef2f2; color: #b91c1c; }
.h-ok { background: #ecfdf5; color: #047857; }

/* 处理弹窗 */
.modal-mask {
  position: fixed; inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: grid; place-items: center;
  padding: 16px; z-index: 100;
}
.modal {
  width: min(480px, 100%);
  padding: 22px;
  border-top: 4px solid var(--primary);
  max-height: calc(100vh - 60px);
  overflow-y: auto;
}
.modal.m-reject { border-top-color: var(--danger); }
.m-icon { font-size: 26px; margin-bottom: 6px; }
.modal-title { font-size: 16px; font-weight: 600; margin: 0 0 14px; }
.m-info {
  background: var(--surface-2); border-radius: 10px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;
}
.m-info > div { display: flex; align-items: baseline; gap: 10px; font-size: 13px; }
.m-info span { color: var(--text-3); width: 62px; flex-shrink: 0; font-size: 12px; }
.m-reason { flex-direction: column; gap: 4px !important; }
.m-reason p { margin: 0; font-size: 12px; line-height: 1.6; }
.price { color: var(--danger); font-weight: 700; }
.m-label { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.req { color: var(--danger); font-style: normal; }
.reason-chips { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.r-chip {
  text-align: left; font-size: 12px; line-height: 1.5;
  border: 1px solid var(--line); background: var(--surface);
  border-radius: 8px; padding: 8px 12px; cursor: pointer;
  transition: all 0.14s; color: var(--text-2);
}
.r-chip:hover { border-color: var(--danger); color: var(--danger); }
.r-chip.sel { border-color: var(--danger); background: #fef2f2; color: #b91c1c; font-weight: 500; }
.m-custom { margin-bottom: 12px; }
.m-note { font-size: 12px; color: var(--text-3); line-height: 1.7; margin: 0 0 4px; }
.m-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>
