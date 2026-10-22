<script setup lang="ts">
import { ref, nextTick, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { useAuth, useToast } from '../store';
import type { ChatMessage, ChatResult } from '../api/types';

type Scene = 'shopping' | 'support';

const SCENES: Record<Scene, {
  label: string; icon: string; greeting: string; chips: string[];
  /** 能力边界：入口即明示"能办什么、办不了什么"，避免绕圈后才发现不行 */
  can: string[]; cannot: string[];
}> = {
  shopping: {
    label: '智能导购',
    icon: '✨',
    greeting: '告诉我预算和使用场景，我帮你挑合适的。每条推荐我都会说明为什么选它。',
    chips: ['300 元以内适合通勤的耳机', '送女朋友的礼物，200 左右', '想买个不吵的风扇'],
    can: ['按预算 / 场景挑商品', '对比同类差异与价格', '解释某件商品推荐给你的理由'],
    cannot: ['替你下单付款', '承诺未标明的优惠'],
  },
  support: {
    label: 'AI 客服',
    icon: '🎧',
    greeting: '订单、物流、退换货都可以问我。能直接办的我会当场办掉，办不了的我会立刻告诉你该找谁。',
    chips: ['我上一个订单到哪了', '运费怎么算', '这个订单我要退款'],
    can: ['查订单与物流状态', '判断是否符合退货条件', '直接提交退款申请'],
    cannot: ['修改已发货订单的地址', '处理支付失败的资金问题（需转人工）'],
  },
};

const route = useRoute();
const auth = useAuth();
const toast = useToast();

const open = ref(false);
const scene = ref<Scene>('shopping');
const input = ref('');
const sending = ref(false);
const messages = ref<ChatMessage[]>([]);
const conversationId = ref<number | undefined>();
const mode = ref<'local' | 'remote'>('local');
const aiEnabled = ref(false);
const expandedTrace = ref<Record<number, boolean>>({});
const bodyEl = ref<HTMLElement>();
const inputEl = ref<HTMLInputElement>();
const handoffOpen = ref(false);
const handoffText = ref('');
const handoffBusy = ref(false);

const current = computed(() => SCENES[scene.value]);
const needLogin = computed(() => scene.value === 'support' && !auth.isLoggedIn);

onMounted(async () => {
  try {
    const meta = await api.meta();
    aiEnabled.value = meta.ai.enabled;
  } catch { /* ignore */ }
});

function switchScene(s: Scene) {
  if (s === scene.value) return;
  scene.value = s;
  messages.value = [];
  conversationId.value = undefined;
  boot();
}

function boot() {
  messages.value = [{
    role: 'assistant',
    content: needLogin.value
      ? '查询订单和办理退款需要先登录。你可以先去登录，商品推荐不受影响。'
      : current.value.greeting,
  }];
}

async function scrollBottom() {
  await nextTick();
  if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight;
}

async function send(text?: string) {
  const content = (text ?? input.value).trim();
  if (!content || sending.value) return;
  input.value = '';
  messages.value.push({ role: 'user', content });
  const pendingIdx = messages.value.length;
  messages.value.push({ role: 'assistant', content: '', pending: true });
  sending.value = true;
  scrollBottom();

  try {
    const r: ChatResult = await api.chat({ scene: scene.value, text: content, conversationId: conversationId.value });
    conversationId.value = r.conversationId;
    mode.value = r.mode;
    messages.value[pendingIdx] = {
      id: r.messageId,
      role: 'assistant',
      content: r.content,
      toolTrace: r.toolTrace,
      latency: r.latency,
    };
    if (r.toolTrace?.length) expandedTrace.value = { ...expandedTrace.value, [pendingIdx]: false };
  } catch (e: any) {
    messages.value[pendingIdx] = { role: 'assistant', content: `抱歉，出了点问题：${e.message}` };
  } finally {
    sending.value = false;
    scrollBottom();
  }
}

function toggleTrace(i: number) {
  expandedTrace.value = { ...expandedTrace.value, [i]: !expandedTrace.value[i] };
}

async function rate(msg: ChatMessage, n: number) {
  if (!msg.id) return;
  try {
    await api.rate(msg.id, n);
    toast.push('感谢反馈', 'success');
  } catch { /* ignore */ }
}

function openDrawer() {
  open.value = true;
  if (!messages.value.length) boot();
  nextTick(() => inputEl.value?.focus());
}

function openHandoff() {
  if (!auth.isLoggedIn) {
    toast.push('转人工需要先登录，方便商家联系你', 'error');
    return;
  }
  const lastUser = [...messages.value].reverse().find((m) => m.role === 'user');
  handoffText.value = lastUser?.content || '需要人工客服协助处理问题';
  handoffOpen.value = true;
}

async function submitHandoff() {
  const summary = handoffText.value.trim();
  if (summary.length < 2) { toast.push('请简单描述需要人工处理的问题', 'error'); return; }
  handoffBusy.value = true;
  try {
    const r = await api.handoff({ conversationId: conversationId.value, summary, contact: auth.user?.email });
    handoffOpen.value = false;
    messages.value.push({
      role: 'assistant',
      content: r.duplicate
        ? '这条会话已经有一条待处理的人工工单了，商家会尽快联系你。'
        : `已为你提交人工工单 #${r.id}，商家会在后台看到这条会话和你的联系方式。`,
    });
    toast.push('已转人工', 'success');
    scrollBottom();
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    handoffBusy.value = false;
  }
}

const TOOL_LABEL: Record<string, string> = {
  search_products: '检索商品',
  get_product_detail: '读取商品详情',
  get_my_orders: '查询我的订单',
  get_order_detail: '查询订单详情',
  check_return_eligibility: '校验退款资格',
  create_refund_request: '提交退款申请',
  search_kb: '检索知识库',
};
</script>

<template>
  <!-- 悬浮球 -->
  <button v-show="!open" class="fab" aria-label="打开 AI 助手" @click="openDrawer">
    <span class="fab-icon">✦</span>
    <span class="fab-text">AI 助手</span>
  </button>

  <!-- 抽屉 -->
  <transition name="drawer">
    <aside v-if="open" class="drawer" role="dialog" aria-label="AI 助手">
      <header class="drawer-head">
        <div class="head-left">
          <div class="ai-avatar">✦</div>
          <div>
            <div class="head-title">小八 · {{ current.label }}</div>
            <div class="head-sub">
              <span class="dot" :class="aiEnabled ? 'dot-on' : 'dot-local'" />
              {{ aiEnabled ? '已连接大模型' : '本地引擎模式' }}
            </div>
          </div>
        </div>
        <div class="head-actions">
          <button v-if="scene === 'support'" class="handoff-btn" @click="openHandoff">转人工</button>
          <button class="close-btn" aria-label="关闭" @click="open = false">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      <div class="scene-switch">
        <button
          v-for="(cfg, key) in SCENES"
          :key="key"
          class="scene-btn"
          :class="{ active: scene === key }"
          @click="switchScene(key as Scene)"
        >
          <span>{{ cfg.icon }}</span>{{ cfg.label }}
        </button>
      </div>

      <div ref="bodyEl" class="drawer-body">
        <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
          <div v-if="m.role === 'assistant'" class="msg-badge">AI</div>
          <div class="bubble-wrap">
            <div v-if="m.pending" class="bubble bubble-ai typing">
              <span /><span /><span />
            </div>
            <template v-else>
              <div class="bubble" :class="m.role === 'user' ? 'bubble-user' : 'bubble-ai'">
                <pre class="bubble-text">{{ m.content }}</pre>
              </div>

              <!-- 工具调用轨迹 -->
              <div v-if="m.toolTrace?.length" class="trace">
                <button class="trace-toggle" @click="toggleTrace(i)">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"
                       :style="{ transform: expandedTrace[i] ? 'rotate(90deg)' : 'none' }">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  调用了 {{ m.toolTrace.length }} 个工具 · {{ m.latency }}ms
                </button>
                <transition name="fade">
                  <div v-if="expandedTrace[i]" class="trace-list">
                    <div v-for="(t, ti) in m.toolTrace" :key="ti" class="trace-item">
                      <span class="trace-name mono">{{ TOOL_LABEL[t.name] || t.name }}</span>
                      <span class="trace-arg mono">{{ JSON.stringify(t.args) }}</span>
                      <span class="trace-status" :class="t.ok ? 'ok' : 'fail'">{{ t.ok ? `${t.ms}ms` : '失败' }}</span>
                    </div>
                  </div>
                </transition>
              </div>

              <div v-if="m.role === 'assistant' && m.id" class="rate-row">
                <button class="rate-btn" title="有用" @click="rate(m, 5)">👍</button>
                <button class="rate-btn" title="没用" @click="rate(m, 1)">👎</button>
              </div>
            </template>
          </div>
        </div>

        <div v-if="messages.length === 1" class="chips">
          <button v-for="c in current.chips" :key="c" class="chip" @click="send(c)">{{ c }}</button>
        </div>

        <!-- 能力边界明示：先说清能办什么、办不了什么，比绕三圈再转人工体验好得多 -->
        <div v-if="messages.length === 1" class="cap-card">
          <div class="cap-col">
            <div class="cap-head cap-yes">✓ 我可以直接帮你</div>
            <ul class="cap-list">
              <li v-for="c in current.can" :key="c">{{ c }}</li>
            </ul>
          </div>
          <div class="cap-col">
            <div class="cap-head cap-no">· 这些我办不了</div>
            <ul class="cap-list cap-list-no">
              <li v-for="c in current.cannot" :key="c">{{ c }}</li>
            </ul>
          </div>
        </div>
      </div>

      <footer class="drawer-foot">
        <div v-if="needLogin" class="login-hint">
          未登录：可咨询商品，订单类问题需
          <router-link to="/login" @click="open = false">登录</router-link>
        </div>
        <div class="input-row">
          <input
            ref="inputEl"
            v-model="input"
            class="chat-input"
            :placeholder="`问点什么…（${current.label}）`"
            :disabled="sending"
            @keyup.enter="send()"
          />
          <button class="send-btn" :disabled="!input.trim() || sending" aria-label="发送" @click="send()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 12l16-8-6 8 6 8z" />
            </svg>
          </button>
        </div>
        <div class="foot-note">
          {{ route.name === 'product' ? '当前在商品页，可直接问我这件商品' : 'AI 可能出错，重要信息请核对' }}
        </div>
      </footer>

      <!-- 转人工：落工单，商家后台「人工工单」可处理 -->
      <div v-if="handoffOpen" class="handoff-mask" @click.self="handoffOpen = false">
        <div class="handoff-modal">
          <h3 class="handoff-title">转人工客服</h3>
          <p class="handoff-hint">提交后会生成工单，商家可在后台看到当前会话与你的联系方式。</p>
          <textarea v-model="handoffText" class="handoff-text" rows="3" maxlength="300" placeholder="简单描述需要人工处理的问题" />
          <div class="handoff-actions">
            <button class="handoff-cancel" @click="handoffOpen = false">取消</button>
            <button class="handoff-submit" :disabled="handoffBusy" @click="submitHandoff">
              {{ handoffBusy ? '提交中…' : '提交工单' }}
            </button>
          </div>
        </div>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
.fab {
  position: fixed;
  right: 24px; bottom: 24px;
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 18px;
  border: 1px solid var(--ai);
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--ai);
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 4px 20px rgba(107, 78, 245, 0.18);
  transition: transform 0.18s var(--ease), box-shadow 0.18s;
}
.fab:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(107, 78, 245, 0.26); }
.fab-icon { font-size: 15px; }

.drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 420px;
  max-width: 100vw;
  z-index: 400;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--line);
  box-shadow: -12px 0 40px rgba(16, 24, 40, 0.1);
}
.drawer-enter-active, .drawer-leave-active { transition: transform 0.3s var(--ease); }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.head-left { display: flex; align-items: center; gap: 10px; }
.head-actions { display: flex; align-items: center; gap: 8px; }
.handoff-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12px;
}
.handoff-btn:hover { border-color: var(--primary); color: var(--primary); }
.handoff-mask {
  position: absolute; inset: 0;
  background: rgba(16, 24, 40, 0.42);
  display: grid; place-items: center;
  padding: 16px; z-index: 10;
}
.handoff-modal {
  width: 100%;
  background: var(--surface);
  border-radius: var(--r-md);
  padding: 18px;
  box-shadow: 0 16px 40px rgba(16, 24, 40, 0.18);
}
.handoff-title { font-size: 15px; font-weight: 600; margin: 0 0 6px; }
.handoff-hint { font-size: 12px; color: var(--text-2); line-height: 1.6; margin: 0 0 10px; }
.handoff-text {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 10px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  background: var(--surface);
  color: var(--text);
}
.handoff-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.handoff-cancel, .handoff-submit {
  height: 32px; padding: 0 14px;
  border-radius: var(--r-sm);
  font-size: 13px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text-2);
}
.handoff-submit { background: var(--primary); border-color: var(--primary); color: #fff; }
.handoff-submit:disabled { opacity: 0.6; }
.ai-avatar {
  width: 34px; height: 34px;
  border-radius: 10px;
  background: var(--ai-soft);
  color: var(--ai);
  display: grid; place-items: center;
  font-size: 15px;
}
.head-title { font-size: 14px; font-weight: 600; }
.head-sub { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-3); }
.dot { width: 5px; height: 5px; border-radius: 50%; }
.dot-on { background: var(--success); }
.dot-local { background: var(--warning); }

.close-btn {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  border: 0; background: transparent;
  border-radius: 6px; color: var(--text-2);
}
.close-btn:hover { background: var(--surface-2); }

.scene-switch {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
}
.scene-btn {
  flex: 1;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  font-size: 12px;
  color: var(--text-2);
  display: flex; align-items: center; justify-content: center; gap: 4px;
  transition: all 0.16s;
}
.scene-btn:hover { background: var(--surface); }
.scene-btn.active {
  background: var(--surface);
  border-color: var(--line-strong);
  color: var(--text);
  font-weight: 500;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.msg { display: flex; gap: 8px; }
.msg.user { justify-content: flex-end; }
.msg-badge {
  width: 20px; height: 20px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--ai-soft);
  color: var(--ai);
  font-size: 10px;
  font-weight: 700;
  display: grid; place-items: center;
  margin-top: 2px;
}
.bubble-wrap { max-width: 300px; display: flex; flex-direction: column; gap: 6px; }
.msg.user .bubble-wrap { align-items: flex-end; }

.bubble { padding: 10px 13px; border-radius: 12px; font-size: 13px; line-height: 1.65; }
.bubble-ai {
  background: var(--ai-soft);
  color: var(--text);
  border-top-left-radius: 4px;
}
.bubble-user {
  background: var(--primary);
  color: #fff;
  border-top-right-radius: 4px;
}
.bubble-text { margin: 0; font-family: inherit; white-space: pre-wrap; word-break: break-word; }

.typing { display: flex; gap: 4px; align-items: center; height: 18px; }
.typing span {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--ai);
  opacity: 0.4;
  animation: bounce 1.1s infinite;
}
.typing span:nth-child(2) { animation-delay: 0.15s; }
.typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

.trace { font-size: 11px; }
.trace-toggle {
  display: flex; align-items: center; gap: 4px;
  border: 0; background: transparent;
  color: var(--text-3);
  padding: 2px 0;
  font-size: 11px;
}
.trace-toggle:hover { color: var(--ai); }
.trace-list {
  margin-top: 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  padding: 8px;
  display: flex; flex-direction: column; gap: 6px;
}
.trace-item { display: flex; align-items: center; gap: 8px; }
.trace-name { color: var(--text-2); font-size: 11px; white-space: nowrap; }
.trace-arg {
  flex: 1;
  color: var(--text-3);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trace-status { font-size: 10px; }
.trace-status.ok { color: var(--success); }
.trace-status.fail { color: var(--danger); }

.rate-row { display: flex; gap: 4px; opacity: 0.55; transition: opacity 0.16s; }
.rate-row:hover { opacity: 1; }
.rate-btn {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 6px;
  font-size: 11px;
  padding: 1px 6px;
  line-height: 1.4;
}
.rate-btn:hover { border-color: var(--line-strong); }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }

/* 能力边界卡片 */
.cap-card {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cap-col { font-size: 12px; }
.cap-head { font-weight: 600; font-size: 11px; margin-bottom: 4px; }
.cap-yes { color: var(--success); }
.cap-no { color: var(--text-3); }
.cap-list { margin: 0; padding-left: 15px; color: var(--text-2); line-height: 1.7; }
.cap-list-no { color: var(--text-3); }
.chip {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: var(--r-full);
  padding: 5px 12px;
  font-size: 12px;
  color: var(--text-2);
  transition: all 0.16s;
}
.chip:hover { border-color: var(--ai); color: var(--ai); background: var(--ai-soft); }

.drawer-foot { border-top: 1px solid var(--line); padding: 12px 16px 10px; }
.login-hint {
  font-size: 11px;
  color: var(--warning);
  background: var(--warning-soft);
  padding: 6px 10px;
  border-radius: 6px;
  margin-bottom: 8px;
}
.login-hint a { color: var(--warning); text-decoration: underline; }
.input-row { display: flex; gap: 8px; }
.chat-input {
  flex: 1;
  height: 38px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-full);
  background: var(--surface-2);
  outline: none;
  font-size: 13px;
  transition: all 0.16s;
}
.chat-input:focus { background: var(--surface); border-color: var(--ai); box-shadow: 0 0 0 3px rgba(107, 78, 245, 0.1); }
.send-btn {
  width: 38px; height: 38px;
  border: 0;
  border-radius: 50%;
  background: var(--ai);
  color: #fff;
  display: grid; place-items: center;
  transition: opacity 0.16s;
}
.send-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.foot-note { font-size: 10px; color: var(--text-3); text-align: center; margin-top: 8px; }

@media (max-width: 640px) {
  .drawer { width: 100%; }
  .fab { right: 16px; bottom: 16px; padding: 0 14px; }
}
</style>
