<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';
import type { ChatMessage } from '../../api/types';
import { TOOL_LABEL, traceDesc } from '../../lib/ai-trace';

const toast = useToast();
const messages = ref<ChatMessage[]>([]);
const input = ref('');
const sending = ref(false);
const convId = ref<number | undefined>();
const expanded = ref<Record<number, boolean>>({});
const bodyEl = ref<HTMLElement>();

const PRESETS = [
  { label: '诊断滞销商品', text: '看下滞销品，给点建议' },
  { label: '生成商品文案', text: '给 1 号商品写一版文案' },
  { label: '汇总经营数据', text: '最近卖得怎么样' },
];

async function scrollBottom() {
  await nextTick();
  if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight;
}

async function send(text?: string) {
  const content = (text ?? input.value).trim();
  if (!content || sending.value) return;
  input.value = '';
  messages.value.push({ role: 'user', content });
  const idx = messages.value.length;
  messages.value.push({ role: 'assistant', content: '', pending: true });
  sending.value = true;
  scrollBottom();

  try {
    const r = await api.ops(content, convId.value);
    convId.value = r.conversationId;
    messages.value[idx] = {
      id: r.messageId, role: 'assistant', content: r.content, toolTrace: r.toolTrace, latency: r.latency,
    };
  } catch (e: any) {
    messages.value[idx] = { role: 'assistant', content: `出错了：${e.message}` };
  } finally {
    sending.value = false;
    scrollBottom();
  }
}

async function applyDraft(i: number) {
  const m = messages.value[i];
  if (!m.id) return;
  // 取上一条用户消息里的商品 ID
  const prev = messages.value[i - 1]?.content || '';
  const pid = Number(prev.match(/(\d+)\s*(号|id)/i)?.[1] || 0);
  try {
    // 通过后端工具写回：直接把 AI 文案应用
    const match = m.content.match(/【副标题】(.+)\n[\s\S]*?【详情】(.+)/);
    if (!pid || !match) { toast.push('请再明确说"给 X 号商品写文案"，我才能写回', 'error'); return; }
    await api.applyDraft({ productId: pid, subtitle: match[1].trim(), description: match[2].trim() });
    toast.push('文案已写回商品', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
}
</script>

<template>
  <div class="page">
    <div class="intro card card-pad">
      <div class="row gap-12">
        <div class="ai-icon">✦</div>
        <div class="grow">
          <h2 class="intro-title">运营智能体</h2>
          <p class="intro-desc">
            基于店内真实数据工作：读取销量与库存 → 分析问题 → 产出可直接使用的文案。所有操作都会在工具轨迹中留痕。
          </p>
        </div>
      </div>
      <div class="presets">
        <button v-for="p in PRESETS" :key="p.label" class="preset" @click="send(p.text)">
          <span class="preset-dot" />{{ p.label }}
        </button>
      </div>
    </div>

    <div ref="bodyEl" class="chat">
      <div v-if="!messages.length" class="empty">
        <div class="empty-icon">⚙️</div>
        <p>给智能体一个目标</p>
        <p class="dim" style="font-size: 12px; margin-top: 6px">例如「看下滞销品，给销量最差的那个写一版新文案」</p>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div v-if="m.role === 'assistant'" class="ai-tag">✦</div>
        <div class="msg-body">
          <div v-if="m.pending" class="bubble bubble-ai typing"><span /><span /><span /></div>
          <template v-else>
            <pre class="bubble" :class="m.role === 'user' ? 'bubble-user' : 'bubble-ai'">{{ m.content }}</pre>
            <div v-if="m.toolTrace?.length" class="trace-box">
              <div class="trace-head" @click="expanded = { ...expanded, [i]: !expanded[i] }">
                <span>工具轨迹 · {{ m.toolTrace.length }} 次 · {{ m.latency }}ms</span>
              </div>
              <div v-if="expanded[i] !== false" class="trace-list">
                <div v-for="(t, ti) in m.toolTrace" :key="ti" class="trace-row">
                  <span class="t-name">{{ TOOL_LABEL[t.name] || t.name }}</span>
                  <span class="t-arg" :title="JSON.stringify(t.args)">{{ t.ok ? traceDesc(t) : (t.error || '执行失败') }}</span>
                  <span :class="t.ok ? 't-ok' : 't-fail'">{{ t.ok ? t.ms + 'ms' : '失败' }}</span>
                </div>
              </div>
            </div>
            <div v-if="m.role === 'assistant' && m.content.includes('【副标题】')" class="draft-actions">
              <button class="btn btn-ai btn-sm" @click="applyDraft(i)">应用到商品</button>
              <span class="dim" style="font-size: 11px">将把副标题与详情写回该商品</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div class="composer">
      <input
        v-model="input"
        class="input"
        placeholder="给智能体下指令，例如：给 3 号商品写一版更口语的文案"
        :disabled="sending"
        @keyup.enter="send()"
      />
      <button class="btn btn-ai" :disabled="sending || !input.trim()" @click="send()">执行</button>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; height: calc(100vh - 110px); }

.intro { border-color: #ddd6fb; background: linear-gradient(180deg, #fbfaff 0%, #fff 100%); }
.ai-icon {
  width: 38px; height: 38px;
  border-radius: 11px;
  background: var(--ai-soft);
  color: var(--ai);
  display: grid; place-items: center;
  font-size: 17px;
  flex-shrink: 0;
}
.intro-title { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
.intro-desc { font-size: 12px; color: var(--text-2); line-height: 1.6; margin: 0; }
.presets { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.preset {
  display: flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  background: var(--surface);
  font-size: 12px;
  color: var(--text-2);
  transition: all 0.16s;
}
.preset:hover { border-color: var(--ai); color: var(--ai); background: var(--ai-soft); }
.preset-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ai); }

.chat {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 6px 2px;
}
.msg { display: flex; gap: 10px; max-width: 78%; }
.msg.user { align-self: flex-end; flex-direction: row-reverse; }
.ai-tag {
  width: 26px; height: 26px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--ai-soft);
  color: var(--ai);
  display: grid; place-items: center;
  font-size: 12px;
}
.msg-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.bubble {
  padding: 11px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: inherit;
}
.bubble-ai { background: var(--surface); border: 1px solid var(--line); border-top-left-radius: 4px; }
.bubble-user { background: var(--primary); color: #fff; border-top-right-radius: 4px; }

.typing { display: flex; gap: 4px; align-items: center; height: 18px; }
.typing span { width: 5px; height: 5px; border-radius: 50%; background: var(--ai); opacity: 0.4; animation: b 1.1s infinite; }
.typing span:nth-child(2) { animation-delay: 0.15s; }
.typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes b { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }

.trace-box { border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); overflow: hidden; }
.trace-head {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-3);
  cursor: pointer;
  background: var(--surface-2);
}
.trace-head:hover { color: var(--text-2); }
.trace-list { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
.trace-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.t-name { color: var(--text-2); white-space: nowrap; }
.t-arg { flex: 1; color: var(--text-3); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-ok { color: var(--success); font-size: 10px; }
.t-fail { color: var(--danger); font-size: 10px; }

.draft-actions { display: flex; align-items: center; gap: 8px; }

.composer { display: flex; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px; }
</style>
