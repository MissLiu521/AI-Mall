<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { useToast } from '../../store';
import type { Stats } from '../../api/types';

const router = useRouter();
const toast = useToast();
const s = ref<Stats | null>(null);
const loading = ref(true);

onMounted(async () => {
  try { s.value = await api.stats(); } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
});

const maxGmv = computed(() => Math.max(1, ...(s.value?.trend.map((t) => t.gmv) || [1])));

const cards = computed(() => s.value ? [
  { label: '成交额 GMV', value: `¥${s.value.gmv.toLocaleString()}`, sub: `${s.value.paidOrders} 笔已支付`, tone: 'primary' },
  { label: '订单总数', value: String(s.value.totalOrders), sub: `客单价 ¥${s.value.avgOrderValue}`, tone: 'default' },
  { label: '待发货', value: String(s.value.pendingShip), sub: '需在 24h 内处理', tone: s.value.pendingShip > 0 ? 'warning' : 'default' },
  { label: '待审退款', value: String(s.value.pendingRefund), sub: '影响体验，尽快处理', tone: s.value.pendingRefund > 0 ? 'danger' : 'default' },
  { label: '在售 SKU', value: String(s.value.sku), sub: `${s.value.lowStock} 个库存偏低`, tone: 'default' },
  { label: 'AI 会话数', value: String(s.value.ai.conversations), sub: `工具调用率 ${s.value.ai.toolCallRate}%`, tone: 'ai' },
] : []);
</script>

<template>
  <div class="dash">
    <div v-if="loading" class="cards">
      <div v-for="i in 6" :key="i" class="skeleton" style="height: 96px" />
    </div>

    <template v-else-if="s">
      <div class="cards">
        <div v-for="c in cards" :key="c.label" class="stat card" :class="`tone-${c.tone}`">
          <div class="stat-label">{{ c.label }}</div>
          <div class="stat-value mono">{{ c.value }}</div>
          <div class="stat-sub">{{ c.sub }}</div>
        </div>
      </div>

      <div class="mid">
        <section class="card card-pad">
          <div class="row-between" style="margin-bottom: 16px">
            <h2 class="block-title">近 14 天成交</h2>
            <span class="dim" style="font-size: 12px">按日统计已支付订单</span>
          </div>
          <div v-if="s.trend.length" class="chart">
            <div v-for="t in s.trend" :key="t.date" class="bar-wrap" :title="`${t.date} · ¥${t.gmv} · ${t.orders} 单`">
              <div class="bar" :style="{ height: `${Math.max(4, (t.gmv / maxGmv) * 100)}%` }" />
              <span class="bar-label">{{ t.date.slice(5) }}</span>
            </div>
          </div>
          <div v-else class="empty" style="padding: 40px">
            <div class="empty-icon">📊</div>
            暂无成交数据
          </div>
        </section>

        <section class="card card-pad">
          <h2 class="block-title">Top 5 商品</h2>
          <div v-for="(p, i) in s.topProducts" :key="p.id" class="top-row">
            <span class="top-rank" :class="{ hot: i < 3 }">{{ i + 1 }}</span>
            <div class="grow">
              <div class="top-title">{{ p.title }}</div>
              <div class="dim" style="font-size: 11px">库存 {{ p.stock }} · ¥{{ p.price }}</div>
            </div>
            <span class="mono top-sales">{{ p.sales }}</span>
          </div>
        </section>
      </div>

      <div class="bottom">
        <section class="card card-pad ai-card">
          <div class="row-between" style="margin-bottom: 14px">
            <h2 class="block-title" style="margin: 0">AI 运行状态</h2>
            <span class="badge" :class="s.ai.mode === 'remote' ? 'badge-success' : 'badge-warning'">
              {{ s.ai.mode === 'remote' ? '远端模型' : '本地引擎' }}
            </span>
          </div>
          <div class="ai-grid">
            <div class="ai-kv"><span class="dim">AI 消息数</span><b class="mono">{{ s.ai.aiMessages }}</b></div>
            <div class="ai-kv"><span class="dim">工具调用率</span><b class="mono">{{ s.ai.toolCallRate }}%</b></div>
            <div class="ai-kv"><span class="dim">导购会话</span><b class="mono">{{ s.ai.byScene.shopping || 0 }}</b></div>
            <div class="ai-kv"><span class="dim">客服会话</span><b class="mono">{{ s.ai.byScene.support || 0 }}</b></div>
            <div class="ai-kv"><span class="dim">运营会话</span><b class="mono">{{ s.ai.byScene.ops || 0 }}</b></div>
            <div class="ai-kv"><span class="dim">待人工工单</span><b class="mono" :style="s.openTickets ? 'color: var(--warning)' : ''">{{ s.openTickets || 0 }}</b></div>
            <div class="ai-kv"><span class="dim">注册用户</span><b class="mono">{{ s.users }}</b></div>
          </div>
          <div class="ai-actions">
            <button class="btn btn-secondary btn-sm" @click="router.push('/admin/ai-conversations')">查看 AI 会话</button>
            <button class="btn btn-ai btn-sm" @click="router.push('/admin/ai-ops')">唤起运营智能体</button>
          </div>
        </section>

        <section class="card card-pad">
          <h2 class="block-title">快捷操作</h2>
          <div class="quick">
            <button class="quick-btn" @click="router.push('/admin/products')">
              <span class="q-icon">▤</span><span>新增商品</span>
            </button>
            <button class="quick-btn" @click="router.push('/admin/orders')">
              <span class="q-icon">▦</span><span>处理发货</span>
            </button>
            <button class="quick-btn" @click="router.push('/admin/refunds')">
              <span class="q-icon">↩</span><span>审核退款</span>
            </button>
            <button class="quick-btn" @click="router.push('/admin/settings')">
              <span class="q-icon">⚙</span><span>AI 配置</span>
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 16px; }
.stat { padding: 14px 16px; display: flex; flex-direction: column; gap: 3px; }
.stat-label { font-size: 12px; color: var(--text-3); }
.stat-value { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
.stat-sub { font-size: 11px; color: var(--text-3); }
.tone-primary .stat-value { color: var(--primary); }
.tone-warning .stat-value { color: var(--warning); }
.tone-danger .stat-value { color: var(--danger); }
.tone-ai .stat-value { color: var(--ai); }

.mid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; margin-bottom: 16px; }
.block-title { font-size: 14px; font-weight: 600; margin: 0 0 12px; }

.chart { display: flex; align-items: flex-end; gap: 6px; height: 180px; padding-top: 10px; }
.bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 6px; }
.bar {
  width: 100%;
  max-width: 36px;
  background: linear-gradient(180deg, var(--primary) 0%, #6b8cf5 100%);
  border-radius: 4px 4px 2px 2px;
  transition: height 0.4s var(--ease), opacity 0.16s;
  opacity: 0.85;
}
.bar-wrap:hover .bar { opacity: 1; }
.bar-label { font-size: 10px; color: var(--text-3); font-family: var(--mono); }

.top-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.top-row:last-child { border-bottom: 0; }
.top-rank {
  width: 20px; height: 20px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 11px;
  font-weight: 600;
  display: grid; place-items: center;
  flex-shrink: 0;
}
.top-rank.hot { background: var(--primary-soft); color: var(--primary); }
.top-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.top-sales { font-size: 13px; color: var(--text-2); }

.bottom { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; }
.ai-card { border-color: #ddd6fb; }
.ai-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.ai-kv { display: flex; flex-direction: column; gap: 2px; padding: 10px; background: var(--surface-2); border-radius: var(--r-sm); }
.ai-kv span { font-size: 11px; }
.ai-kv b { font-size: 16px; }
.ai-actions { display: flex; gap: 8px; margin-top: 14px; }

.quick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.quick-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface);
  font-size: 12px;
  color: var(--text-2);
  transition: all 0.16s;
}
.quick-btn:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.q-icon { font-size: 13px; }

@media (max-width: 1280px) { .cards { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 1024px) { .mid, .bottom { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .cards { grid-template-columns: repeat(2, 1fr); } .ai-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
