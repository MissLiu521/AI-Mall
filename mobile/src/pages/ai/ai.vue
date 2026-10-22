<template>
  <view class="page">
    <!-- 自定义头部（navigationStyle: custom） -->
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <view class="nav-back" @tap="goBack">
          <text class="chev">‹</text>
        </view>
        <view class="nav-mid">
          <view class="nav-title">AI 助手</view>
          <view class="nav-sub">{{ sceneMeta[scene].desc }}</view>
        </view>
        <view class="nav-actions">
          <text v-if="scene === 'support'" class="nav-link" @tap="openHandoff">转人工</text>
          <view class="nav-clear" @tap="clearChat">
            <text class="clear-txt">清空</text>
          </view>
        </view>
      </view>

      <!-- 场景切换 -->
      <scroll-view scroll-x class="scenes" :show-scrollbar="false">
        <view class="scenes-inner">
          <view
            v-for="s in sceneList"
            :key="s.key"
            class="scene-chip"
            :class="{ active: scene === s.key }"
            @tap="switchScene(s.key)"
          >
            <text class="scene-emoji">{{ s.emoji }}</text>
            <text class="scene-label">{{ s.label }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- 消息区 -->
    <scroll-view
      scroll-y
      class="chat"
      :scroll-top="scrollTop"
      :scroll-with-animation="true"
      :style="{ top: navHeight + 'px' }"
    >
      <view class="chat-inner">
        <!-- 开场 -->
        <view class="hero">
          <view class="hero-badge">AI</view>
          <view class="hero-title">{{ sceneMeta[scene].title }}</view>
          <view class="hero-desc">{{ sceneMeta[scene].welcome }}</view>
        </view>

        <!-- 快捷问法 -->
        <view v-if="messages.length === 0" class="chips">
          <view
            v-for="(c, i) in sceneMeta[scene].chips"
            :key="i"
            class="chip"
            @tap="send(c)"
          >
            <text class="chip-txt">{{ c }}</text>
          </view>
        </view>

        <!-- 消息列表 -->
        <view v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
          <view v-if="m.role === 'assistant'" class="avatar">AI</view>
          <view class="bubble-wrap">
            <view class="bubble" :class="m.role">
              <text v-if="m.pending" class="typing">正在理解你的问题…</text>
              <text v-else class="bubble-txt">{{ m.content }}</text>
            </view>

            <!-- 工具调用轨迹（可折叠） -->
            <view v-if="m.toolTrace && m.toolTrace.length" class="trace">
              <view class="trace-head" @tap="toggleTrace(i)">
                <text class="trace-dot" :class="{ err: hasTraceError(m) }"></text>
                <text class="trace-title">调用 {{ m.toolTrace.length }} 个工具</text>
                <text class="trace-toggle">{{ expanded[i] ? '收起' : '展开' }}</text>
              </view>
              <view v-if="expanded[i]" class="trace-body">
                <view v-for="(t, ti) in m.toolTrace" :key="ti" class="trace-item">
                  <view class="trace-row">
                    <text class="trace-name" :class="{ err: !t.ok }">{{ t.name }}</text>
                    <text class="trace-ms">{{ t.ms }}ms</text>
                  </view>
                  <view class="trace-args">{{ prettyArgs(t.args) }}</view>
                  <view v-if="t.error" class="trace-err">{{ t.error }}</view>
                </view>
              </view>
            </view>

            <!-- 满意度 -->
            <view v-if="m.role === 'assistant' && m.id && !m.pending" class="rate">
              <view class="rate-btn" :class="{ on: rated[m.id!] === 1 }" @tap="rate(m, 1)">👍 有帮助</view>
              <view class="rate-btn" :class="{ on: rated[m.id!] === -1 }" @tap="rate(m, -1)">👎 不准</view>
              <text class="latency" v-if="m.latency">{{ (m.latency / 1000).toFixed(1) }}s</text>
            </view>
          </view>
        </view>

        <view class="chat-pad"></view>
      </view>
    </scroll-view>

    <!-- 输入区 -->
    <view class="composer" :style="{ paddingBottom: safeBottom + 'px' }">
      <view class="composer-inner">
        <input
          v-model="text"
          class="input"
          :placeholder="sceneMeta[scene].placeholder"
          placeholder-class="ph"
          confirm-type="send"
          :adjust-position="true"
          @confirm="send()"
        />
        <view class="send" :class="{ disabled: !text.trim() || sending }" @tap="send()">
          <text class="send-txt">发送</text>
        </view>
      </view>
    </view>

    <!-- 转人工浮层：提交后生成工单，商家后台可处理 -->
    <view v-if="handoffOpen" class="handoff-mask" @tap="handoffOpen = false">
      <view class="handoff-modal" @tap.stop>
        <text class="handoff-title">转人工客服</text>
        <text class="handoff-hint">提交后会生成工单，商家可在后台看到当前会话和你的联系方式。</text>
        <textarea v-model="handoffText" class="handoff-input" maxlength="300" placeholder="简单描述需要人工处理的问题" />
        <view class="handoff-actions">
          <view class="btn btn-ghost btn-sm grow" @tap="handoffOpen = false">取消</view>
          <view class="btn btn-primary btn-sm grow" @tap="submitHandoff">{{ handoffBusy ? '提交中…' : '提交工单' }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, reactive, nextTick } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { api } from '@/api';
import type { ChatMessage } from '@/api/types';
import { useAuth, useCart, toast } from '@/store';

type Scene = 'shopping' | 'support';

const sceneList: { key: Scene; label: string; emoji: string }[] = [
  { key: 'shopping', label: '导购', emoji: '🛍' },
  { key: 'support', label: '客服', emoji: '💬' },
];

const sceneMeta: Record<Scene, any> = {
  shopping: {
    title: '想找点什么？',
    desc: 'AI 导购 · 懂你在找什么',
    welcome: '说出你的需求或预算，我会从在售商品里挑选最合适的几款，并说明推荐理由。',
    placeholder: '例如：想买个 500 以内的降噪耳机',
    chips: ['想买个降噪耳机', '500 以内的通勤背包', '推荐一款办公鼠标', '送朋友的礼物 200 以内'],
  },
  support: {
    title: '有什么可以帮你？',
    desc: 'AI 客服 · 能查订单能退款',
    welcome: '我可以查询你的订单、判断是否符合退货条件，也能直接帮你提交退款申请。',
    placeholder: '例如：我的订单到哪了',
    chips: ['我的订单到哪了', '怎么申请退款', '退货政策是什么', '发票怎么开'],
  },
};

const auth = useAuth();
const cart = useCart();

const scene = ref<Scene>('shopping');
const text = ref('');
const sending = ref(false);
const messages = ref<ChatMessage[]>([]);
const conversationId = ref<number | undefined>(undefined);
const expanded = reactive<Record<number, boolean>>({});
const rated = reactive<Record<number, number>>({});
const scrollTop = ref(0);
const statusBarHeight = ref(20);
const safeBottom = ref(0);
const handoffOpen = ref(false);
const handoffText = ref('');
const handoffBusy = ref(false);

// 头部高度 = 状态栏 + 导航行 44 + 场景行 52
const navHeight = computed(() => statusBarHeight.value + 44 + 52 + 2);

onLoad((q: any) => {
  const sys: any = uni.getSystemInfoSync();
  statusBarHeight.value = sys.statusBarHeight || 20;
  const safe = sys.safeAreaInsets?.bottom;
  safeBottom.value = safe !== undefined ? safe : sys.screenHeight - (sys.safeArea?.bottom || sys.screenHeight);

  if (q?.scene === 'support' || q?.scene === 'shopping') scene.value = q.scene;
  // 从首页/详情页带过来的问题直接发
  if (q?.q) {
    const init = decodeURIComponent(q.q);
    nextTick(() => send(init));
  }
});

onShow(() => {
  auth.bootstrap();
});

function goBack() {
  const pages = getCurrentPages();
  if (pages.length > 1) uni.navigateBack();
  else uni.switchTab({ url: '/pages/index/index' });
}

function switchScene(s: Scene) {
  if (scene.value === s) return;
  scene.value = s;
  scrollDown();
}

function clearChat() {
  messages.value = [];
  conversationId.value = undefined;
  scrollDown();
}

function openHandoff() {
  if (!auth.isLoggedIn) {
    toast.info('转人工需要先登录');
    uni.navigateTo({ url: '/pages/login/login' });
    return;
  }
  const last = [...messages.value].reverse().find((m) => m.role === 'user');
  handoffText.value = last?.content || '需要人工客服协助处理问题';
  handoffOpen.value = true;
}

async function submitHandoff() {
  const summary = handoffText.value.trim();
  if (summary.length < 2) { toast.err('请简单描述需要人工处理的问题'); return; }
  handoffBusy.value = true;
  try {
    const r: any = await api.handoff({
      conversationId: conversationId.value,
      summary,
      contact: auth.user?.email,
    });
    handoffOpen.value = false;
    messages.value.push({
      role: 'assistant',
      content: r.duplicate
        ? '这条会话已经有待处理的人工工单了，商家会尽快联系你。'
        : `已为你提交人工工单 #${r.id}，商家会在后台看到这条会话和你的联系方式。`,
    });
    toast.ok('已转人工');
    scrollDown();
  } catch (e: any) {
    toast.err(e.message);
  } finally {
    handoffBusy.value = false;
  }
}

function hasTraceError(m: ChatMessage) {
  return (m.toolTrace || []).some((t) => !t.ok);
}

function toggleTrace(i: number) {
  expanded[i] = !expanded[i];
}

function prettyArgs(args: Record<string, unknown>) {
  try {
    const s = JSON.stringify(args);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch {
    return '';
  }
}

function scrollDown() {
  nextTick(() => {
    // 触发 scroll-view 重新定位到底部
    scrollTop.value = 999999 + Math.random();
  });
}

async function send(preset?: string) {
  const content = (preset ?? text.value).trim();
  if (!content || sending.value) return;

  // 客服场景需要登录（要查订单）
  if (scene.value === 'support' && !auth.isLoggedIn) {
    toast.info('查询订单需要先登录');
    uni.navigateTo({ url: '/pages/login/login' });
    return;
  }

  text.value = '';
  messages.value.push({ role: 'user', content });

  const idx = messages.value.length;
  messages.value.push({ role: 'assistant', content: '', pending: true });
  sending.value = true;
  scrollDown();

  const t0 = Date.now();
  try {
    const r: any = await api.chat({      scene: scene.value,
      text: content,
      conversationId: conversationId.value,
    });
    conversationId.value = r.conversationId;
    messages.value[idx] = {
      role: 'assistant',
      content: r.content || '（AI 没有返回内容）',
      toolTrace: r.toolTrace || [],
      id: r.messageId,
      latency: r.latency ?? Date.now() - t0,
    };
    // 客服场景可能改了数据（如提交退款），刷新一下订单/购物车
    if (scene.value === 'support') cart.refresh();
  } catch (e: any) {
    messages.value[idx] = {
      role: 'assistant',
      content: e?.message || 'AI 服务暂时不可用，请稍后再试。',
    };
  } finally {
    sending.value = false;
    scrollDown();
  }
}

async function rate(m: ChatMessage, rating: number) {
  if (!m.id) return;
  try {
    await api.rate(m.id, rating > 0 ? rating : 1);
    rated[m.id] = rating;
    toast.ok('感谢反馈');
  } catch (e: any) {
    toast.err(e?.message || '反馈失败');
  }
}
</script>

<style>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f7f8fa;
}

/* ── 头部 ── */
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  background: #fff;
  border-bottom: 1rpx solid #eceef3;
}
.nav-inner {
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}
.nav-back {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chev {
  font-size: 44rpx;
  color: #1f2430;
  line-height: 1;
}
.nav-mid {
  flex: 1;
  text-align: center;
}
.nav-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #1f2430;
  line-height: 1.2;
}
.nav-sub {
  font-size: 20rpx;
  color: #8d94a6;
  margin-top: 2rpx;
}
.nav-clear {
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-left: 12rpx;
}
.clear-txt {
  font-size: 24rpx;
  color: #8d94a6;
}
.nav-actions { display: flex; align-items: center; gap: 20rpx; }
.nav-link { font-size: 24rpx; color: #2f5bea; padding: 8rpx 0; }

.scenes {
  height: 52px;
  white-space: nowrap;
}
.scenes-inner {
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  height: 52px;
}
.scene-chip {
  display: inline-flex;
  align-items: center;
  height: 60rpx;
  padding: 0 26rpx;
  margin-right: 16rpx;
  border-radius: 30rpx;
  background: #f2f4f8;
}
.scene-chip.active {
  background: #2f5bea;
}
.scene-emoji {
  font-size: 24rpx;
  margin-right: 8rpx;
}
.scene-label {
  font-size: 24rpx;
  color: #4a5163;
}
.scene-chip.active .scene-label {
  color: #fff;
  font-weight: 500;
}

/* ── 聊天区 ── */
.chat {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
}
.chat-inner {
  padding: 24rpx 24rpx 0;
}
.hero {
  padding: 32rpx 8rpx 24rpx;
}
.hero-badge {
  width: 64rpx;
  height: 64rpx;
  border-radius: 20rpx;
  background: linear-gradient(135deg, #2f5bea, #6b4ef5);
  color: #fff;
  font-size: 24rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20rpx;
}
.hero-title {
  font-size: 40rpx;
  font-weight: 700;
  color: #1f2430;
  letter-spacing: -0.5rpx;
}
.hero-desc {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #6b7280;
  line-height: 1.6;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 8rpx;
}
.chip {
  padding: 18rpx 24rpx;
  background: #fff;
  border: 1rpx solid #eceef3;
  border-radius: 16rpx;
  margin: 0 16rpx 16rpx 0;
  max-width: 100%;
}
.chip-txt {
  font-size: 25rpx;
  color: #3a4152;
}

.msg {
  display: flex;
  margin-top: 24rpx;
}
.msg.user {
  justify-content: flex-end;
}
.avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 18rpx;
  background: linear-gradient(135deg, #2f5bea, #6b4ef5);
  color: #fff;
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16rpx;
  flex-shrink: 0;
}
.bubble-wrap {
  max-width: 78%;
}
.bubble {
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  background: #fff;
  border: 1rpx solid #eceef3;
}
.bubble.user {
  background: #2f5bea;
  border-color: #2f5bea;
  border-bottom-right-radius: 6rpx;
}
.bubble.assistant {
  border-bottom-left-radius: 6rpx;
}
.bubble-txt {
  font-size: 27rpx;
  line-height: 1.65;
  color: #1f2430;
  word-break: break-all;
  white-space: pre-wrap;
}
.bubble.user .bubble-txt {
  color: #fff;
}
.typing {
  font-size: 27rpx;
  color: #8d94a6;
}

/* 工具轨迹 */
.trace {
  margin-top: 12rpx;
  background: #fff;
  border: 1rpx solid #eceef3;
  border-radius: 14rpx;
  overflow: hidden;
}
.trace-head {
  display: flex;
  align-items: center;
  padding: 16rpx 20rpx;
}
.trace-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #17b26a;
  margin-right: 12rpx;
}
.trace-dot.err {
  background: #f04438;
}
.trace-title {
  flex: 1;
  font-size: 23rpx;
  color: #4a5163;
}
.trace-toggle {
  font-size: 22rpx;
  color: #2f5bea;
}
.trace-body {
  border-top: 1rpx solid #f2f4f8;
  padding: 8rpx 20rpx 16rpx;
  background: #fbfcfe;
}
.trace-item {
  padding-top: 14rpx;
}
.trace-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.trace-name {
  font-size: 22rpx;
  color: #3a4152;
  font-weight: 500;
  font-family: monospace;
}
.trace-name.err {
  color: #f04438;
}
.trace-ms {
  font-size: 20rpx;
  color: #8d94a6;
}
.trace-args {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #6b7280;
  font-family: monospace;
  word-break: break-all;
}
.trace-err {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #f04438;
}

/* 评价 */
.rate {
  display: flex;
  align-items: center;
  margin-top: 12rpx;
}
.rate-btn {
  font-size: 21rpx;
  color: #8d94a6;
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
  border: 1rpx solid #eceef3;
  background: #fff;
  margin-right: 12rpx;
}
.rate-btn.on {
  color: #2f5bea;
  border-color: #2f5bea;
  background: #eef2ff;
}
.latency {
  font-size: 20rpx;
  color: #b4bac9;
}
.chat-pad {
  height: 200rpx;
}

/* ── 输入区 ── */
.composer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  border-top: 1rpx solid #eceef3;
  z-index: 20;
}
.composer-inner {
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx;
}
.input {
  flex: 1;
  height: 76rpx;
  background: #f2f4f8;
  border-radius: 38rpx;
  padding: 0 28rpx;
  font-size: 27rpx;
  color: #1f2430;
}
.ph {
  color: #a8aebd;
  font-size: 26rpx;
}
.send {
  margin-left: 16rpx;
  height: 76rpx;
  padding: 0 32rpx;
  border-radius: 38rpx;
  background: #2f5bea;
  display: flex;
  align-items: center;
  justify-content: center;
}
.send.disabled {
  background: #c3cbe0;
}
.send-txt {
  font-size: 26rpx;
  color: #fff;
  font-weight: 500;
}

.handoff-mask {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex; align-items: flex-end;
  z-index: 300;
}
.handoff-modal {
  width: 100%;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  padding: 36rpx 32rpx calc(36rpx + env(safe-area-inset-bottom));
}
.handoff-title { display: block; font-size: 32rpx; font-weight: 600; margin-bottom: 10rpx; }
.handoff-hint { display: block; font-size: 22rpx; color: #8d94a6; line-height: 1.6; margin-bottom: 20rpx; }
.handoff-input {
  width: 100%; height: 180rpx; box-sizing: border-box;
  background: #f7f8fa; border-radius: 14rpx;
  padding: 20rpx; font-size: 26rpx; margin-bottom: 24rpx;
}
.handoff-actions { display: flex; gap: 16rpx; }
</style>
