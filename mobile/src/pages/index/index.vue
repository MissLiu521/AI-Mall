<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, useCart, toast, requireLogin } from '@/store';
import ProductCard from '@/components/ProductCard.vue';
import type { Product, FlashSale, GroupBuy } from '@/api/types';

const auth = useAuth();
const cart = useCart();

const products = ref<Product[]>([]);
const categories = ref<{ name: string; count: number }[]>([]);
const loading = ref(true);
const keyword = ref('');

const flashSales = ref<FlashSale[]>([]);
const groupBuys = ref<GroupBuy[]>([]);
const rankTab = ref<'hot' | 'rated' | 'deals'>('hot');
const rankings = ref<any>({ hot: [], rated: [], deals: [] });
const feeds = ref<any[]>([]);
const skew = ref(0);
const now = ref(Date.now());

const rankList = computed<any[]>(() => rankings.value[rankTab.value] || []);

async function load() {
  try {
    const [list, meta] = await Promise.all([
      api.products({ pageSize: 8 }) as Promise<any>,
      api.meta() as Promise<any>,
    ]);
    products.value = list.items;
    categories.value = meta.categories;
  } catch (e: any) {
    toast.err(e.message);
  } finally {
    loading.value = false;
  }
  // 首页附加内容失败不影响主列表，逐块容错
  loadExtras();
}

async function loadExtras() {
  try {
    const fs = (await api.flashSales()) as FlashSale[];
    if (fs[0]) skew.value = fs[0].serverNow - Date.now();
    flashSales.value = fs.slice(0, 4);
  } catch { /* ignore */ }
  try { rankings.value = await api.rankings(); } catch { /* ignore */ }
  try { feeds.value = ((await api.feed({ pageSize: 3 })) as any).items; } catch { /* ignore */ }
  try { groupBuys.value = ((await api.groupBuys()) as GroupBuy[]).slice(0, 2); } catch { /* ignore */ }
}

onLoad(load);
onShow(() => { if (auth.isLoggedIn) cart.refresh(); });
onPullDownRefresh(async () => { await load(); uni.stopPullDownRefresh(); });

const timer = setInterval(() => { now.value = Date.now(); }, 1000);
onUnload(() => clearInterval(timer));

function clockOf(endAt: string) {
  const s = Math.floor(Math.max(0, new Date(endAt).getTime() - (now.value + skew.value)) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function search() {
  uni.navigateTo({ url: `/pages/category/category${keyword.value ? '?q=' + encodeURIComponent(keyword.value) : ''}` });
}

async function add(p: Product) {
  if (!requireLogin(auth)) return;
  try {
    await cart.add(p.id, 1);
    toast.ok('已加入购物车');
  } catch (e: any) { toast.err(e.message); }
}

const quickTags = ['通勤降噪耳机', '送女友礼物', '早餐燕麦', '露营投影'];

const quickEntries = [
  { ic: '🎁', name: '领券中心', url: '/pages/promo/promo?tab=coupon', tint: '#fdecee' },
  { ic: '⚡', name: '限时秒杀', url: '/pages/promo/promo?tab=flash', tint: '#fdf3e4' },
  { ic: '👥', name: '拼团更省', url: '/pages/promo/promo?tab=group', tint: '#edf1fe' },
  { ic: '✦', name: '逛逛', url: '/pages/feed/feed', tint: '#f1eefe' },
];

const RANK_TABS = [
  { k: 'hot', t: '热销榜' },
  { k: 'rated', t: '好评榜' },
  { k: 'deals', t: '降价榜' },
];
function setRank(k: string) { rankTab.value = k as any; }
</script>

<template>
  <view class="page">
    <!-- Hero -->
    <view class="hero">
      <text class="tag">✦ AI 驱动的选品助手</text>
      <text class="hero-title">说需求，不说关键词</text>
      <text class="hero-sub">「300 以内送女朋友的礼物」——用日常语言告诉我们，AI 帮你挑。</text>

      <view class="search">
        <text class="search-icon">🔍</text>
        <input v-model="keyword" class="search-input" placeholder="想买个不那么吵的风扇" confirm-type="search" @confirm="search" />
        <text class="search-ai">AI</text>
      </view>

      <scroll-view class="chips" scroll-x :show-scrollbar="false">
        <view class="chips-inner">
          <text v-for="t in quickTags" :key="t" class="chip" @tap="keyword = t; search()">{{ t }}</text>
        </view>
      </scroll-view>
    </view>

    <!-- 快捷入口 -->
    <view class="quick">
      <view v-for="q in quickEntries" :key="q.name" class="quick-item" @tap="uni.navigateTo({ url: q.url })">
        <view class="quick-ic" :style="{ background: q.tint }"><text class="quick-emoji">{{ q.ic }}</text></view>
        <text class="quick-txt">{{ q.name }}</text>
      </view>
    </view>

    <!-- 限时秒杀 -->
    <view v-if="flashSales.length" class="section">
      <view class="sec-head">
        <view class="row" style="gap: 12rpx">
          <text class="sec-title">限时秒杀</text>
          <text class="flash-clock mono">{{ clockOf(flashSales[0].endAt) }}</text>
        </view>
        <text class="more" @tap="uni.navigateTo({ url: '/pages/promo/promo?tab=flash' })">全部 ›</text>
      </view>
      <scroll-view scroll-x :show-scrollbar="false" class="fs-scroll">
        <view class="fs-row">
          <view v-for="f in flashSales" :key="f.id" class="fs-card" @tap="uni.navigateTo({ url: `/pages/detail/detail?id=${f.productId}` })">
            <view class="fs-thumb"><text class="fs-emoji">{{ f.image || '📦' }}</text></view>
            <text class="fs-name">{{ f.productName }}</text>
            <view class="row" style="gap: 8rpx; align-items: baseline">
              <text class="price" style="font-size: 28rpx">¥{{ f.price }}</text>
              <text class="fs-old">¥{{ f.origin }}</text>
            </view>
            <view class="fs-bar"><view class="fs-bar-fill" :style="{ width: f.progress + '%' }" /></view>
            <text class="fs-sold">已抢 {{ f.progress }}%</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- 分类 -->
    <view class="section">
      <view class="sec-head">
        <text class="sec-title">分类</text>
        <text class="more" @tap="uni.switchTab({ url: '/pages/category/category' })">全部 ›</text>
      </view>
      <scroll-view scroll-x :show-scrollbar="false" class="cat-scroll">
        <view class="cat-row">
          <text class="cat-pill" @tap="uni.switchTab({ url: '/pages/category/category' })">全部</text>
          <text
            v-for="c in categories" :key="c.name" class="cat-pill"
            @tap="uni.navigateTo({ url: `/pages/category/category?category=${encodeURIComponent(c.name)}` })"
          >{{ c.name }}</text>
        </view>
      </scroll-view>
    </view>

    <!-- AI 能力条 -->
    <view class="ai-band">
      <view class="ai-item" @tap="uni.navigateTo({ url: '/pages/ai/ai?scene=shopping' })">
        <text class="ai-ic">✨</text>
        <view class="col">
          <text class="ai-name">AI 导购</text>
          <text class="ai-desc">描述需求即可选品</text>
        </view>
      </view>
      <view class="ai-item" @tap="uni.navigateTo({ url: '/pages/ai/ai?scene=support' })">
        <text class="ai-ic">🎧</text>
        <view class="col">
          <text class="ai-name">AI 客服</text>
          <text class="ai-desc">查订单、办退款</text>
        </view>
      </view>
    </view>

    <!-- 商品 -->
    <view class="section">
      <view class="sec-head">
        <text class="sec-title">热门商品</text>
        <text class="dim" style="font-size: 22rpx">按评分与销量排序</text>
      </view>

      <view v-if="loading" class="grid">
        <view v-for="i in 4" :key="i" class="skel" />
      </view>
      <view v-else-if="!products.length" class="empty">
        <text class="empty-icon">📦</text>
        <text>暂无商品</text>
      </view>
      <view v-else class="grid">
        <ProductCard v-for="(p, i) in products" :key="p.id" :product="p" :ai-pick="i === 0" @add="add" />
      </view>
    </view>

    <!-- 榜单 -->
    <view v-if="rankList.length" class="section">
      <view class="sec-head">
        <text class="sec-title">榜单</text>
        <view class="rank-tabs">
          <text v-for="t in RANK_TABS" :key="t.k" class="rank-tab" :class="{ on: rankTab === t.k }" @tap="setRank(t.k)">{{ t.t }}</text>
        </view>
      </view>
      <view class="rank-list card">
        <view v-for="(p, i) in rankList.slice(0, 5)" :key="p.id" class="rank-item" @tap="uni.navigateTo({ url: `/pages/detail/detail?id=${p.id}` })">
          <text class="rank-no" :class="{ top: i < 3 }">{{ i + 1 }}</text>
          <view class="rank-thumb"><text class="rank-emoji">{{ p.image || '📦' }}</text></view>
          <view class="grow">
            <text class="rank-title">{{ p.title }}</text>
            <text class="dim" style="font-size: 20rpx">
              {{ rankTab === 'rated' ? p.rating + ' ★' : rankTab === 'deals' ? '降 ' + (p.dropPercent || 0) + '%' : '已售 ' + p.sales }}
            </text>
          </view>
          <text class="price">¥{{ p.price }}</text>
        </view>
      </view>
    </view>

    <!-- 拼团 -->
    <view v-if="groupBuys.length" class="section">
      <view class="sec-head">
        <text class="sec-title">拼团更省</text>
        <text class="more" @tap="uni.navigateTo({ url: '/pages/promo/promo?tab=group' })">全部 ›</text>
      </view>
      <view class="gp-row">
        <view v-for="g in groupBuys" :key="g.id" class="gp-card card" @tap="uni.navigateTo({ url: '/pages/promo/promo?tab=group' })">
          <view class="gp-thumb"><text class="fs-emoji">{{ g.image || '📦' }}</text></view>
          <text class="gp-name">{{ g.productTitle }}</text>
          <view class="row" style="gap: 8rpx; align-items: baseline">
            <text class="price" style="font-size: 30rpx">¥{{ g.price }}</text>
            <text class="fs-old">¥{{ g.origin }}</text>
          </view>
          <text class="dim" style="font-size: 18rpx">{{ g.required }} 人成团 · {{ g.teams }} 个团在凑</text>
        </view>
      </view>
    </view>

    <!-- 逛逛预览 -->
    <view v-if="feeds.length" class="section">
      <view class="sec-head">
        <text class="sec-title">逛逛</text>
        <text class="more" @tap="uni.navigateTo({ url: '/pages/feed/feed' })">去逛逛 ›</text>
      </view>
      <scroll-view scroll-x :show-scrollbar="false" class="feed-scroll">
        <view class="feed-row">
          <view v-for="f in feeds" :key="f.id" class="feed-card" @tap="uni.navigateTo({ url: '/pages/feed/feed' })">
            <view class="feed-cover"><text class="feed-emoji">{{ f.cover || '✦' }}</text></view>
            <text class="feed-title">{{ f.title }}</text>
            <text class="dim" style="font-size: 18rpx">{{ f.authorName }} · ♥ {{ f.likes }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <view class="footer">AI Mall · B/C 一体化智能商城</view>

    <!-- 悬浮 AI 入口 -->
    <view class="fab" @tap="uni.navigateTo({ url: '/pages/ai/ai?scene=shopping' })">
      <text class="fab-txt">✦</text>
    </view>
  </view>
</template>

<style scoped>
.page { padding-bottom: 40rpx; }

.hero { padding: 40rpx 32rpx 32rpx; background: #fff; }
.tag {
  display: inline-block;
  font-size: 22rpx;
  color: #6b4ef5;
  background: #f1eefe;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  margin-bottom: 24rpx;
}
.hero-title { display: block; font-size: 52rpx; font-weight: 600; line-height: 1.25; letter-spacing: -1rpx; }
.hero-sub { display: block; font-size: 24rpx; color: #5a6072; line-height: 1.7; margin-top: 16rpx; }

.search {
  display: flex;
  align-items: center;
  height: 88rpx;
  background: #f1f3f7;
  border-radius: 999rpx;
  padding: 0 24rpx;
  margin-top: 28rpx;
}
.search-icon { font-size: 26rpx; margin-right: 12rpx; }
.search-input { flex: 1; font-size: 26rpx; }
.search-ai {
  font-size: 18rpx;
  font-weight: 700;
  color: #6b4ef5;
  background: #f1eefe;
  padding: 4rpx 10rpx;
  border-radius: 6rpx;
}

.chips { margin-top: 20rpx; white-space: nowrap; }
.chips-inner { display: flex; gap: 12rpx; }
.chip {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #5a6072;
  border: 1rpx solid #e4e7ee;
  border-radius: 999rpx;
  padding: 8rpx 20rpx;
}

.section { padding: 32rpx; }
.sec-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 20rpx; }
.sec-title { font-size: 32rpx; font-weight: 600; }
.more { font-size: 24rpx; color: #5a6072; }

.cat-scroll { white-space: nowrap; }
.cat-row { display: flex; gap: 14rpx; }
.cat-pill {
  flex-shrink: 0;
  font-size: 26rpx;
  color: #5a6072;
  background: #fff;
  border: 1rpx solid #e4e7ee;
  border-radius: 999rpx;
  padding: 12rpx 28rpx;
}

.ai-band {
  display: flex;
  gap: 20rpx;
  padding: 0 32rpx;
}
.ai-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 14rpx;
  background: #fff;
  border: 1rpx solid #ddd6fb;
  border-radius: 20rpx;
  padding: 22rpx;
}
.ai-ic {
  width: 56rpx; height: 56rpx;
  border-radius: 16rpx;
  background: #f1eefe;
  font-size: 26rpx;
  display: flex; align-items: center; justify-content: center;
}
.ai-name { font-size: 26rpx; font-weight: 600; }
.ai-desc { font-size: 20rpx; color: #8d94a6; }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20rpx; }
.skel {
  height: 480rpx;
  background: #f1f3f7;
  border-radius: 20rpx;
}

.footer { text-align: center; font-size: 22rpx; color: #c2c8d4; padding: 40rpx 0 20rpx; }

/* 快捷入口 */
.quick { display: flex; padding: 28rpx 24rpx 8rpx; }
.quick-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10rpx; }
.quick-ic {
  width: 84rpx; height: 84rpx; border-radius: 24rpx;
  display: flex; align-items: center; justify-content: center;
}
.quick-emoji { font-size: 38rpx; }
.quick-txt { font-size: 20rpx; color: #5a6072; }

/* 秒杀 */
.flash-clock {
  font-size: 20rpx; color: #d93b4a; background: #fdecee;
  padding: 2rpx 12rpx; border-radius: 6rpx;
}
.fs-scroll { white-space: nowrap; }
.fs-row { display: flex; gap: 16rpx; }
.fs-card {
  width: 200rpx; flex-shrink: 0;
  background: #fff; border: 1rpx solid #e4e7ee; border-radius: 18rpx; padding: 16rpx;
}
.fs-thumb {
  height: 160rpx; border-radius: 12rpx; background: #f7f8fa;
  display: flex; align-items: center; justify-content: center; margin-bottom: 10rpx;
}
.fs-emoji { font-size: 62rpx; }
.fs-name {
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 22rpx; margin-bottom: 6rpx;
}
.fs-old { font-size: 18rpx; color: #8d94a6; text-decoration: line-through; }
.fs-bar { height: 8rpx; background: #fdecee; border-radius: 999rpx; overflow: hidden; margin-top: 8rpx; }
.fs-bar-fill { height: 100%; background: #d93b4a; }
.fs-sold { font-size: 18rpx; color: #d93b4a; }

/* 榜单 */
.rank-tabs { display: flex; gap: 10rpx; }
.rank-tab { font-size: 20rpx; color: #5a6072; padding: 4rpx 16rpx; border-radius: 999rpx; background: #f1f3f7; }
.rank-tab.on { background: #edf1fe; color: #2f5bea; }
.rank-list { padding: 8rpx 20rpx; }
.rank-item { display: flex; align-items: center; gap: 14rpx; padding: 16rpx 0; border-bottom: 1rpx solid #f1f3f7; }
.rank-item:last-child { border-bottom: none; }
.rank-no {
  width: 36rpx; text-align: center; font-size: 22rpx; font-weight: 600;
  color: #8d94a6; font-family: 'SF Mono', Consolas, monospace;
}
.rank-no.top { color: #d93b4a; }
.rank-thumb {
  width: 72rpx; height: 72rpx; border-radius: 10rpx; background: #f7f8fa;
  display: flex; align-items: center; justify-content: center;
}
.rank-emoji { font-size: 34rpx; }
.rank-title {
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 24rpx;
}

/* 拼团 */
.gp-row { display: flex; gap: 16rpx; }
.gp-card { flex: 1; padding: 16rpx; min-width: 0; }
.gp-thumb {
  height: 150rpx; border-radius: 12rpx; background: #f7f8fa;
  display: flex; align-items: center; justify-content: center; margin-bottom: 10rpx;
}
.gp-name {
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 22rpx; margin-bottom: 6rpx;
}

/* 逛逛 */
.feed-scroll { white-space: nowrap; }
.feed-row { display: flex; gap: 16rpx; }
.feed-card {
  width: 220rpx; flex-shrink: 0;
  background: #fff; border: 1rpx solid #e4e7ee; border-radius: 18rpx; padding: 14rpx;
}
.feed-cover {
  height: 170rpx; border-radius: 12rpx; background: linear-gradient(160deg, #f5f2ff, #eef1f7);
  display: flex; align-items: center; justify-content: center; margin-bottom: 10rpx;
}
.feed-emoji { font-size: 60rpx; }
.feed-title {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 22rpx; line-height: 1.4; margin-bottom: 6rpx;
}

.fab {
  position: fixed;
  right: 32rpx;
  /* H5 端 tabBar 覆盖页面底部，悬浮按钮需要抬到 tabBar 之上 */
  bottom: calc(48rpx + var(--window-bottom, 0px));
  width: 96rpx; height: 96rpx;
  border-radius: 50%;
  background: #6b4ef5;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8rpx 32rpx rgba(107, 78, 245, 0.4);
  z-index: 99;
}
.fab-txt { color: #fff; font-size: 36rpx; }
</style>
