<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, uploadMedia } from '../../api';
import { useToast } from '../../store';
import type { Order } from '../../api/types';
import { formatTime } from '../../utils/format';

const route = useRoute();
const router = useRouter();
const toast = useToast();

const order = ref<Order | null>(null);
const loading = ref(true);
const refundOpen = ref(false);
const reason = ref('');
const eligibility = ref<{ eligible: boolean; reason: string } | null>(null);
const submitting = ref(false);
const myReviews = ref<any[]>([]);

const STEPS = ['待付款', '待发货', '已发货', '已完成'];

const stepIndex = (status: string) => {
  if (status === 'pending_payment') return 0;
  if (status === 'paid') return 1;
  if (status === 'shipped') return 2;
  return 3;
};

const refundLabel = (s: string) => (s === 'pending' ? '审核中' : s === 'approved' ? '已退款' : '已驳回');
const refundBadge = (s: string) =>
  s === 'pending' ? 'badge-warning' : s === 'approved' ? 'badge-success' : 'badge-danger';

onMounted(async () => {
  try {
    const o = await api.order(route.params.id as string);
    order.value = o;
    if (o.reviewed) {
      try { myReviews.value = await api.orderReviews(o.id); } catch { /* 评价拉不到不影响订单 */ }
    }
    if (!['refunding', 'refunded', 'cancelled', 'pending_payment'].includes(o.status)) {
      eligibility.value = await api.eligibility(o.id);
    }
  } catch (e: any) {
    toast.push(e.message, 'error');
    router.push('/orders');
  } finally {
    loading.value = false;
  }
});

async function pay() {
  if (!order.value) return;
  try {
    order.value = await api.payOrder(order.value.id);
    toast.push('支付成功（演示）', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
}

async function cancelOrder() {
  if (!order.value) return;
  if (!window.confirm('取消后库存会释放，确定取消这笔订单吗？')) return;
  try {
    order.value = await api.cancelOrder(order.value.id, '用户主动取消');
    toast.push('订单已取消，库存已释放', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
}

async function confirmReceipt() {
  if (!order.value) return;
  if (!window.confirm('确认已收到货？确认后订单将完成。')) return;
  try {
    order.value = await api.confirmOrder(order.value.id);
    toast.push('已确认收货', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
}

async function submitRefund() {
  if (!order.value || !reason.value.trim()) { toast.push('请填写退款原因', 'error'); return; }
  submitting.value = true;
  try {
    await api.refund(order.value.id, reason.value.trim());
    order.value = await api.order(order.value.id);
    refundOpen.value = false;
    toast.push('退款申请已提交', 'success');
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    submitting.value = false;
  }
}

// ── 评价（图文 / 视频 + 返现）──
const reviewOpen = ref(false);
const reviewItem = ref<any>(null);
const reviewRating = ref(5);
const reviewContent = ref('');
const reviewAnonymous = ref(false);
const reviewRules = ref<any>(null);
const reviewImages = ref<{ url: string; progress: number }[]>([]);
const reviewVideo = ref<{ url: string; progress: number } | null>(null);
const uploadingCount = ref(0);
const imageInput = ref<HTMLInputElement | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);

// 分项评分 + 印象标签
const reviewTagOptions = ref<any>(null);
const reviewDims = reactive<Record<string, number>>({});
const reviewPickedTags = ref<any[]>([]);
const reviewCustomTags = ref<string[]>([]);
const customTagInput = ref('');

const reviewChars = computed(() => reviewContent.value.replace(/\s+/g, ' ').trim().length);
const reviewTagCount = computed(() => reviewPickedTags.value.length + reviewCustomTags.value.length);

function setDim(key: string, val: number) {
  if (reviewDims[key] === val) delete reviewDims[key];
  else reviewDims[key] = val;
}
function clearDims() {
  for (const k of Object.keys(reviewDims)) delete reviewDims[k];
}
function isTagPicked(id: number) {
  return reviewPickedTags.value.some((t) => t.id === id);
}
function toggleTag(t: any) {
  if (isTagPicked(t.id)) {
    reviewPickedTags.value = reviewPickedTags.value.filter((x) => x.id !== t.id);
    return;
  }
  if (reviewTagCount.value >= 8) return err('最多选 8 个标签');
  reviewPickedTags.value.push(t);
}
function addCustomTag() {
  const name = customTagInput.value.replace(/\s+/g, ' ').trim();
  const len = [...name].length;
  if (len < 2) return err('自定义标签至少 2 个字');
  if (len > 8) return err('自定义标签最多 8 个字');
  if (reviewCustomTags.value.includes(name)) return err('这个标签已经加过了');
  if (reviewCustomTags.value.length >= 3) return err('最多自定义 3 个标签');
  if (reviewTagCount.value >= 8) return err('最多选 8 个标签');
  reviewCustomTags.value.push(name);
  customTagInput.value = '';
}
function removeCustomTag(i: number) {
  reviewCustomTags.value.splice(i, 1);
}

/** 与后端同一个规则模型；这里只做即时预览，最终金额以服务端返回为准 */
const reward = computed(() => {
  const r = reviewRules.value;
  if (!r) return null;
  const chars = reviewChars.value;
  const imageCount = reviewImages.value.filter((x) => x.url).length;
  const hasVideo = !!reviewVideo.value?.url;
  let tier: any = null;
  for (const t of r.tiers) {
    if (chars >= t.minChars && imageCount >= t.minImages) tier = t;
  }
  let cashCents = tier ? tier.cashCents : 0;
  let points = r.basePoints + (tier ? tier.points : 0);
  let videoBonus = 0;
  if (hasVideo && chars >= r.video.minChars) {
    videoBonus = r.video.cashCents;
    cashCents += videoBonus;
    points += r.video.points;
  }
  cashCents = Math.min(cashCents, r.maxCashCents);

  let next: any = null;
  for (const t of r.tiers) {
    if (tier && r.tiers.indexOf(t) <= r.tiers.indexOf(tier)) continue;
    next = {
      label: t.label,
      addCents: Math.max(0, t.cashCents - (tier ? tier.cashCents : 0)),
      needChars: Math.max(0, t.minChars - chars),
      needImages: Math.max(0, t.minImages - imageCount),
      tip: t.tip,
    };
    break;
  }
  if (!next && !hasVideo) {
    next = {
      label: '带视频评价',
      addCents: r.video.cashCents,
      needChars: Math.max(0, r.video.minChars - chars),
      needImages: 0,
      needVideo: true,
    };
  }
  return {
    chars, imageCount, hasVideo, tier, cashCents,
    cash: (cashCents / 100).toFixed(2),
    points, videoBonus, next,
    maxed: cashCents >= r.maxCashCents,
  };
});

async function openReview(it: any) {
  reviewItem.value = it;
  reviewRating.value = 5;
  reviewContent.value = '';
  reviewAnonymous.value = false;
  reviewImages.value = [];
  reviewVideo.value = null;
  reviewTagOptions.value = null;
  reviewPickedTags.value = [];
  reviewCustomTags.value = [];
  customTagInput.value = '';
  clearDims();
  reviewOpen.value = true;
  if (!reviewRules.value) {
    try { reviewRules.value = await api.reviewRules(); } catch { /* 规则拉不到不影响评价 */ }
  }
  try {
    reviewTagOptions.value = await api.reviewTagOptions(it.productId);
  } catch { /* 标签拉不到不影响评价 */ }
}

function err(message: string) {
  toast.push(message, 'error');
}

function myReviewOf(itemId: number) {
  return myReviews.value.find((r) => r.orderItemId === itemId) || null;
}

function dimText(d: any) {
  const labels: Record<string, string> = {
    appearance: '外观', performance: '性能', color: '颜色', quality: '质量', fit: '尺码',
    taste: '口感', fresh: '新鲜度', effect: '效果', texture: '肤感', price: '性价比', service: '物流',
  };
  return Object.keys(d || {})
    .filter((k) => Number(d[k]) >= 1 && Number(d[k]) <= 5)
    .map((k) => `${labels[k] || '其他'} ${d[k]}`)
    .join(' · ');
}

async function onPickImages(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  const room = 9 - reviewImages.value.length;
  if (room <= 0) return err('最多上传 9 张图片');
  for (const f of files.slice(0, room)) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(f.type)) {
      err(`${f.name} 格式不支持，请用 JPG / PNG / WEBP / GIF`);
      continue;
    }
    if (f.size > 8 * 1024 * 1024) { err(`${f.name} 超过 8MB`); continue; }
    const item = reactive({ url: '', progress: 0 });
    reviewImages.value.push(item);
    uploadingCount.value += 1;
    try {
      const r = await uploadMedia(f, (p) => { item.progress = p; });
      item.url = r.url;
      item.progress = 100;
    } catch (e: any) {
      reviewImages.value = reviewImages.value.filter((x) => x !== item);
      err(e.message || '图片上传失败');
    } finally {
      uploadingCount.value -= 1;
    }
  }
}

async function onPickVideo(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(f.type)) {
    return err('视频格式不支持，请用 MP4 / MOV / WEBM');
  }
  if (f.size > 60 * 1024 * 1024) return err('视频不能超过 60MB');
  const item = reactive({ url: '', progress: 0 });
  reviewVideo.value = item;
  uploadingCount.value += 1;
  try {
    const r = await uploadMedia(f, (p) => { item.progress = p; });
    item.url = r.url;
    item.progress = 100;
  } catch (e: any) {
    reviewVideo.value = null;
    err(e.message || '视频上传失败');
  } finally {
    uploadingCount.value -= 1;
  }
}

function removeImage(i: number) {
  reviewImages.value.splice(i, 1);
}

const openImagePicker = () => imageInput.value?.click();
const openVideoPicker = () => videoInput.value?.click();

async function submitReview() {
  if (!order.value || !reviewItem.value || submitting.value) return;
  if (uploadingCount.value > 0) return err('媒体还在上传中，请稍候');
  submitting.value = true;
  try {
    const res = await api.createReview({
      orderId: order.value.id,
      orderItemId: reviewItem.value.id,
      rating: reviewRating.value,
      content: reviewContent.value.trim(),
      images: reviewImages.value.map((x) => x.url).filter(Boolean),
      video: reviewVideo.value?.url || '',
      anonymous: reviewAnonymous.value,
      dimensions: { ...reviewDims },
      tags: [
        ...reviewPickedTags.value.map((t) => ({ id: t.id })),
        ...reviewCustomTags.value.map((name) => ({ name })),
      ],
    });
    toast.push(res?.reward?.message || '评价已发布', 'success');
    reviewOpen.value = false;
    const orderId = order.value.id;
    order.value = await api.order(orderId);
    try { myReviews.value = await api.orderReviews(orderId); } catch { /* 忽略 */ }
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <button class="back" @click="router.push('/orders')">← 返回订单列表</button>

    <div v-if="loading" class="skeleton" style="height: 400px" />

    <template v-else-if="order">
      <section class="card card-pad head-card">
        <div class="row-between">
          <div>
            <div class="row gap-8" style="margin-bottom: 6px">
              <span class="badge badge-primary">{{ order.statusLabel }}</span>
              <span v-if="order.aiAssisted" class="badge badge-ai">AI 协助</span>
            </div>
            <h1 class="order-no mono">{{ order.orderNo }}</h1>
            <p class="dim" style="font-size: 12px">下单时间 {{ formatTime(order.createdAt) }}</p>
          </div>
          <div class="head-actions">
            <button v-if="order.status === 'pending_payment'" class="btn btn-primary" @click="pay">模拟支付</button>
            <button v-if="['pending_payment', 'paid'].includes(order.status)" class="btn btn-secondary" @click="cancelOrder">取消订单</button>
            <button v-if="order.status === 'shipped'" class="btn btn-primary" @click="confirmReceipt">确认收货</button>
            <button
              v-if="eligibility && order.status !== 'refunding' && order.status !== 'refunded'"
              class="btn btn-secondary"
              :disabled="!eligibility.eligible"
              :title="eligibility.reason"
              @click="refundOpen = true"
            >
              申请退款
            </button>
          </div>
        </div>

        <div v-if="!['refunding', 'refunded', 'cancelled'].includes(order.status)" class="steps">
          <div v-for="(s, i) in STEPS" :key="s" class="step" :class="{ done: i <= stepIndex(order.status), current: i === stepIndex(order.status) }">
            <div class="step-dot">{{ i < stepIndex(order.status) ? '✓' : i + 1 }}</div>
            <span class="step-label">{{ s }}</span>
            <div v-if="i < STEPS.length - 1" class="step-line" :class="{ done: i < stepIndex(order.status) }" />
          </div>
        </div>
        <div v-else class="status-note">
          {{ order.status === 'cancelled' ? `订单已取消${order.cancelReason ? `：${order.cancelReason}` : ''}` : order.status === 'refunded' ? '退款已完成' : '退款处理中' }}
        </div>
      </section>

      <!-- 退款进度时间轴：说清卡在哪、谁在处理、还要多久 -->
      <section v-if="order.refund" class="card card-pad refund-card">
        <div class="row-between" style="margin-bottom: 4px">
          <h2 class="block-title" style="margin: 0">退款进度</h2>
          <span class="badge" :class="refundBadge(order.refund.status)">{{ refundLabel(order.refund.status) }}</span>
        </div>
        <p class="dim" style="font-size: 12px; margin: 0 0 18px">
          退款金额 <b class="mono">¥{{ order.refund.amount }}</b>　·　原因：{{ order.refund.reason }}
        </p>

        <div class="tl">
          <div
            v-for="(n, i) in order.refund.nodes"
            :key="n.key"
            class="tl-node"
            :class="{ done: n.done, active: n.active, reject: n.key === 'refunded' && order.refund.status === 'rejected' }"
          >
            <div class="tl-rail">
              <div class="tl-dot">{{ n.done ? '✓' : i + 1 }}</div>
              <div v-if="i < order.refund.nodes.length - 1" class="tl-line" :class="{ done: n.done }" />
            </div>
            <div class="tl-body">
              <div class="tl-head">
                <span class="tl-title">{{ n.title }}</span>
                <span class="tl-owner" :class="`owner-${n.ownerType}`">{{ n.owner }}</span>
                <span v-if="n.at" class="dim mono tl-time">{{ n.at }}</span>
              </div>
              <p class="tl-desc">{{ n.desc }}</p>
            </div>
          </div>
        </div>

        <div class="next-action">
          <span class="na-icon">→</span>
          <span>{{ order.refund.nextAction }}</span>
        </div>
      </section>

      <div class="grid">
        <section class="card card-pad">
          <h2 class="block-title">商品</h2>
          <div v-for="it in order.items" :key="it.id" class="item">
            <div class="grow">
              <div class="item-title">{{ it.title }}</div>
              <div v-if="it.specText" class="dim" style="font-size: 12px">{{ it.specText }}</div>
              <div class="dim" style="font-size: 12px">¥{{ it.price }} × {{ it.qty }}</div>
              <div v-if="order.status === 'completed'" class="rev-line">
                <span v-if="it.reviewed" class="dim">已评价</span>
                <button v-else class="btn btn-secondary btn-sm" @click="openReview(it)">评价晒单 · 最高返 ¥5</button>
              </div>
              <!-- 我的评价：让用户回头能看到自己给过的标签与分项分 -->
              <div v-if="myReviewOf(it.id)" class="my-rev">
                <span class="mr-label">我的评价</span>
                <span class="mr-stars">{{ '★'.repeat(myReviewOf(it.id).rating) }}</span>
                <span
                  v-for="t in myReviewOf(it.id).tags" :key="t.id" class="mr-tag"
                  :class="{ bad: t.polarity === 'bad', custom: t.dimension === 'custom' }"
                >{{ t.name }}</span>
                <span v-if="dimText(myReviewOf(it.id).dimensions)" class="mr-dim">
                  {{ dimText(myReviewOf(it.id).dimensions) }}
                </span>
              </div>
            </div>
            <div class="mono">¥{{ (it.price * it.qty).toFixed(2) }}</div>
          </div>
          <div class="sum">
            <div class="sum-row"><span class="dim">商品小计</span><span class="mono">¥{{ order.subtotal }}</span></div>
            <div class="sum-row"><span class="dim">运费</span><span class="mono">{{ order.shipping ? `¥${order.shipping}` : '免运费' }}</span></div>
            <div v-if="order.pricing?.memberDiscount" class="sum-row"><span class="dim">{{ order.pricing.memberLabel }}</span><span class="mono minus">-¥{{ order.pricing.memberDiscount.toFixed(2) }}</span></div>
            <div v-if="order.pricing?.couponDiscount" class="sum-row"><span class="dim">{{ order.pricing.couponTitle || '优惠券' }}</span><span class="mono minus">-¥{{ order.pricing.couponDiscount.toFixed(2) }}</span></div>
            <div v-if="order.pricing?.fullCut" class="sum-row"><span class="dim">满减</span><span class="mono minus">-¥{{ order.pricing.fullCut.toFixed(2) }}</span></div>
            <div v-if="order.pricing?.pointsDiscount" class="sum-row"><span class="dim">积分抵扣（{{ order.pricing.pointsUsed }}）</span><span class="mono minus">-¥{{ order.pricing.pointsDiscount.toFixed(2) }}</span></div>
            <div v-if="order.pricing?.balanceDiscount" class="sum-row"><span class="dim">余额抵扣</span><span class="mono minus">-¥{{ order.pricing.balanceDiscount.toFixed(2) }}</span></div>
            <div v-if="order.discount" class="sum-row"><span class="dim">优惠合计</span><span class="mono minus">-¥{{ order.discount }}</span></div>
            <div class="sum-row total"><span>实付</span><span class="price">¥{{ order.total }}</span></div>
          </div>
        </section>

        <section class="card card-pad">
          <h2 class="block-title">收货信息</h2>
          <div class="kv"><span class="dim">地址</span><span>{{ order.address }}</span></div>
          <div v-if="order.remark" class="kv"><span class="dim">备注</span><span>{{ order.remark }}</span></div>
          <div class="kv"><span class="dim">下单</span><span class="mono">{{ formatTime(order.createdAt) }}</span></div>
          <div v-if="order.paidAt" class="kv"><span class="dim">支付</span><span class="mono">{{ formatTime(order.paidAt) }}</span></div>
          <div v-if="order.shippedAt" class="kv"><span class="dim">发货</span><span class="mono">{{ formatTime(order.shippedAt) }}</span></div>
          <div v-if="order.carrier || order.trackingNo" class="kv">
            <span class="dim">物流</span>
            <span class="mono">{{ order.carrier || '快递' }} {{ order.trackingNo || '（未填运单号）' }}</span>
          </div>
          <div v-if="order.completedAt" class="kv"><span class="dim">完成</span><span class="mono">{{ formatTime(order.completedAt) }}</span></div>
          <div v-if="eligibility" class="hint" :class="eligibility.eligible ? 'hint-ok' : 'hint-warn'">
            {{ eligibility.eligible ? '✓' : '!' }} {{ eligibility.reason }}
          </div>
        </section>
      </div>
    </template>

    <!-- 退款弹窗 -->
    <transition name="fade">
      <div v-if="refundOpen" class="modal-mask" @click.self="refundOpen = false">
        <div class="modal card">
          <h3 class="modal-title">申请退款</h3>
          <p class="dim" style="font-size: 12px; margin-bottom: 12px">
            退款金额 ¥{{ order?.total }}，审核通过后原路退回
          </p>
          <div class="field">
            <label>退款原因</label>
            <textarea v-model="reason" class="textarea" rows="3" placeholder="请简要说明原因，如：尺寸不合适 / 与描述不符" />
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" @click="refundOpen = false">取消</button>
            <button class="btn btn-danger" :disabled="submitting" @click="submitRefund">
              {{ submitting ? '提交中…' : '提交申请' }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 评价弹窗：图文 / 短视频 + 返现规则 -->
    <transition name="fade">
      <div v-if="reviewOpen" class="modal-mask" @click.self="reviewOpen = false">
        <div class="modal card review-modal">
          <div class="rm-head">
            <h3 class="modal-title">评价「{{ reviewItem?.title }}」</h3>
            <button class="rm-close" @click="reviewOpen = false">×</button>
          </div>

          <div class="star-row">
            <button v-for="s in 5" :key="s" class="star" :class="{ on: s <= reviewRating }" @click="reviewRating = s">★</button>
            <span class="dim star-label">{{ ['', '很差', '较差', '一般', '满意', '非常满意'][reviewRating] }}</span>
          </div>

          <!-- 分项评分：外观 / 性能 / 颜色…（按商品类目下发） -->
          <div v-if="reviewTagOptions" class="dim-block">
            <div class="field-head">
              <label>分项评分 <span class="opt">选填，让后来人一眼看到强项</span></label>
              <button v-if="Object.keys(reviewDims).length" class="link-btn" @click="clearDims">清空</button>
            </div>
            <div class="dim-grid">
              <div v-for="d in reviewTagOptions.dimensions" :key="d.key" class="dim-row">
                <span class="dim-name"><i>{{ d.icon }}</i>{{ d.label }}</span>
                <span class="mini-stars">
                  <button
                    v-for="s in 5" :key="s" class="mini-star"
                    :class="{ on: (reviewDims[d.key] || 0) >= s }"
                    :title="`${d.label} ${s} 分`"
                    @click="setDim(d.key, s)"
                  >★</button>
                </span>
                <span class="dim-score" :class="{ none: !reviewDims[d.key] }">
                  {{ reviewDims[d.key] ? reviewDims[d.key] + '.0' : '未评' }}
                </span>
              </div>
            </div>
          </div>

          <!-- 印象标签：官方词库多选 + 自定义 -->
          <div v-if="reviewTagOptions" class="tag-block">
            <div class="field-head">
              <label>印象标签 <span class="opt">最多 8 个，可自定义</span></label>
              <span class="count" :class="{ ok: reviewTagCount > 0 }">{{ reviewTagCount }}/8</span>
            </div>
            <div v-for="g in reviewTagOptions.groups" :key="g.key" class="tag-group">
              <span class="tg-dim">{{ g.icon }} {{ g.label }}</span>
              <div class="tg-chips">
                <button
                  v-for="t in g.tags" :key="t.id" class="tg-chip"
                  :class="{ on: isTagPicked(t.id), bad: t.polarity === 'bad' }"
                  @click="toggleTag(t)"
                >{{ t.name }}</button>
              </div>
            </div>
            <div class="custom-row">
              <input
                v-model="customTagInput" class="input custom-input" maxlength="8"
                placeholder="没找到合适的？自己写一个（2–8 字）"
                @keyup.enter="addCustomTag"
              />
              <button class="btn btn-secondary btn-sm" @click="addCustomTag">添加</button>
            </div>
            <div v-if="reviewCustomTags.length" class="custom-list">
              <span v-for="(tag, i) in reviewCustomTags" :key="tag" class="custom-chip">
                {{ tag }}<button class="cc-x" @click="removeCustomTag(i)">×</button>
              </span>
              <span class="custom-hint">自定义标签会进入词库审核，通过后别人也能选</span>
            </div>
          </div>

          <div class="field" style="margin-top: 12px">
            <div class="field-head">
              <label>使用感受</label>
              <span class="count" :class="{ ok: reviewChars >= (reviewRules?.tiers?.[0]?.minChars || 15) }">
                {{ reviewChars }} 字<template v-if="reviewRules"> / 建议 {{ reviewRules.tiers[0].minChars }} 字起</template>
              </span>
            </div>
            <textarea
              v-model="reviewContent"
              class="textarea"
              rows="4"
              maxlength="1000"
              placeholder="用起来怎么样？有什么值得提醒别人的？（至少 15 字更容易拿到返现）"
            />
          </div>

          <!-- 图片：最多 9 张，支持拍照 -->
          <div class="media-block">
            <div class="media-head">
              <span>晒图 <b>{{ reviewImages.length }}/9</b></span>
              <span class="dim">第一张作为封面</span>
            </div>
            <div class="media-grid">
              <div v-for="(img, i) in reviewImages" :key="i" class="media-cell">
                <img v-if="img.url" :src="img.url" :alt="`晒图 ${i + 1}`" />
                <div v-else class="up-mask"><span class="spin" />{{ img.progress }}%</div>
                <button class="media-del" title="删除" @click="removeImage(i)">×</button>
              </div>
              <button v-if="reviewImages.length < 9" class="media-add" @click="openImagePicker">
                <span class="plus">+</span>
                <span>拍照 / 选图</span>
              </button>
            </div>
            <p class="media-hint">支持 JPG / PNG / WEBP / GIF，单张不超过 8MB</p>
          </div>

          <!-- 视频：1 段，支持直接录像 -->
          <div class="media-block">
            <div class="media-head">
              <span>短视频 <b>{{ reviewVideo ? 1 : 0 }}/1</b></span>
              <span class="dim">带视频额外 +¥2.00</span>
            </div>
            <div v-if="reviewVideo" class="video-box">
              <video v-if="reviewVideo.url" :src="reviewVideo.url" controls playsinline preload="metadata" />
              <div v-else class="up-mask"><span class="spin" />{{ reviewVideo.progress }}%</div>
              <button class="media-del" title="删除" @click="reviewVideo = null">×</button>
            </div>
            <button v-else class="video-add" @click="openVideoPicker">
              <span class="va-icon">▶</span>
              <span>拍摄或上传视频</span>
              <span class="dim">MP4 / MOV，≤ 60MB</span>
            </button>
          </div>

          <input ref="imageInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden @change="onPickImages" />
          <input ref="videoInput" type="file" accept="video/mp4,video/webm,video/quicktime" hidden @change="onPickVideo" />

          <!-- 返现规则：实时算给你看 -->
          <div v-if="reward" class="reward-card">
            <div class="rw-head">
              <span class="badge badge-ai">评价返现</span>
              <b class="rw-cash">预计 ¥{{ reward.cash }}</b>
              <span class="dim">+{{ reward.points }} 积分</span>
              <span v-if="reward.videoBonus" class="rw-bonus">含视频加码 ¥{{ (reward.videoBonus / 100).toFixed(2) }}</span>
            </div>
            <div class="rw-tiers">
              <span v-for="t in reviewRules.tiers" :key="t.key" class="rw-tier" :class="{ hit: reward.tier?.key === t.key }">
                {{ t.tip }} → ¥{{ (t.cashCents / 100).toFixed(2) }}
              </span>
              <span class="rw-tier" :class="{ hit: reward.videoBonus }">视频 + {{ reviewRules.video.minChars }} 字 → +¥{{ (reviewRules.video.cashCents / 100).toFixed(2) }}</span>
            </div>
            <p v-if="reward.next && reward.next.addCents > 0" class="rw-next">
              再加
              <template v-if="reward.next.needChars">{{ reward.next.needChars }} 字</template>
              <template v-if="reward.next.needChars && (reward.next.needImages || reward.next.needVideo)"> + </template>
              <template v-if="reward.next.needImages">{{ reward.next.needImages }} 张图</template>
              <template v-if="reward.next.needVideo">1 段视频</template>
              ，可多返 <b>¥{{ (reward.next.addCents / 100).toFixed(2) }}</b>
            </p>
            <p v-else-if="reward.maxed" class="rw-next">已达单条评价返现上限 ¥5.00</p>
            <p v-else-if="!reward.cashCents" class="rw-next">{{ reviewRules.defaultHint }}</p>
          </div>

          <label class="anon"><input v-model="reviewAnonymous" type="checkbox" />匿名评价（商家看不到你的昵称）</label>
          <div class="modal-actions">
            <button class="btn btn-secondary" @click="reviewOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="submitting || uploadingCount > 0" @click="submitReview">
              {{ submitting ? '发布中…' : uploadingCount > 0 ? `上传中 ${uploadingCount}…` : `发布评价${reward?.cashCents ? ` · 返 ¥${reward.cash}` : ''}` }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.page { max-width: 900px; margin: 0 auto; padding: 20px 24px 64px; }
.back { border: 0; background: transparent; color: var(--text-2); font-size: 13px; padding: 0; margin-bottom: 16px; }
.back:hover { color: var(--primary); }

.head-card { margin-bottom: 16px; }
.order-no { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.head-actions { display: flex; gap: 8px; }

.steps { display: flex; margin-top: 24px; }
.step { flex: 1; position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.step-dot {
  width: 26px; height: 26px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-3);
  display: grid; place-items: center;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--line);
  z-index: 1;
}
.step.done .step-dot { background: var(--primary); border-color: var(--primary); color: #fff; }
.step-label { font-size: 12px; color: var(--text-3); }
.step.done .step-label { color: var(--text-2); }
.step.current .step-label { color: var(--primary); font-weight: 500; }
.step-line {
  position: absolute;
  top: 13px; left: 50%;
  width: 100%;
  height: 1px;
  background: var(--line);
}
.step-line.done { background: var(--primary); }

.status-note {
  margin-top: 20px;
  padding: 12px 14px;
  background: var(--warning-soft);
  color: var(--warning);
  border-radius: var(--r-sm);
  font-size: 13px;
}

/* ── 退款时间轴 ── */
.refund-card { margin-bottom: 16px; }
.tl { display: flex; flex-direction: column; }
.tl-node { display: flex; gap: 12px; }
.tl-rail { display: flex; flex-direction: column; align-items: center; width: 26px; flex-shrink: 0; }
.tl-dot {
  width: 24px; height: 24px;
  border-radius: 50%;
  display: grid; place-items: center;
  font-size: 11px; font-weight: 600;
  background: var(--surface-2);
  color: var(--text-3);
  border: 1px solid var(--line);
  flex-shrink: 0;
}
.tl-node.done .tl-dot { background: var(--success); border-color: var(--success); color: #fff; }
.tl-node.active .tl-dot {
  background: var(--warning-soft); border-color: var(--warning); color: var(--warning);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); } 50% { box-shadow: 0 0 0 4px var(--warning-soft); } }
.tl-node.reject .tl-dot { background: var(--danger); border-color: var(--danger); color: #fff; }
.tl-line { width: 1px; flex: 1; min-height: 26px; background: var(--line); }
.tl-line.done { background: var(--success); }
.tl-body { padding-bottom: 18px; flex: 1; }
.tl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tl-title { font-size: 13px; font-weight: 500; color: var(--text-3); }
.tl-node.done .tl-title, .tl-node.active .tl-title { color: var(--text); }
.tl-owner {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--text-3);
}
.owner-merchant { background: var(--primary-soft); color: var(--primary); }
.owner-user { background: var(--ai-soft); color: var(--ai); }
.tl-time { font-size: 11px; margin-left: auto; }
.tl-desc { font-size: 12px; color: var(--text-3); margin: 4px 0 0; line-height: 1.6; }

.next-action {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  background: var(--primary-soft);
  color: var(--primary);
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 1.6;
}
.na-icon { font-weight: 700; }

.grid { display: grid; grid-template-columns: 1fr 320px; gap: 16px; align-items: start; }
.block-title { font-size: 15px; font-weight: 600; margin: 0 0 12px; }
.item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.item-title { font-size: 13px; font-weight: 500; }
.sum { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
.sum-row { display: flex; justify-content: space-between; font-size: 13px; }
.sum-row.total { font-weight: 500; padding-top: 8px; border-top: 1px solid var(--line); }
.sum-row.total .price { font-size: 20px; }

.kv { display: flex; gap: 12px; font-size: 13px; padding: 7px 0; }
.kv span:first-child { width: 44px; flex-shrink: 0; }
.hint { margin-top: 14px; padding: 9px 12px; border-radius: var(--r-sm); font-size: 12px; }
.hint-ok { background: var(--success-soft); color: var(--success); }
.hint-warn { background: var(--warning-soft); color: var(--warning); }

.modal-mask {
  position: fixed; inset: 0;
  background: rgba(16, 24, 40, 0.35);
  display: grid; place-items: center;
  z-index: 500;
  padding: 20px;
}
.modal { width: 420px; max-width: 100%; padding: 22px; }
.modal-title { font-size: 16px; font-weight: 600; margin: 0 0 6px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .page { padding: 16px 16px 48px; } .steps { flex-wrap: wrap; gap: 12px; } .step-line { display: none; } }

/* 评价入口与弹窗 */
.rev-line { margin-top: 6px; }
.my-rev { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.mr-label { font-size: 11px; color: var(--text-3); }
.mr-stars { font-size: 11px; color: #fbbf24; letter-spacing: 1px; }
.mr-tag { font-size: 11px; background: #eef2ff; color: #4338ca; border-radius: 99px; padding: 1px 8px; }
.mr-tag.bad { background: #fef2f2; color: #b91c1c; }
.mr-tag.custom { background: #ecfdf5; color: #047857; }
.mr-dim { font-size: 11px; color: var(--text-3); }
.minus { color: #e53935; }
.star-row { display: flex; align-items: center; gap: 6px; }
.star { border: none; background: transparent; font-size: 26px; color: #e5e7eb; cursor: pointer; padding: 0 2px; line-height: 1; }
.star.on { color: #fbbf24; }
.star-label { font-size: 12px; margin-left: 8px; }
.anon { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); margin-top: 10px; }

/* ── 评价：图文 / 视频 / 返现 ── */
.review-modal { width: 560px; max-height: 92vh; overflow-y: auto; }
.rm-head { display: flex; align-items: flex-start; gap: 10px; }
.rm-head .modal-title { flex: 1; margin-bottom: 0; }
.rm-close {
  border: 0; background: var(--surface-2); color: var(--text-3);
  width: 26px; height: 26px; border-radius: 50%; line-height: 1; font-size: 16px; cursor: pointer;
}
.rm-close:hover { background: var(--line); color: var(--text); }
.field-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
.count { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.count.ok { color: var(--success); }
.opt { font-weight: 400; color: var(--text-3); font-size: 11px; margin-left: 4px; }

/* 分项评分 */
.dim-block, .tag-block { margin-top: 14px; border-top: 1px dashed var(--line); padding-top: 12px; }
.dim-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; }
.dim-row { display: flex; align-items: center; gap: 8px; }
.dim-name { width: 70px; flex-shrink: 0; font-size: 12px; color: var(--text-2); }
.dim-name i { font-style: normal; margin-right: 4px; }
.mini-stars { display: flex; gap: 1px; }
.mini-star { border: 0; background: transparent; padding: 0; font-size: 15px; line-height: 1; color: #e5e7eb; cursor: pointer; }
.mini-star.on { color: #fbbf24; }
.dim-score { min-width: 28px; font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.dim-score.none { color: var(--text-3); }
.link-btn { border: 0; background: transparent; color: var(--primary); font-size: 11px; cursor: pointer; padding: 0; }

/* 印象标签 */
.tag-group { display: flex; gap: 8px; margin-bottom: 8px; align-items: flex-start; }
.tg-dim { width: 70px; flex-shrink: 0; padding-top: 4px; font-size: 11px; color: var(--text-3); }
.tg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.tg-chip {
  border: 1px solid var(--line); background: var(--surface); color: var(--text-2);
  font-size: 12px; padding: 3px 10px; border-radius: 99px; cursor: pointer; transition: all .15s;
}
.tg-chip:hover { border-color: var(--primary); color: var(--primary); }
.tg-chip.on { background: var(--primary-soft); border-color: var(--primary); color: var(--primary); font-weight: 600; }
.tg-chip.bad { border-style: dashed; }
.tg-chip.bad.on { background: #fef2f2; border-color: #ef4444; color: #b91c1c; }
.custom-row { display: flex; gap: 8px; margin-top: 10px; }
.custom-input { flex: 1; font-size: 12px; }
.custom-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.custom-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--surface-2); border-radius: 99px; padding: 2px 8px; font-size: 12px;
}
.cc-x { border: 0; background: transparent; color: var(--text-3); font-size: 13px; line-height: 1; cursor: pointer; }
.custom-hint { font-size: 11px; color: var(--text-3); }

.media-block { margin-top: 14px; }
.media-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; margin-bottom: 8px; }
.media-head b { color: var(--text-2); font-weight: 600; }
.media-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.media-cell {
  position: relative; aspect-ratio: 1;
  border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2);
}
.media-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.media-add {
  aspect-ratio: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  border: 1px dashed var(--line); border-radius: var(--r-sm);
  background: var(--surface-2); color: var(--text-3);
  font-size: 10px; cursor: pointer;
}
.media-add:hover { border-color: var(--primary); color: var(--primary); }
.media-add .plus { font-size: 20px; line-height: 1; }
.media-del {
  position: absolute; top: 3px; right: 3px;
  width: 18px; height: 18px; border-radius: 50%;
  border: 0; background: rgba(16, 24, 40, 0.55); color: #fff;
  font-size: 13px; line-height: 1; cursor: pointer;
}
.up-mask {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  background: rgba(16, 24, 40, 0.55); color: #fff; font-size: 12px;
}
.spin {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.media-hint { font-size: 11px; color: var(--text-3); margin: 6px 0 0; }

.video-box { position: relative; border-radius: var(--r-sm); overflow: hidden; background: #000; }
.video-box video { width: 100%; max-height: 260px; display: block; background: #000; }
.video-box .up-mask { position: absolute; }
.video-add {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px; border: 1px dashed var(--line); border-radius: var(--r-sm);
  background: var(--surface-2); color: var(--text-2); font-size: 13px; cursor: pointer;
}
.video-add:hover { border-color: var(--primary); color: var(--primary); }
.va-icon {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--primary-soft); color: var(--primary);
  display: grid; place-items: center; font-size: 10px;
}

.reward-card {
  margin-top: 16px; padding: 12px 14px;
  background: var(--ai-soft); border: 1px solid transparent;
  border-radius: var(--r-sm);
}
.rw-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.rw-cash { font-size: 15px; color: var(--ai); }
.rw-bonus { font-size: 11px; color: var(--ai); background: rgba(255, 255, 255, 0.6); padding: 1px 6px; border-radius: var(--r-full); }
.rw-tiers { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.rw-tier {
  font-size: 11px; padding: 2px 8px; border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.65); color: var(--text-2);
}
.rw-tier.hit { background: var(--ai); color: #fff; }
.rw-next { font-size: 12px; color: var(--text-2); margin: 8px 0 0; }
.rw-next b { color: var(--ai); }

@media (max-width: 640px) {
  .media-grid { grid-template-columns: repeat(4, 1fr); }
  .modal.review-modal { width: 100%; padding: 16px; }
}
</style>
