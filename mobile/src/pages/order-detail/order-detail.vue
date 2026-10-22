<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { api, uploadMedia } from '@/api';
import { toast } from '@/store';
import { formatTime } from '@/utils/format';

const order = ref<any>(null);
const loading = ref(true);
const eligibility = ref<any>(null);
const showRefund = ref(false);
const reason = ref('');

// 评价
const showReview = ref(false);
const rvRating = ref(5);
const rvContent = ref('');
const rvAnonymous = ref(true);
const rvItem = ref<any>(null);
const rvSubmitting = ref(false);
const rvImages = ref<any[]>([]);
const rvVideo = ref<any>(null);
const rvUploading = ref(0);
const rvRules = ref<any>(null);
// 分项评分 + 印象标签
const rvTagOptions = ref<any>(null);
const rvDims = ref<Record<string, number>>({});
const rvTags = ref<any[]>([]);
const rvCustomTags = ref<string[]>([]);
const rvCustomInput = ref('');
const rvTagCount = computed(() => rvTags.value.length + rvCustomTags.value.length);
const rvDimCount = computed(() => Object.keys(rvDims.value).length);

const rvChars = computed(() => rvContent.value.replace(/\s+/g, ' ').trim().length);

/** 与服务端同一套规则，用于即时展示"当前能返多少 / 还差什么" */
const rvReward = computed(() => {
  const r = rvRules.value;
  if (!r) return null;
  const chars = rvChars.value;
  const imageCount = rvImages.value.filter((x) => x.url).length;
  const hasVideo = !!rvVideo.value?.url;
  let tier: any = null;
  for (const t of r.tiers) {
    if (chars >= t.minChars && imageCount >= t.minImages) tier = t;
  }
  let cash = tier ? tier.cashCents : 0;
  let points = r.basePoints + (tier ? tier.points : 0);
  let videoBonus = 0;
  if (hasVideo && chars >= r.video.minChars) {
    videoBonus = r.video.cashCents;
    cash += videoBonus;
    points += r.video.points;
  }
  cash = Math.min(cash, r.maxCashCents);
  let next: any = null;
  for (const t of r.tiers) {
    if (tier && r.tiers.indexOf(t) <= r.tiers.indexOf(tier)) continue;
    next = {
      label: t.label,
      addCents: Math.max(0, t.cashCents - (tier ? tier.cashCents : 0)),
      needChars: Math.max(0, t.minChars - chars),
      needImages: Math.max(0, t.minImages - imageCount),
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
    chars, imageCount, hasVideo, tier, cashCents: cash,
    cashText: (cash / 100).toFixed(2),
    points, videoBonus, next, maxed: cash >= r.maxCashCents,
    minChars: r.tiers[0].minChars,
  };
});

const STEPS = ['待付款', '待发货', '已发货', '已完成'];

const stepIndex = (s: string) =>
  s === 'pending_payment' ? 0 : s === 'paid' ? 1 : s === 'shipped' ? 2 : 3;

onLoad(async (opt: any) => {
  try {
    const o: any = await api.order(opt.id);
    order.value = o;
    if (!['refunding', 'refunded', 'cancelled', 'pending_payment'].includes(o.status)) {
      eligibility.value = await api.eligibility(o.id);
    }
  } catch (e: any) {
    toast.err(e.message);
    setTimeout(() => uni.navigateBack(), 1000);
  } finally { loading.value = false; }
});

async function pay() {
  try {
    order.value = await api.payOrder(order.value.id);
    toast.ok('支付成功');
  } catch (e: any) { toast.err(e.message); }
}

function cancelOrder() {
  uni.showModal({
    title: '取消订单',
    content: '取消后库存会释放，确定吗？',
    success: async (r) => {
      if (!r.confirm) return;
      try {
        order.value = await api.cancelOrder(order.value.id, '用户主动取消');
        toast.ok('订单已取消');
      } catch (e: any) { toast.err(e.message); }
    },
  });
}

function confirmReceipt() {
  uni.showModal({
    title: '确认收货',
    content: '确认已经收到商品？',
    success: async (r) => {
      if (!r.confirm) return;
      try {
        order.value = await api.confirmOrder(order.value.id);
        toast.ok('已确认收货');
      } catch (e: any) { toast.err(e.message); }
    },
  });
}

function openRefund() {
  if (!eligibility.value?.eligible) { toast.err(eligibility.value?.reason || '暂不可退款'); return; }
  showRefund.value = true;
}

async function submitRefund() {
  if (!reason.value.trim()) { toast.err('请填写退款原因'); return; }
  try {
    await api.refund(order.value.id, reason.value.trim());
    order.value = await api.order(order.value.id);
    showRefund.value = false;
    toast.ok('退款申请已提交');
  } catch (e: any) { toast.err(e.message); }
}

function askAI() {
  uni.navigateTo({ url: `/pages/ai/ai?scene=support&q=${encodeURIComponent('订单 ' + order.value.orderNo + ' 到哪了')}` });
}

function openReview(it?: any) {
  rvItem.value = it || order.value.items[0];
  rvRating.value = 5;
  rvContent.value = '';
  rvAnonymous.value = true;
  rvImages.value = [];
  rvVideo.value = null;
  rvUploading.value = 0;
  rvTagOptions.value = null;
  rvDims.value = {};
  rvTags.value = [];
  rvCustomTags.value = [];
  rvCustomInput.value = '';
  showReview.value = true;
  if (!rvRules.value) {
    api.reviewRules().then((r: any) => { rvRules.value = r; }).catch(() => { /* 规则失败不阻塞评价 */ });
  }
  api.reviewTagOptions(rvItem.value.productId)
    .then((r: any) => { rvTagOptions.value = r; })
    .catch(() => { /* 标签失败不阻塞评价 */ });
}

function setDim(key: string, n: number) {
  const next: Record<string, number> = { ...rvDims.value };
  if (next[key] === n) delete next[key];
  else next[key] = n;
  rvDims.value = next;
}
function clearDims() { rvDims.value = {}; }
function isTagPicked(id: number) { return rvTags.value.some((t: any) => t.id === id); }
function toggleTag(t: any) {
  if (isTagPicked(t.id)) {
    rvTags.value = rvTags.value.filter((x: any) => x.id !== t.id);
    return;
  }
  if (rvTagCount.value >= 8) { toast.err('最多选 8 个标签'); return; }
  rvTags.value = [...rvTags.value, t];
}
function addCustomTag() {
  const name = rvCustomInput.value.replace(/\s+/g, ' ').trim();
  const len = name.length;
  if (len < 2) { toast.err('自定义标签至少 2 个字'); return; }
  if (len > 8) { toast.err('自定义标签最多 8 个字'); return; }
  if (rvCustomTags.value.indexOf(name) >= 0) { toast.err('这个标签已经加过了'); return; }
  if (rvCustomTags.value.length >= 3) { toast.err('最多自定义 3 个标签'); return; }
  if (rvTagCount.value >= 8) { toast.err('最多选 8 个标签'); return; }
  rvCustomTags.value = [...rvCustomTags.value, name];
  rvCustomInput.value = '';
}
function removeCustomTag(i: number) {
  rvCustomTags.value = rvCustomTags.value.filter((_: string, idx: number) => idx !== i);
}

/** 拍照 / 从相册选图，选完立即上传，失败自动移除占位 */
function chooseImages() {
  const left = 9 - rvImages.value.length;
  if (left <= 0) { toast.err('最多上传 9 张图片'); return; }
  uni.chooseImage({
    count: left,
    sizeType: ['compressed'],
    sourceType: ['camera', 'album'],
    success: async (res: any) => {
      const paths: string[] = res.tempFilePaths || [];
      for (const p of paths) {
        rvImages.value.push({ url: '', local: p });
        const item = rvImages.value[rvImages.value.length - 1];
        rvUploading.value += 1;
        try {
          const r = await uploadMedia(p);
          item.url = r.url;
        } catch (e: any) {
          rvImages.value = rvImages.value.filter((x) => x !== item);
          toast.err(e.message || '图片上传失败');
        } finally {
          rvUploading.value -= 1;
        }
      }
    },
  });
}

/** 录视频 / 从相册选视频 */
function chooseVideo() {
  uni.chooseVideo({
    sourceType: ['camera', 'album'],
    compressed: true,
    maxDuration: 60,
    success: async (res: any) => {
      const p = res.tempFilePath;
      if (!p) return;
      rvVideo.value = { url: '', local: p };
      const item = rvVideo.value;
      rvUploading.value += 1;
      try {
        const r = await uploadMedia(p);
        item.url = r.url;
      } catch (e: any) {
        rvVideo.value = null;
        toast.err(e.message || '视频上传失败');
      } finally {
        rvUploading.value -= 1;
      }
    },
  });
}

function removeImage(i: number) {
  rvImages.value.splice(i, 1);
}

function previewImage(url: string) {
  uni.previewImage({ current: url, urls: rvImages.value.map((x) => x.url).filter(Boolean) });
}

async function submitReview() {
  if (!order.value) return;
  if (rvUploading.value > 0) { toast.err('媒体还在上传中，请稍候'); return; }
  rvSubmitting.value = true;
  try {
    const res: any = await api.createReview({
      orderId: order.value.id,
      orderItemId: rvItem.value?.id,
      rating: rvRating.value,
      content: rvContent.value.trim(),
      images: rvImages.value.map((x) => x.url).filter(Boolean),
      video: rvVideo.value?.url || '',
      anonymous: rvAnonymous.value,
      dimensions: rvDims.value,
      tags: [
        ...rvTags.value.map((t: any) => ({ id: t.id })),
        ...rvCustomTags.value.map((name: string) => ({ name })),
      ],
    });
    showReview.value = false;
    order.value = await api.order(order.value.id);
    toast.ok(res?.reward?.message || '评价成功');
  } catch (e: any) { toast.err(e.message); }
  finally { rvSubmitting.value = false; }
}

const STAR_TEXTS = ['很差', '一般', '还行', '满意', '非常满意'];
function setStar(n: number) { rvRating.value = n; }
</script>

<template>
  <view class="page">
    <view v-if="loading" class="empty"><text>加载中…</text></view>

    <template v-else-if="order">
      <view class="head card">
        <view class="row-between">
          <text class="badge badge-primary">{{ order.statusLabel }}</text>
          <text class="dim mono" style="font-size: 20rpx">{{ formatTime(order.createdAt) }}</text>
        </view>
        <text class="no mono">{{ order.orderNo }}</text>

        <view v-if="!['refunding', 'refunded', 'cancelled'].includes(order.status)" class="steps">
          <view v-for="(s, i) in STEPS" :key="s" class="step">
            <view class="dot" :class="{ done: i <= stepIndex(order.status) }">
              <text class="dot-txt">{{ i < stepIndex(order.status) ? '✓' : i + 1 }}</text>
            </view>
            <text class="step-label" :class="{ on: i <= stepIndex(order.status) }">{{ s }}</text>
            <view v-if="i < STEPS.length - 1" class="line" :class="{ done: i < stepIndex(order.status) }" />
          </view>
        </view>
        <view v-else class="status-note">
          {{ order.status === 'cancelled'
            ? '订单已取消' + (order.cancelReason ? '：' + order.cancelReason : '')
            : order.status === 'refunded' ? '退款已完成' : '退款处理中，商家将在 1-3 个工作日内审核' }}
        </view>
      </view>

      <view class="card block">
        <view class="row-between" style="margin-bottom: 12rpx">
          <text class="block-title" style="margin: 0">商品</text>
          <text v-if="order.shopName" class="dim" style="font-size: 20rpx">{{ order.isSelf ? '自营 · ' : '' }}{{ order.shopName }}</text>
        </view>
        <view v-for="it in order.items" :key="it.id" class="item" @tap="uni.navigateTo({ url: `/pages/detail/detail?id=${it.productId}` })">
          <view class="it-thumb"><text class="it-emoji">{{ it.image || '📦' }}</text></view>
          <view class="grow">
            <text class="item-title">{{ it.title }}</text>
            <text v-if="it.specText" class="spec-tag">{{ it.specText }}</text>
            <text class="dim" style="font-size: 22rpx; display: block; margin-top: 4rpx">¥{{ it.price }} × {{ it.qty }}</text>
          </view>
          <text class="mono">¥{{ (it.price * it.qty).toFixed(2) }}</text>
        </view>
        <view class="divider" style="margin: 16rpx 0" />
        <view class="sum-row"><text class="muted">商品小计</text><text class="mono">¥{{ order.subtotal }}</text></view>
        <view v-if="order.pricing?.memberDiscount" class="sum-row cut">
          <text class="muted">{{ order.pricing.memberLabel }} 会员优惠</text>
          <text class="mono">-¥{{ order.pricing.memberDiscount.toFixed(2) }}</text>
        </view>
        <view v-if="order.pricing?.couponDiscount" class="sum-row cut">
          <text class="muted">{{ order.pricing.couponTitle || '优惠券' }}</text>
          <text class="mono">-¥{{ order.pricing.couponDiscount.toFixed(2) }}</text>
        </view>
        <view v-if="order.pricing?.fullCut" class="sum-row cut">
          <text class="muted">满减</text>
          <text class="mono">-¥{{ order.pricing.fullCut.toFixed(2) }}</text>
        </view>
        <view v-if="order.pricing?.pointsDiscount" class="sum-row cut">
          <text class="muted">积分抵现（{{ order.pricing.pointsUsed }} 分）</text>
          <text class="mono">-¥{{ order.pricing.pointsDiscount.toFixed(2) }}</text>
        </view>
        <view v-if="order.pricing?.balanceDiscount" class="sum-row cut">
          <text class="muted">余额抵扣</text>
          <text class="mono">-¥{{ order.pricing.balanceDiscount.toFixed(2) }}</text>
        </view>
        <view class="sum-row"><text class="muted">运费</text><text class="mono">{{ order.shipping ? '¥' + order.shipping : '免运费' }}</text></view>
        <view class="sum-row total"><text>实付</text><text class="price" style="font-size: 36rpx">¥{{ order.total }}</text></view>
      </view>

      <!-- 物流轨迹 -->
      <view v-if="order.shipment" class="card block">
        <view class="row-between" style="margin-bottom: 14rpx">
          <text class="block-title" style="margin: 0">物流轨迹</text>
          <text class="dim mono" style="font-size: 20rpx">
            {{ order.shipment.carrier || '快递' }} {{ order.shipment.trackingNo || '' }}
          </text>
        </view>
        <view class="ship-progress">
          <view class="ship-progress-fill" :style="{ width: order.shipment.progress + '%' }" />
        </view>
        <text class="ship-next">{{ order.shipment.next }}</text>
        <view v-for="(e, i) in order.shipment.events" :key="i" class="ship-event" :class="{ first: i === 0 }">
          <view class="ship-dot" :class="{ on: i === 0 }" />
          <view class="grow">
            <text class="ship-status">{{ e.status }}</text>
            <text class="ship-desc">{{ e.description }}{{ e.location ? '（' + e.location + '）' : '' }}</text>
          </view>
          <text class="dim" style="font-size: 18rpx">{{ e.at }}</text>
        </view>
        <view v-if="!order.shipment.events.length" class="dim" style="font-size: 22rpx">暂无轨迹</view>
      </view>

      <view class="card block">
        <text class="block-title">收货信息</text>
        <view class="kv"><text class="k">地址</text><text class="v">{{ order.address }}</text></view>
        <view v-if="order.remark" class="kv"><text class="k">备注</text><text class="v">{{ order.remark }}</text></view>
        <view class="kv"><text class="k">下单</text><text class="v mono">{{ formatTime(order.createdAt) }}</text></view>
        <view v-if="order.shippedAt" class="kv"><text class="k">发货</text><text class="v mono">{{ formatTime(order.shippedAt) }}</text></view>
        <view v-if="order.carrier || order.trackingNo" class="kv">
          <text class="k">物流</text>
          <text class="v mono">{{ order.carrier || '快递' }} {{ order.trackingNo || '（未填运单号）' }}</text>
        </view>
        <view v-if="order.completedAt" class="kv"><text class="k">完成</text><text class="v mono">{{ formatTime(order.completedAt) }}</text></view>
        <view v-if="eligibility" class="hint" :class="eligibility.eligible ? 'ok' : 'warn'">
          {{ eligibility.eligible ? '✓' : '!' }} {{ eligibility.reason }}
        </view>
      </view>

      <view class="actions">
        <view v-if="order.status === 'pending_payment'" class="btn btn-primary" @tap="pay">模拟支付</view>
        <view v-if="order.status === 'shipped'" class="btn btn-primary" @tap="confirmReceipt">确认收货</view>
        <view v-if="order.status === 'completed' && !order.reviewed" class="btn btn-primary" @tap="openReview()">评价晒单 · 最高返 ¥5</view>
        <view v-if="order.status === 'completed' && order.reviewed" class="btn btn-ghost" style="opacity:.6">已评价</view>
        <view v-if="['pending_payment', 'paid'].includes(order.status)" class="btn btn-ghost" @tap="cancelOrder">取消订单</view>
        <view class="btn btn-ai" @tap="askAI">问问 AI 客服</view>
        <view
          v-if="order.status !== 'refunding' && order.status !== 'refunded' && order.status !== 'cancelled'"
          class="btn btn-ghost" @tap="openRefund"
        >申请退款</view>
      </view>
    </template>

    <!-- 退款弹层 -->
    <view v-if="showRefund" class="mask" @tap="showRefund = false">
      <view class="modal" @tap.stop>
        <text class="modal-title">申请退款</text>
        <text class="dim" style="font-size: 22rpx; display: block; margin-bottom: 20rpx">
          退款金额 ¥{{ order?.total }}，审核通过后原路退回
        </text>
        <textarea v-model="reason" class="textarea" placeholder="请简要说明退款原因" />
        <view class="modal-actions">
          <view class="btn btn-ghost grow" @tap="showRefund = false">取消</view>
          <view class="btn btn-primary grow" @tap="submitRefund">提交</view>
        </view>
      </view>
    </view>

    <!-- 评价弹层：拍照 / 录像 + 图文返现 -->
    <view v-if="showReview" class="mask" @tap="showReview = false">
      <view class="modal review-modal" @tap.stop>
        <scroll-view scroll-y class="review-scroll">
        <text class="modal-title">评价商品</text>
        <view v-if="rvItem" class="rv-target">
          <text class="rv-target-emoji">{{ rvItem.image || '📦' }}</text>
          <text class="rv-target-title">{{ rvItem.title }}</text>
        </view>

        <view class="star-row">
          <text
            v-for="n in [1, 2, 3, 4, 5]" :key="n"
            class="star" :class="{ on: n <= rvRating }"
            @tap="setStar(n)"
          >★</text>
          <text class="star-txt">{{ STAR_TEXTS[rvRating - 1] }}</text>
        </view>

        <!-- 分项评分：外观 / 性能 / 颜色… -->
        <view v-if="rvTagOptions" class="rv-section">
          <view class="sec-head">
            <text class="sec-label">分项评分</text>
            <text v-if="rvDimCount" class="sec-link" @tap="clearDims">清空</text>
            <text v-else class="sec-tip">选填</text>
          </view>
          <view class="dim-list">
            <view v-for="d in rvTagOptions.dimensions" :key="d.key" class="dim-line">
              <text class="dim-name">{{ d.icon }} {{ d.label }}</text>
              <view class="mini-stars">
                <text
                  v-for="s in [1, 2, 3, 4, 5]" :key="s"
                  class="mini-star" :class="{ on: (rvDims[d.key] || 0) >= s }"
                  @tap="setDim(d.key, s)"
                >★</text>
              </view>
              <text class="dim-val" :class="{ none: !rvDims[d.key] }">{{ rvDims[d.key] ? rvDims[d.key] + '.0' : '未评' }}</text>
            </view>
          </view>
        </view>

        <!-- 印象标签 -->
        <view v-if="rvTagOptions" class="rv-section">
          <view class="sec-head">
            <text class="sec-label">印象标签</text>
            <text class="sec-tip">已选 {{ rvTagCount }}/8</text>
          </view>
          <view v-for="g in rvTagOptions.groups" :key="g.key" class="tag-group">
            <text class="tg-dim">{{ g.icon }} {{ g.label }}</text>
            <view class="tg-chips">
              <text
                v-for="t in g.tags" :key="t.id" class="tg-chip"
                :class="{ on: isTagPicked(t.id), bad: t.polarity === 'bad' }"
                @tap="toggleTag(t)"
              >{{ t.name }}</text>
            </view>
          </view>
          <view class="custom-row">
            <input
              v-model="rvCustomInput" class="custom-input" maxlength="8"
              placeholder="没找到合适的？自己写（2–8 字）"
              @confirm="addCustomTag"
            />
            <view class="custom-add" @tap="addCustomTag">添加</view>
          </view>
          <view v-if="rvCustomTags.length" class="custom-list">
            <view v-for="(tag, i) in rvCustomTags" :key="tag" class="custom-chip">
              <text>{{ tag }}</text>
              <text class="cc-x" @tap="removeCustomTag(i)">×</text>
            </view>
          </view>
        </view>

        <view class="ta-head">
          <text class="ta-label">使用感受</text>
          <text class="ta-count" :class="{ ok: rvReward && rvChars >= rvReward.minChars }">
            {{ rvChars }} 字<text v-if="rvReward"> / 建议 {{ rvReward.minChars }} 字起</text>
          </text>
        </view>
        <textarea
          v-model="rvContent"
          class="textarea"
          placeholder="用起来怎么样？有什么要提醒别人的？（至少 15 字更容易拿返现）"
          maxlength="1000"
        />

        <!-- 图片 -->
        <view class="media-head">
          <text class="media-label">晒图 {{ rvImages.length }}/9</text>
          <text class="media-tip">第一张为封面</text>
        </view>
        <view class="media-grid">
          <view v-for="(img, i) in rvImages" :key="i" class="media-cell">
            <image
              v-if="img.url"
              :src="img.url"
              mode="aspectFill"
              class="media-img"
              @tap="previewImage(img.url)"
            />
            <view v-else class="media-loading"><text class="ml-txt">上传中</text></view>
            <view class="media-del" @tap.stop="removeImage(i)"><text class="md-x">×</text></view>
          </view>
          <view v-if="rvImages.length < 9" class="media-add" @tap="chooseImages">
            <text class="ma-plus">+</text>
            <text class="ma-txt">拍照/选图</text>
          </view>
        </view>

        <!-- 视频 -->
        <view class="media-head">
          <text class="media-label">短视频 {{ rvVideo ? 1 : 0 }}/1</text>
          <text class="media-tip">带视频额外 +¥2.00</text>
        </view>
        <view v-if="rvVideo" class="video-wrap">
          <video v-if="rvVideo.url" :src="rvVideo.url" class="video-el" controls />
          <view v-else class="media-loading video-loading"><text class="ml-txt">上传中…</text></view>
          <view class="media-del" @tap.stop="rvVideo = null"><text class="md-x">×</text></view>
        </view>
        <view v-else class="video-add" @tap="chooseVideo">
          <text class="va-ico">▶</text>
          <text class="va-txt">拍摄或选择视频</text>
          <text class="va-hint">建议 60 秒内</text>
        </view>

        <!-- 返现规则 -->
        <view v-if="rvReward" class="reward-card">
          <view class="rw-top">
            <text class="rw-badge">评价返现</text>
            <text class="rw-cash">预计 ¥{{ rvReward.cashText }}</text>
            <text class="rw-pts">+{{ rvReward.points }} 积分</text>
          </view>
          <view class="rw-tiers">
            <text
              v-for="t in rvRules.tiers" :key="t.key"
              class="rw-tier" :class="{ hit: rvReward.tier && rvReward.tier.key === t.key }"
            >{{ t.tip }} → ¥{{ (t.cashCents / 100).toFixed(2) }}</text>
            <text class="rw-tier" :class="{ hit: rvReward.videoBonus > 0 }">视频 + 15 字 → +¥2.00</text>
          </view>
          <text v-if="rvReward.next && rvReward.next.addCents > 0" class="rw-next">
            再加<text v-if="rvReward.next.needChars"> {{ rvReward.next.needChars }} 字</text><text v-if="rvReward.next.needImages"> {{ rvReward.next.needImages }} 张图</text><text v-if="rvReward.next.needVideo"> 1 段视频</text>，可多返 ¥{{ (rvReward.next.addCents / 100).toFixed(2) }}
          </text>
          <text v-else-if="rvReward.maxed" class="rw-next">已达单条评价返现上限 ¥5.00</text>
          <text v-else class="rw-next">至少 1 张图 + 15 字，即可获得 ¥1.00 返现</text>
        </view>

        <view class="anon-row" @tap="rvAnonymous = !rvAnonymous">
          <view class="radio" :class="{ on: rvAnonymous }">
            <text v-if="rvAnonymous" class="radio-txt">✓</text>
          </view>
          <text class="anon-txt">匿名评价</text>
        </view>
        </scroll-view>

        <view class="modal-actions">
          <view class="btn btn-ghost grow" @tap="showReview = false">取消</view>
          <view class="btn btn-primary grow" :class="{ dis: rvSubmitting }" @tap="submitReview">
            {{ rvSubmitting ? '提交中…' : rvUploading > 0 ? '上传中 ' + rvUploading + '…' : '提交评价' }}
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 20rpx 20rpx 40rpx; }
.head { padding: 28rpx; margin-bottom: 20rpx; }
.no { display: block; font-size: 34rpx; font-weight: 600; margin: 14rpx 0 4rpx; }

.steps { display: flex; margin-top: 36rpx; }
.step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10rpx; position: relative; }
.dot {
  width: 48rpx; height: 48rpx;
  border-radius: 50%;
  background: #f1f3f7;
  border: 1rpx solid #e4e7ee;
  display: flex; align-items: center; justify-content: center;
  z-index: 1;
}
.dot.done { background: #2f5bea; border-color: #2f5bea; }
.dot-txt { font-size: 20rpx; color: #8d94a6; }
.dot.done .dot-txt { color: #fff; font-weight: 600; }
.step-label { font-size: 20rpx; color: #8d94a6; }
.step-label.on { color: #2f5bea; }
.line {
  position: absolute;
  top: 24rpx; left: 50%;
  width: 100%; height: 1rpx;
  background: #e4e7ee;
}
.line.done { background: #2f5bea; }
.status-note {
  margin-top: 28rpx;
  padding: 20rpx;
  background: #fdf3e4;
  color: #e08b1e;
  border-radius: 12rpx;
  font-size: 24rpx;
}

.block { padding: 28rpx; margin-bottom: 20rpx; }
.block-title { font-size: 28rpx; font-weight: 600; display: block; margin-bottom: 16rpx; }
.item { display: flex; align-items: center; gap: 16rpx; padding: 12rpx 0; border-bottom: 1rpx solid #f1f3f7; }
.item-title { font-size: 26rpx; }
.it-thumb {
  width: 96rpx; height: 96rpx; border-radius: 12rpx; background: #f1f3f7;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.it-emoji { font-size: 44rpx; }
.spec-tag {
  display: inline-block; font-size: 20rpx; color: #5a6072;
  background: #f1f3f7; padding: 2rpx 12rpx; border-radius: 6rpx; margin-top: 6rpx;
}
.sum-row { display: flex; justify-content: space-between; font-size: 26rpx; padding: 8rpx 0; }
.sum-row.cut .mono { color: #d93b4a; }
.total { align-items: baseline; font-weight: 500; }

.ship-progress { height: 8rpx; background: #f1f3f7; border-radius: 999rpx; overflow: hidden; }
.ship-progress-fill { height: 100%; background: #2f5bea; }
.ship-next { display: block; font-size: 22rpx; color: #2f5bea; background: #edf1fe; padding: 10rpx 16rpx; border-radius: 8rpx; margin-top: 14rpx; }
.ship-event { display: flex; align-items: flex-start; gap: 14rpx; padding: 14rpx 0 0; }
.ship-dot {
  width: 14rpx; height: 14rpx; border-radius: 50%; background: #d3d8e3; margin-top: 10rpx; flex-shrink: 0;
}
.ship-dot.on { background: #2f5bea; }
.ship-status { display: block; font-size: 24rpx; font-weight: 500; }
.ship-event.first .ship-status { color: #2f5bea; }
.ship-desc { display: block; font-size: 20rpx; color: #8d94a6; line-height: 1.5; }

.rv-target {
  display: flex; align-items: center; gap: 14rpx;
  background: #f7f8fa; border-radius: 12rpx; padding: 14rpx; margin: 12rpx 0 18rpx;
}
.rv-target-emoji { font-size: 34rpx; }
.rv-target-title {
  font-size: 22rpx; flex: 1;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
}
.star-row { display: flex; align-items: center; gap: 10rpx; margin-bottom: 18rpx; }
.star { font-size: 44rpx; color: #e4e7ee; }
.star.on { color: #f0b429; }
.star-txt { font-size: 22rpx; color: #8d94a6; margin-left: 8rpx; }
.anon-row { display: flex; align-items: center; gap: 12rpx; margin: 6rpx 0 20rpx; }
.anon-txt { font-size: 24rpx; color: #5a6072; }
.radio {
  width: 32rpx; height: 32rpx; border-radius: 50%;
  border: 2rpx solid #c2c8d4; display: flex; align-items: center; justify-content: center;
}
.radio.on { border-color: #2f5bea; background: #2f5bea; }
.radio-txt { font-size: 18rpx; color: #fff; }

.kv { display: flex; gap: 16rpx; font-size: 26rpx; padding: 10rpx 0; }
.k { width: 76rpx; color: #8d94a6; flex-shrink: 0; }
.v { flex: 1; }
.hint { margin-top: 18rpx; padding: 16rpx 20rpx; border-radius: 12rpx; font-size: 22rpx; }
.hint.ok { background: #e8f7ef; color: #12a05c; }
.hint.warn { background: #fdf3e4; color: #e08b1e; }

.actions { display: flex; flex-direction: column; gap: 16rpx; margin-top: 12rpx; }

.mask {
  /* 不用 inset 简写：老基础库/旧 WebView 不支持，会导致遮罩塌缩 */
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex; align-items: flex-end;
  z-index: 200;
}
.modal {
  width: 100%;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  padding: 36rpx 32rpx calc(36rpx + env(safe-area-inset-bottom));
}
.modal-title { font-size: 32rpx; font-weight: 600; display: block; margin-bottom: 10rpx; }
.textarea {
  width: 100%;
  height: 180rpx;
  background: #f1f3f7;
  border-radius: 14rpx;
  padding: 20rpx;
  font-size: 26rpx;
  margin-bottom: 24rpx;
}
.modal-actions { display: flex; gap: 16rpx; }

/* ── 评价：拍照 / 录像 / 返现 ── */
.review-modal { padding-bottom: calc(28rpx + env(safe-area-inset-bottom)); }
.review-scroll { max-height: 72vh; }
.ta-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10rpx; }
.ta-label { font-size: 24rpx; color: #5a6072; }
.ta-count { font-size: 20rpx; color: #8d94a6; }
.ta-count.ok { color: #12a05c; }

.media-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin: 8rpx 0 12rpx;
}
.media-label { font-size: 24rpx; color: #374151; }
.media-tip { font-size: 20rpx; color: #8d94a6; }
.media-grid { display: flex; flex-wrap: wrap; gap: 12rpx; margin-bottom: 8rpx; }
.media-cell {
  position: relative;
  width: 148rpx; height: 148rpx;
  border-radius: 12rpx; overflow: hidden;
  background: #f1f3f7;
}
.media-img { width: 100%; height: 100%; }
.media-loading {
  position: absolute; left: 0; top: 0; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(16, 24, 40, 0.5);
}
.ml-txt { font-size: 20rpx; color: #fff; }
.media-del {
  position: absolute; top: 4rpx; right: 4rpx;
  width: 34rpx; height: 34rpx; border-radius: 50%;
  background: rgba(16, 24, 40, 0.6);
  display: flex; align-items: center; justify-content: center;
}
.md-x { font-size: 24rpx; color: #fff; line-height: 1; }
.media-add {
  width: 148rpx; height: 148rpx;
  border: 2rpx dashed #d5dae4; border-radius: 12rpx;
  background: #f7f8fb;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2rpx;
}
.ma-plus { font-size: 40rpx; color: #8d94a6; line-height: 1; }
.ma-txt { font-size: 18rpx; color: #8d94a6; }

.video-wrap {
  position: relative;
  border-radius: 12rpx; overflow: hidden;
  background: #000; margin-bottom: 8rpx;
}
.video-el { width: 100%; height: 320rpx; }
.video-loading { position: absolute; }
.video-add {
  display: flex; align-items: center; gap: 12rpx;
  padding: 22rpx;
  border: 2rpx dashed #d5dae4; border-radius: 12rpx;
  background: #f7f8fb;
}
.va-ico {
  width: 40rpx; height: 40rpx; border-radius: 50%;
  background: #e8ecff; color: #2f5bea;
  display: flex; align-items: center; justify-content: center;
  font-size: 18rpx;
}
.va-txt { font-size: 24rpx; color: #374151; }
.va-hint { font-size: 20rpx; color: #8d94a6; margin-left: auto; }

/* 分项评分 + 印象标签 */
.rv-section { margin-top: 22rpx; padding-top: 18rpx; border-top: 2rpx dashed #eef0f5; }
.sec-head { display: flex; align-items: center; gap: 10rpx; margin-bottom: 12rpx; }
.sec-label { font-size: 24rpx; font-weight: 600; color: #1f2430; }
.sec-tip { font-size: 20rpx; color: #8d94a6; margin-left: auto; }
.sec-link { font-size: 20rpx; color: #2f5bea; margin-left: auto; }
.dim-list { display: flex; flex-direction: column; gap: 10rpx; }
.dim-line { display: flex; align-items: center; gap: 12rpx; }
.dim-name { width: 140rpx; font-size: 22rpx; color: #5a6072; }
.mini-stars { display: flex; gap: 2rpx; }
.mini-star { font-size: 26rpx; color: #dfe3ea; line-height: 1; }
.mini-star.on { color: #fbbf24; }
.dim-val { min-width: 56rpx; text-align: right; font-size: 20rpx; color: #5a6072; }
.dim-val.none { color: #aab0bd; }
.tag-group { display: flex; gap: 10rpx; margin-bottom: 12rpx; align-items: flex-start; }
.tg-dim { width: 130rpx; flex-shrink: 0; padding-top: 8rpx; font-size: 20rpx; color: #8d94a6; }
.tg-chips { display: flex; flex-wrap: wrap; gap: 10rpx; flex: 1; }
.tg-chip {
  font-size: 21rpx; color: #5a6072; background: #f7f8fb;
  border: 2rpx solid #e6e9f0; border-radius: 99rpx; padding: 6rpx 16rpx;
}
.tg-chip.on { background: #eef2ff; border-color: #2f5bea; color: #2f5bea; font-weight: 600; }
.tg-chip.bad { border-style: dashed; }
.tg-chip.bad.on { background: #fef2f2; border-color: #ef4444; color: #b91c1c; }
.custom-row { display: flex; gap: 12rpx; margin-top: 8rpx; }
.custom-input { flex: 1; height: 64rpx; background: #f7f8fb; border-radius: 10rpx; padding: 0 16rpx; font-size: 22rpx; }
.custom-add {
  width: 100rpx; height: 64rpx; border-radius: 10rpx; background: #eef2ff; color: #2f5bea;
  font-size: 22rpx; display: flex; align-items: center; justify-content: center;
}
.custom-list { display: flex; flex-wrap: wrap; gap: 10rpx; margin-top: 12rpx; }
.custom-chip {
  display: flex; align-items: center; gap: 6rpx; font-size: 21rpx; color: #374151;
  background: #f2f4f8; border-radius: 99rpx; padding: 4rpx 14rpx;
}
.cc-x { color: #8d94a6; font-size: 24rpx; line-height: 1; }

.reward-card {
  margin-top: 20rpx;
  padding: 18rpx 20rpx;
  background: #f2f4ff;
  border-radius: 14rpx;
}
.rw-top { display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; }
.rw-badge {
  font-size: 18rpx; color: #2f5bea;
  background: #e2e7ff; border-radius: 99rpx; padding: 2rpx 10rpx;
}
.rw-cash { font-size: 28rpx; font-weight: 600; color: #2f5bea; }
.rw-pts { font-size: 20rpx; color: #5a6072; }
.rw-tiers { display: flex; flex-wrap: wrap; gap: 8rpx; margin-top: 12rpx; }
.rw-tier {
  font-size: 18rpx; color: #5a6072;
  background: rgba(255, 255, 255, 0.75);
  border-radius: 99rpx; padding: 4rpx 12rpx;
}
.rw-tier.hit { background: #2f5bea; color: #fff; }
.rw-next {
  display: block;
  font-size: 20rpx; color: #5a6072;
  margin-top: 12rpx; line-height: 1.6;
}
</style>
