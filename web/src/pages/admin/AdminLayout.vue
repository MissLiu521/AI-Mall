<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';
import { useAuth, useToast } from '../../store';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const toast = useToast();
const collapsed = ref(false);

const NAV = [
  { group: '经营', items: [
    { to: '/admin/dashboard', label: '数据看板', icon: '◪' },
    { to: '/admin/products', label: '商品管理', icon: '▤' },
    { to: '/admin/orders', label: '订单管理', icon: '▦' },
    { to: '/admin/refunds', label: '退款审核', icon: '↩' },
    { to: '/admin/tickets', label: '人工工单', icon: '☎' },
  ] },
  { group: '增长', items: [
    { to: '/admin/marketing', label: '营销中心', icon: '▣' },
    { to: '/admin/reviews', label: '评价管理', icon: '★' },
    { to: '/admin/review-tags', label: '评价标签', icon: '#' },
    { to: '/admin/content', label: '内容管理', icon: '▶' },
  ] },
  { group: 'AI 能力', items: [
    { to: '/admin/ai-ops', label: '运营智能体', icon: '✦' },
    { to: '/admin/ai-conversations', label: 'AI 会话', icon: '◌' },
    { to: '/admin/settings', label: 'AI 配置', icon: '⚙' },
  ] },
];

const title = computed(() => (route.meta.title as string) || '商家后台');

/* ── 新订单实时提醒：15s 轮询，红点 + toast，进订单页即清零 ── */
const newOrderCount = ref(0);
const pendingRefunds = ref(0);
let lastSeen = localStorage.getItem('aimall_notify_seen') || '';
let pollTimer: number | undefined;

async function pollNotify() {
  try {
    const r = await api.adminNotify(lastSeen);
    const fresh = (r.newOrders || []).filter((o) => !lastSeen || o.createdAt > lastSeen);
    if (lastSeen && fresh.length) {
      newOrderCount.value += fresh.length;
      const o = fresh[0];
      toast.push(
        `🔔 新订单提醒：${o.orderNo}，金额 ¥${o.total}${fresh.length > 1 ? `（另有 ${fresh.length - 1} 笔新订单）` : ''}`,
        'success',
      );
    }
    pendingRefunds.value = r.pendingRefunds || 0;
    lastSeen = r.now;
    localStorage.setItem('aimall_notify_seen', lastSeen);
  } catch { /* 轮询失败静默，不打扰操作 */ }
}

onMounted(() => {
  pollNotify();
  pollTimer = window.setInterval(pollNotify, 15000);
});
onUnmounted(() => clearInterval(pollTimer));
watch(() => route.path, (p) => {
  if (p === '/admin/orders') newOrderCount.value = 0;
});

function logout() {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="admin" :class="{ collapsed }">
    <aside class="sidebar">
      <div class="side-brand">
        <div class="brand-mark">八</div>
        <span v-show="!collapsed" class="brand-text">AI Mall · 商家</span>
      </div>

      <nav class="side-nav">
        <div v-for="g in NAV" :key="g.group" class="nav-group">
          <div v-show="!collapsed" class="nav-group-label">{{ g.group }}</div>
          <router-link
            v-for="it in g.items"
            :key="it.to"
            :to="it.to"
            class="nav-item"
            :class="{ active: route.path === it.to }"
            :title="it.label"
          >
            <span class="nav-icon">{{ it.icon }}</span>
            <span v-show="!collapsed" class="nav-label">{{ it.label }}</span>
            <span
              v-if="it.to === '/admin/orders' && newOrderCount"
              class="nav-badge"
              :title="`${newOrderCount} 笔新订单`"
            >{{ newOrderCount > 99 ? '99+' : newOrderCount }}</span>
            <span
              v-else-if="it.to === '/admin/refunds' && pendingRefunds"
              class="nav-badge warn"
              :title="`${pendingRefunds} 笔退款待审核`"
            >{{ pendingRefunds > 99 ? '99+' : pendingRefunds }}</span>
          </router-link>
        </div>
      </nav>

      <div class="side-foot">
        <router-link to="/shop" class="nav-item" title="返回商城">
          <span class="nav-icon">⌂</span>
          <span v-show="!collapsed" class="nav-label">返回商城</span>
        </router-link>
      </div>
    </aside>

    <div class="main-wrap">
      <header class="topbar">
        <div class="row gap-12">
          <button class="collapse-btn" :aria-label="collapsed ? '展开侧栏' : '收起侧栏'" @click="collapsed = !collapsed">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 class="topbar-title">{{ title }}</h1>
        </div>
        <div class="row gap-12">
          <div class="user-chip">
            <div class="avatar">{{ auth.user?.name?.[0] || 'M' }}</div>
            <div class="user-meta">
              <div class="user-name">{{ auth.user?.name }}</div>
              <div class="user-role">商家账号</div>
            </div>
          </div>
          <button class="logout-btn" @click="logout">退出</button>
        </div>
      </header>

      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin { display: flex; min-height: 100vh; background: var(--bg); }

.sidebar {
  width: 208px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  transition: width 0.2s var(--ease);
  position: sticky;
  top: 0;
  height: 100vh;
}
.collapsed .sidebar { width: 60px; }

.side-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 58px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  overflow: hidden;
}
.brand-mark {
  width: 26px; height: 26px;
  flex-shrink: 0;
  background: var(--text);
  color: #fff;
  border-radius: 7px;
  display: grid; place-items: center;
  font-size: 13px;
  font-weight: 600;
}
.brand-text { font-size: 13px; font-weight: 600; white-space: nowrap; }

.side-nav { flex: 1; padding: 12px 8px; overflow-y: auto; }
.nav-group { margin-bottom: 16px; }
.nav-group-label { font-size: 11px; color: var(--text-3); padding: 0 8px 6px; letter-spacing: 0.02em; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 8px;
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 2px;
  transition: all 0.14s;
  white-space: nowrap;
  overflow: hidden;
}
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item.active { background: var(--primary-soft); color: var(--primary); font-weight: 500; }
.nav-icon { width: 18px; text-align: center; font-size: 13px; flex-shrink: 0; }
.nav-badge {
  margin-left: auto;
  min-width: 18px; height: 18px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--danger, #e5484d); color: #fff;
  font-size: 10px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}
.nav-badge.warn { background: #f59e0b; }

.side-foot { padding: 8px; border-top: 1px solid var(--line); }

.main-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  height: 58px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  position: sticky;
  top: 0;
  z-index: 50;
}
.collapse-btn {
  width: 30px; height: 30px;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 6px;
  color: var(--text-2);
  display: grid; place-items: center;
}
.collapse-btn:hover { background: var(--surface-2); }
.topbar-title { font-size: 16px; font-weight: 600; margin: 0; }

.user-chip { display: flex; align-items: center; gap: 8px; }
.avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--primary);
  display: grid; place-items: center;
  font-size: 12px;
  font-weight: 600;
}
.user-meta { line-height: 1.3; }
.user-name { font-size: 12px; font-weight: 500; }
.user-role { font-size: 10px; color: var(--text-3); }
.logout-btn {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 6px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--text-2);
}
.logout-btn:hover { border-color: var(--danger); color: var(--danger); }

.content { padding: 24px 24px 56px; flex: 1; }

@media (max-width: 768px) {
  .sidebar { position: fixed; z-index: 60; transform: translateX(-100%); transition: transform 0.2s; }
  .admin:not(.collapsed) .sidebar { transform: none; }
  .user-meta { display: none; }
}
</style>
