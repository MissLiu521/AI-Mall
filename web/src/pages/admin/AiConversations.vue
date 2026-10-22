<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';
import type { Conversation } from '../../api/types';
import { formatTime } from '../../utils/format';
import { traceDesc } from '../../lib/ai-trace';

const toast = useToast();
const convs = ref<Conversation[]>([]);
const msgs = ref<any[]>([]);
const activeId = ref<number | null>(null);
const scene = ref('');
const loading = ref(true);

const SCENE_LABEL: Record<string, string> = { shopping: '智能导购', support: 'AI 客服', ops: '运营智能体' };
const SCENE_TONE: Record<string, string> = { shopping: 'badge-primary', support: 'badge-ai', ops: 'badge-warning' };

async function load() {
  loading.value = true;
  try {
    convs.value = await api.aiConversations(scene.value || undefined);
    if (convs.value.length && !activeId.value) await select(convs.value[0].id);
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}
onMounted(load);

async function select(id: number) {
  activeId.value = id;
  try { msgs.value = await api.aiMessages(id); } catch (e: any) { toast.push(e.message, 'error'); }
}

const active = computed(() => convs.value.find((c) => c.id === activeId.value));

function switchScene(s: string) {
  scene.value = s;
  activeId.value = null;
  msgs.value = [];
  load();
}
</script>

<template>
  <div class="page">
    <div class="tabs">
      <button class="tab" :class="{ active: !scene }" @click="switchScene('')">全部</button>
      <button v-for="(l, k) in SCENE_LABEL" :key="k" class="tab" :class="{ active: scene === k }" @click="switchScene(k)">
        {{ l }}
      </button>
    </div>

    <div class="split">
      <div class="conv-list card">
        <div v-if="loading" class="dim" style="padding: 20px; text-align: center">加载中…</div>
        <div v-else-if="!convs.length" class="empty">还没有 AI 会话</div>
        <button
          v-for="c in convs"
          :key="c.id"
          class="conv-item"
          :class="{ active: c.id === activeId }"
          @click="select(c.id)"
        >
          <div class="conv-top">
            <span class="badge" :class="SCENE_TONE[c.scene]">{{ SCENE_LABEL[c.scene] || c.scene }}</span>
            <span class="dim mono" style="font-size: 10px">{{ c.messageCount }} 条</span>
          </div>
          <div class="conv-title">会话 #{{ c.id }} · {{ c.title }}</div>
          <div class="conv-time dim mono">{{ formatTime(c.createdAt) }}</div>
        </button>
      </div>

      <div class="chat card">
        <div v-if="!active" class="empty">
          <div class="empty-icon">💬</div>
          选择左侧会话查看详情
        </div>
        <template v-else>
          <header class="chat-head">
            <div>
              <div class="chat-title">会话 #{{ active.id }}</div>
              <div class="dim" style="font-size: 11px">
                {{ SCENE_LABEL[active.scene] }} · {{ active.mode === 'remote' ? '远端模型' : '本地引擎' }} · {{ formatTime(active.createdAt) }}
                <span v-if="active.handoff" class="badge badge-warning" style="margin-left: 6px">已转人工</span>
              </div>
            </div>
            <span class="badge" :class="SCENE_TONE[active.scene]">{{ SCENE_LABEL[active.scene] }}</span>
          </header>

          <div class="chat-body">
            <div v-for="m in msgs" :key="m.id" class="msg" :class="m.role">
              <div class="role-tag">{{ m.role === 'user' ? '用户' : 'AI' }}</div>
              <div class="bubble">{{ m.content }}</div>
              <div v-if="m.toolTrace?.length" class="trace">
                <span class="trace-title">AI 工作过程</span>
                <span v-for="(t, i) in m.toolTrace" :key="i" class="trace-chip">
                  {{ traceDesc(t) }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; height: calc(100vh - 110px); }
.tabs { display: flex; gap: 4px; }
.tab {
  height: 30px; padding: 0 12px;
  border: 1px solid transparent; background: transparent;
  border-radius: var(--r-sm); font-size: 13px; color: var(--text-2);
}
.tab:hover { background: var(--surface); }
.tab.active { background: var(--surface); border-color: var(--line); color: var(--text); font-weight: 500; }

.split { flex: 1; display: grid; grid-template-columns: 280px 1fr; gap: 14px; min-height: 0; }
.conv-list { overflow-y: auto; padding: 8px; }
.conv-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--r-sm);
  padding: 10px;
  margin-bottom: 4px;
  transition: all 0.14s;
}
.conv-item:hover { background: var(--surface-2); }
.conv-item.active { background: var(--primary-soft); border-color: #cbd6fb; }
.conv-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
.conv-title { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-time { font-size: 10px; margin-top: 3px; }

.chat { display: flex; flex-direction: column; min-height: 0; }
.chat-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
.chat-title { font-size: 14px; font-weight: 600; }
.chat-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }

.msg { display: flex; flex-direction: column; gap: 5px; max-width: 90%; }
.msg.user { align-self: flex-end; align-items: flex-end; }
.role-tag {
  font-size: 10px;
  color: var(--text-3);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.bubble {
  padding: 10px 13px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  background: var(--surface-2);
}
.msg.user .bubble { background: var(--primary); color: #fff; }
.msg.assistant .bubble { background: var(--ai-soft); }
.trace {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  padding: 6px 8px;
  background: var(--surface-2);
  border-radius: 6px;
  font-size: 11px;
}
.trace-title { color: var(--text-3); }
.trace-chip {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--text-2);
}</style>
