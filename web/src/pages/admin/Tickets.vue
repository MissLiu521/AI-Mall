<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';
import type { SupportTicket } from '../../api/types';
import { formatTime } from '../../utils/format';

const toast = useToast();
const list = ref<SupportTicket[]>([]);
const loading = ref(true);
const filter = ref<'open' | 'resolved' | ''>('open');
const busy = ref<number | null>(null);

async function load() {
  loading.value = true;
  try { list.value = await api.tickets({ status: filter.value, pageSize: 100 }); }
  catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}
onMounted(load);

function switchTab(v: 'open' | 'resolved' | '') { filter.value = v; load(); }

async function resolve(t: SupportTicket) {
  const reply = window.prompt('给用户的处理结果（可留空，仅标记已处理）', '已为你转接人工，稍后会有同学联系你');
  if (reply === null) return;
  busy.value = t.id;
  try {
    await api.resolveTicket(t.id, reply);
    toast.push('工单已处理', 'success');
    await load();
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { busy.value = null; }
}
</script>

<template>
  <div class="page">
    <div class="hint-bar">
      AI 客服判断需要人工介入时会在这里生成工单，包含用户的会话与联系方式。
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: filter === 'open' }" @click="switchTab('open')">待处理</button>
      <button class="tab" :class="{ active: filter === 'resolved' }" @click="switchTab('resolved')">已处理</button>
      <button class="tab" :class="{ active: filter === '' }" @click="switchTab('')">全部</button>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 60px">ID</th>
            <th style="width: 140px">用户</th>
            <th>问题描述</th>
            <th style="width: 160px">联系方式</th>
            <th style="width: 150px">提交时间</th>
            <th style="width: 90px">状态</th>
            <th style="width: 100px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="7" class="dim" style="text-align: center; padding: 40px">加载中…</td></tr>
          <tr v-else-if="!list.length"><td colspan="7" class="empty">暂无工单</td></tr>
          <tr v-for="t in list" v-else :key="t.id">
            <td class="mono dim">{{ t.id }}</td>
            <td>
              <div style="font-size: 13px">{{ t.userName }}</div>
              <div class="dim" style="font-size: 11px">{{ t.userEmail || '—' }}</div>
            </td>
            <td style="font-size: 12px">
              <div>{{ t.summary }}</div>
              <div v-if="t.reply" class="reply">回复：{{ t.reply }}</div>
            </td>
            <td class="mono" style="font-size: 11px">{{ t.contact || '—' }}</td>
            <td class="dim mono" style="font-size: 11px">{{ formatTime(t.createdAt) }}</td>
            <td>
              <span class="badge" :class="t.status === 'open' ? 'badge-warning' : 'badge-success'">
                {{ t.status === 'open' ? '待处理' : '已处理' }}
              </span>
            </td>
            <td>
              <button v-if="t.status === 'open'" class="btn btn-primary btn-sm" :disabled="busy === t.id" @click="resolve(t)">处理</button>
              <span v-else class="dim" style="font-size: 12px">{{ formatTime(t.resolvedAt) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.hint-bar {
  font-size: 12px; color: var(--text-2);
  background: var(--primary-soft);
  border-radius: var(--r-sm);
  padding: 10px 14px;
}
.tabs { display: flex; gap: 4px; }
.tab {
  height: 30px; padding: 0 12px;
  border: 1px solid transparent; background: transparent;
  border-radius: var(--r-sm); font-size: 13px; color: var(--text-2);
}
.tab:hover { background: var(--surface); }
.tab.active { background: var(--surface); border-color: var(--line); color: var(--text); font-weight: 500; }
.reply { margin-top: 4px; color: var(--text-2); font-size: 11px; }
</style>
