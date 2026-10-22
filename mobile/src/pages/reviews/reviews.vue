<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onReachBottom } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, toast, requireLogin } from '@/store';

const auth = useAuth();
const productId = ref(0);
const items = ref<any[]>([]);
const breakdown = ref<any>(null);
const summary = ref<any>(null);
const total = ref(0);
const rating = ref(0);
const mediaOnly = ref(false);
const tagStats = ref<any>(null);
const tagId = ref(0);
const tagName = ref('');
const page = ref(1);
const loading = ref(true);
const hasMore = ref(true);

const tagGroups = computed<any[]>(() => (tagStats.value?.groups || []).filter((g: any) => g.tags && g.tags.length));
const scoredDims = computed<any[]>(() => (tagStats.value?.dimensions || []).filter((d: any) => d.count > 0));

onLoad(async (opt: any) => {
  productId.value = Number(opt.id || 0);
  await load(true);
});

onReachBottom(() => { load(); });

async function load(reset = false) {
  if (!productId.value) return;
  if (reset) { page.value = 1; hasMore.value = true; }
  if (!hasMore.value) return;
  try {
    const r: any = await api.reviews(productId.value, {
      rating: rating.value,
      withMedia: mediaOnly.value ? 1 : 0,
      tagId: tagId.value || undefined,
      page: page.value,
      pageSize: 10,
    });
    items.value = reset ? r.items : [...items.value, ...r.items];
    breakdown.value = r.breakdown;
    summary.value = r.summary;
    tagStats.value = r.tagStats;
    total.value = r.total;
    hasMore.value = items.value.length < r.total;
    page.value += 1;
  } catch (e: any) {
    toast.err(e.message);
  } finally {
    loading.value = false;
  }
}

function filter(r: number) {
  rating.value = r;
  tagId.value = 0;
  tagName.value = '';
  items.value = [];
  load(true);
}

function toggleMedia() {
  mediaOnly.value = !mediaOnly.value;
  tagId.value = 0;
  tagName.value = '';
  items.value = [];
  hasMore.value = true;
  load(true);
}

function toggleTag(t: any) {
  if (tagId.value === t.id) {
    tagId.value = 0;
    tagName.value = '';
  } else {
    tagId.value = t.id;
    tagName.value = t.name;
  }
  items.value = [];
  hasMore.value = true;
  load(true);
}

function clearTag() {
  tagId.value = 0;
  tagName.value = '';
  items.value = [];
  hasMore.value = true;
  load(true);
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

function preview(r: any, url: string) {
  uni.previewImage({ current: url, urls: r.images || [] });
}

async function useful(r: any) {
  if (!requireLogin(auth)) return;
  try { const x: any = await api.usefulReview(r.id); r.useful = x.useful; } catch (e: any) { toast.err(e.message); }
}

const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
const avgStars = computed(() => stars(Math.round(breakdown.value?.average || 0)));
</script>

<template>
  <view class="page">
    <!-- 概览 -->
    <view class="card sum">
      <view class="sum-left">
        <text class="avg mono">{{ breakdown?.average || 0 }}</text>
        <text class="stars-lg">{{ avgStars }}</text>
        <text class="dim" style="font-size: 20rpx">好评率 {{ breakdown?.goodRate || 0 }}%</text>
      </view>
      <view class="grow">
        <view v-for="b in breakdown?.dist || []" :key="b.star" class="bar-row">
          <text class="bar-label">{{ b.star }} 星</text>
          <view class="bar"><view class="bar-fill" :style="{ width: b.percent + '%' }" /></view>
          <text class="bar-num mono">{{ b.count }}</text>
        </view>
      </view>
    </view>

    <view v-if="summary" class="ai card">
      <text class="ai-tag">AI 评价摘要</text>
      <text class="ai-txt">{{ summary.oneLine }}</text>
      <text class="ai-verdict">{{ summary.verdict }}</text>
      <view class="ai-cols">
        <view v-if="summary.pros?.length" class="ai-col">
          <text class="ai-col-title good">好在哪</text>
          <text v-for="(t, i) in summary.pros" :key="'p' + i" class="ai-li">· {{ t }}</text>
        </view>
        <view v-if="summary.cons?.length" class="ai-col">
          <text class="ai-col-title bad">注意点</text>
          <text v-for="(t, i) in summary.cons" :key="'c' + i" class="ai-li">· {{ t }}</text>
        </view>
      </view>
    </view>

    <!-- 买家印象：标签云，点标签筛选 -->
    <view v-if="tagGroups.length" class="card imp">
      <view class="row-between" style="margin-bottom: 12rpx">
        <text class="imp-title">买家印象</text>
        <text class="dim" style="font-size: 20rpx">{{ tagStats?.tagged || 0 }} 人参与 · 点标签筛选</text>
      </view>
      <view v-if="tagId" class="imp-filter" @tap="clearTag">
        <text class="imp-filter-txt">已筛「{{ tagName }}」</text>
        <text class="imp-filter-x">×</text>
      </view>
      <view v-for="g in tagGroups" :key="g.key" class="imp-group">
        <text class="imp-dim">{{ g.icon }} {{ g.label }}</text>
        <view class="imp-chips">
          <text
            v-for="t in g.tags" :key="t.id" class="imp-chip"
            :class="{ on: tagId === t.id, bad: t.polarity === 'bad' }"
            @tap="toggleTag(t)"
          >{{ t.name }} {{ t.count }}</text>
        </view>
      </view>
    </view>

    <!-- 分项评分 -->
    <view v-if="scoredDims.length" class="card dims">
      <text class="dims-title">分项评分</text>
      <view v-for="d in scoredDims" :key="d.key" class="dline">
        <text class="dname">{{ d.icon }} {{ d.label }}</text>
        <view class="dtrack"><view class="dfill" :style="{ width: (d.avg / 5 * 100) + '%' }" /></view>
        <text class="dnum">{{ d.avg }}</text>
      </view>
    </view>

    <view class="filters">
      <text v-for="r in [0, 5, 4, 3, 2, 1]" :key="r"
            class="chip" :class="{ on: rating === r && !mediaOnly }" @tap="filter(r)">
        {{ r === 0 ? '全部 ' + total : r + ' 星' }}
      </text>
      <text class="chip" :class="{ on: mediaOnly }" @tap="toggleMedia">有图 / 视频</text>
    </view>

    <view v-for="r in items" :key="r.id" class="card rv">
      <view class="row-between">
        <view class="row" style="gap: 12rpx">
          <view class="avatar"><text class="avatar-txt">{{ r.userName.slice(0, 1) }}</text></view>
          <text class="rv-name">{{ r.userName }}</text>
          <text v-if="r.rewardCents" class="rv-reward">返 ¥{{ (r.rewardCents / 100).toFixed(2) }}</text>
        </view>
        <text class="stars">{{ stars(r.rating) }}</text>
      </view>
      <text v-if="dimText(r.dimensions)" class="rv-dims">{{ dimText(r.dimensions) }}</text>
      <view v-if="r.tags && r.tags.length" class="rv-tags">
        <text
          v-for="t in r.tags" :key="t.id" class="rv-tag"
          :class="{ bad: t.polarity === 'bad', custom: t.dimension === 'custom' }"
        >{{ t.name }}</text>
      </view>
      <text class="rv-content">{{ r.content }}</text>
      <view v-if="r.video || (r.images && r.images.length)" class="rv-media">
        <video v-if="r.video" :src="r.video" class="rv-video" controls />
        <view
          v-for="(img, i) in (r.images || [])" :key="i"
          class="rv-thumb" @tap="preview(r, img)"
        >
          <image :src="img" mode="aspectFill" class="rv-thumb-img" />
        </view>
      </view>
      <view v-if="r.reply" class="rv-reply"><text class="rv-reply-txt">商家回复：{{ r.reply }}</text></view>
      <view class="row-between" style="margin-top: 12rpx">
        <text class="dim" style="font-size: 20rpx">{{ r.createdAt }}</text>
        <text class="useful" @tap="useful(r)">有用 {{ r.useful }}</text>
      </view>
    </view>

    <view v-if="loading" class="empty"><text>加载中…</text></view>
    <view v-else-if="!items.length" class="empty"><text>还没有评价</text></view>
    <view v-else-if="!hasMore" class="foot">没有更多了</view>
  </view>
</template>

<style scoped>
.page { padding: 20rpx 20rpx 60rpx; }

.sum { display: flex; gap: 24rpx; padding: 26rpx; margin-bottom: 16rpx; align-items: center; }
.sum-left { width: 170rpx; text-align: center; }
.avg { display: block; font-size: 56rpx; font-weight: 600; color: #d93b4a; }
.stars-lg { display: block; font-size: 22rpx; color: #f0b429; margin: 4rpx 0; }
.bar-row { display: flex; align-items: center; gap: 10rpx; margin-bottom: 6rpx; }
.bar-label { font-size: 18rpx; color: #8d94a6; width: 56rpx; }
.bar { flex: 1; height: 10rpx; background: #f1f3f7; border-radius: 999rpx; overflow: hidden; }
.bar-fill { height: 100%; background: #f0b429; }
.bar-num { font-size: 18rpx; color: #8d94a6; width: 40rpx; text-align: right; }

.ai { padding: 24rpx; margin-bottom: 16rpx; background: #fbfaff; border-color: #e6e0fd; }
.ai-tag { font-size: 20rpx; color: #6b4ef5; background: #f1eefe; padding: 4rpx 12rpx; border-radius: 6rpx; }
.ai-txt { display: block; font-size: 24rpx; line-height: 1.7; margin-top: 12rpx; }
.ai-verdict { display: block; font-size: 20rpx; color: #6b4ef5; margin-top: 8rpx; }
.ai-cols { display: flex; gap: 20rpx; margin-top: 12rpx; }
.ai-col { flex: 1; }
.ai-col-title { font-size: 20rpx; display: block; margin-bottom: 6rpx; }
.ai-col-title.good { color: #12a05c; }
.ai-col-title.bad { color: #e08b1e; }
.ai-li { display: block; font-size: 20rpx; color: #5a6072; line-height: 1.6; }

.imp { padding: 22rpx; margin-bottom: 16rpx; }
.imp-title { font-size: 26rpx; font-weight: 600; }
.imp-filter {
  display: flex; align-items: center; gap: 8rpx; align-self: flex-start;
  background: #fff5f5; border: 1rpx solid #fecaca; border-radius: 99rpx;
  padding: 4rpx 14rpx; margin-bottom: 12rpx; width: fit-content;
}
.imp-filter-txt { font-size: 20rpx; color: #b91c1c; }
.imp-filter-x { font-size: 22rpx; color: #b91c1c; }
.imp-group { display: flex; gap: 10rpx; margin-top: 8rpx; align-items: flex-start; }
.imp-dim { width: 130rpx; flex-shrink: 0; padding-top: 6rpx; font-size: 20rpx; color: #8d94a6; }
.imp-chips { display: flex; flex-wrap: wrap; gap: 10rpx; flex: 1; }
.imp-chip {
  font-size: 21rpx; color: #5a6072; background: #f7f8fb;
  border: 1rpx solid #e4e7ee; border-radius: 99rpx; padding: 6rpx 16rpx;
}
.imp-chip.on { background: #111827; border-color: #111827; color: #fff; }
.imp-chip.bad { border-style: dashed; }
.imp-chip.bad.on { background: #b91c1c; border-color: #b91c1c; }

.dims { padding: 22rpx; margin-bottom: 16rpx; }
.dims-title { display: block; font-size: 24rpx; font-weight: 600; margin-bottom: 12rpx; }
.dline { display: flex; align-items: center; gap: 10rpx; margin-bottom: 8rpx; }
.dname { width: 130rpx; font-size: 20rpx; color: #5a6072; }
.dtrack { flex: 1; height: 10rpx; background: #f1f3f7; border-radius: 99rpx; overflow: hidden; }
.dfill { height: 100%; background: linear-gradient(90deg, #fbbf24, #f59e0b); }
.dnum { width: 48rpx; text-align: right; font-size: 20rpx; color: #5a6072; }

.filters { display: flex; gap: 12rpx; flex-wrap: wrap; margin-bottom: 16rpx; }
.chip { font-size: 22rpx; padding: 8rpx 22rpx; border-radius: 999rpx; background: #fff; border: 1rpx solid #e4e7ee; color: #5a6072; }
.chip.on { background: #edf1fe; border-color: #2f5bea; color: #2f5bea; }

.rv { padding: 22rpx; margin-bottom: 14rpx; }
.avatar {
  width: 44rpx; height: 44rpx; border-radius: 50%; background: #edf1fe;
  display: flex; align-items: center; justify-content: center;
}
.avatar-txt { font-size: 20rpx; color: #2f5bea; }
.rv-name { font-size: 22rpx; color: #5a6072; }
.stars { font-size: 20rpx; color: #f0b429; }
.rv-content { display: block; font-size: 25rpx; line-height: 1.7; margin-top: 10rpx; }
.rv-dims { display: block; font-size: 20rpx; color: #8d94a6; margin-top: 10rpx; }
.rv-tags { display: flex; flex-wrap: wrap; gap: 8rpx; margin-top: 8rpx; }
.rv-tag { font-size: 19rpx; color: #4338ca; background: #eef2ff; border-radius: 99rpx; padding: 3rpx 12rpx; }
.rv-tag.bad { color: #b91c1c; background: #fef2f2; }
.rv-tag.custom { color: #047857; background: #ecfdf5; }
.rv-reward {
  font-size: 18rpx; color: #b45309; background: #fef3c7;
  border-radius: 99rpx; padding: 2rpx 10rpx;
}
.rv-media { display: flex; flex-wrap: wrap; gap: 10rpx; margin-top: 12rpx; }
.rv-thumb {
  width: 150rpx; height: 150rpx;
  border-radius: 10rpx; overflow: hidden; background: #f1f3f7;
}
.rv-thumb-img { width: 100%; height: 100%; }
.rv-video { width: 100%; height: 380rpx; border-radius: 10rpx; background: #000; }
.rv-reply { background: #f7f8fa; border-radius: 10rpx; padding: 12rpx; margin-top: 10rpx; }
.rv-reply-txt { font-size: 20rpx; color: #5a6072; }
.useful { font-size: 20rpx; color: #2f5bea; }
.foot { text-align: center; font-size: 22rpx; color: #c2c8d4; padding: 30rpx 0; }
</style>
