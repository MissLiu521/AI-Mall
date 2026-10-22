<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onReachBottom, onUnload } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, toast, requireLogin } from '@/store';

const auth = useAuth();
const items = ref<any[]>([]);
const loading = ref(true);
const page = ref(1);
const hasMore = ref(true);

const detail = ref<any>(null);

onLoad(async () => { await load(true); });

async function load(reset = false) {
  if (reset) { page.value = 1; hasMore.value = true; }
  if (!hasMore.value) return;
  try {
    const r: any = await api.feed({ page: page.value, pageSize: 8 });
    items.value = reset ? r.items : [...items.value, ...r.items];
    hasMore.value = items.value.length < r.total;
    page.value += 1;
  } catch (e: any) {
    toast.err(e.message);
  } finally {
    loading.value = false;
  }
}

onReachBottom(() => { load(); });

async function open(f: any) {
  try { detail.value = await api.feedDetail(f.id); } catch (e: any) { toast.err(e.message); }
}

async function like(f: any) {
  if (!requireLogin(auth)) return;
  try {
    const r: any = await api.likeFeed(f.id);
    f.liked = r.liked;
    f.likes = r.likes;
    if (detail.value?.id === f.id) { detail.value.liked = r.liked; detail.value.likes = r.likes; }
  } catch (e: any) { toast.err(e.message); }
}

function goProduct(id: number) {
  detail.value = null;
  uni.navigateTo({ url: `/pages/detail/detail?id=${id}` });
}

// 内容卡片用封面底色区分，避免没有图片素材时页面全白
const TINTS = ['#f1eefe', '#edf6ff', '#fdf3e4', '#e8f7ef', '#fdecee', '#f1f3f7'];
const tint = (id: number) => TINTS[id % TINTS.length];
</script>

<template>
  <view class="page">
    <view class="head">
      <text class="head-title">逛逛</text>
      <text class="head-sub">内容即货架 —— 看到什么，直接买什么</text>
    </view>

    <view class="masonry">
      <view v-for="f in items" :key="f.id" class="feed" @tap="open(f)">
        <view class="cover" :style="{ background: tint(f.id) }">
          <text class="cover-emoji">{{ f.cover || '✦' }}</text>
        </view>
        <view class="body">
          <text class="f-title">{{ f.title }}</text>
          <text v-if="f.body" class="f-body">{{ f.body }}</text>
          <view v-if="f.products?.length" class="f-prods">
            <view v-for="p in f.products.slice(0, 2)" :key="p.id" class="f-prod">
              <text class="f-prod-emoji">{{ p.image || '📦' }}</text>
              <text class="f-prod-price mono">¥{{ p.price }}</text>
            </view>
            <text v-if="f.products.length > 2" class="f-more">+{{ f.products.length - 2 }}</text>
          </view>
          <view class="f-foot">
            <text class="dim" style="font-size: 20rpx">{{ f.authorName }}</text>
            <text class="f-like" :class="{ on: f.liked }" @tap.stop="like(f)">♥ {{ f.likes }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading" class="empty"><text>加载中…</text></view>
    <view v-else-if="!items.length" class="empty"><text>还没有内容</text></view>
    <view v-else-if="!hasMore" class="foot">没有更多了</view>

    <!-- 内容详情 -->
    <view v-if="detail" class="mask" @tap="detail = null">
      <view class="sheet" @tap.stop>
        <scroll-view scroll-y class="sheet-scroll">
          <view class="d-cover" :style="{ background: tint(detail.id) }">
            <text class="d-cover-emoji">{{ detail.cover || '✦' }}</text>
          </view>
          <text class="d-title">{{ detail.title }}</text>
          <text class="d-author">{{ detail.authorName }} · {{ detail.views }} 次浏览</text>
          <text class="d-body">{{ detail.body }}</text>

          <view v-if="detail.products?.length" class="d-prods">
            <text class="d-prods-title">内容里的商品</text>
            <view v-for="p in detail.products" :key="p.id" class="d-prod" @tap="goProduct(p.id)">
              <view class="d-prod-thumb"><text class="f-prod-emoji">{{ p.image || '📦' }}</text></view>
              <view class="grow">
                <text class="d-prod-title">{{ p.title }}</text>
                <text class="dim" style="font-size: 20rpx">{{ p.rating }} ★ · 已售 {{ p.sales }}</text>
              </view>
              <view class="d-prod-right">
                <text class="price">¥{{ p.price }}</text>
                <text class="d-buy">去买</text>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="sheet-actions">
          <view class="btn btn-ghost grow" @tap="like(detail)">{{ detail.liked ? '♥ 已赞' : '♡ 点赞' }}</view>
          <view class="btn btn-primary grow" @tap="detail = null">收起</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding-bottom: 60rpx; }

.head { padding: 32rpx 32rpx 20rpx; }
.head-title { display: block; font-size: 40rpx; font-weight: 600; }
.head-sub { display: block; font-size: 22rpx; color: #8d94a6; margin-top: 8rpx; }

.masonry { display: grid; grid-template-columns: 1fr 1fr; gap: 18rpx; padding: 0 20rpx; }
.feed { background: #fff; border: 1rpx solid #e4e7ee; border-radius: 20rpx; overflow: hidden; }
.cover {
  height: 260rpx;
  display: flex; align-items: center; justify-content: center;
}
.cover-emoji { font-size: 96rpx; }
.body { padding: 18rpx 20rpx 20rpx; }
.f-title {
  font-size: 26rpx; font-weight: 500; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.f-body {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 20rpx; color: #8d94a6; margin-top: 6rpx; line-height: 1.5;
}
.f-prods { display: flex; gap: 8rpx; margin-top: 12rpx; align-items: center; }
.f-prod {
  display: flex; align-items: center; gap: 4rpx;
  background: #f7f8fa; border-radius: 8rpx; padding: 4rpx 10rpx;
}
.f-prod-emoji { font-size: 20rpx; }
.f-prod-price { font-size: 20rpx; color: #d93b4a; }
.f-more { font-size: 18rpx; color: #8d94a6; }
.f-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; }
.f-like { font-size: 20rpx; color: #8d94a6; }
.f-like.on { color: #d93b4a; }

.foot { text-align: center; font-size: 22rpx; color: #c2c8d4; padding: 30rpx 0; }

.mask {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(16, 24, 40, 0.5);
  display: flex; align-items: flex-end; z-index: 200;
}
.sheet {
  width: 100%;
  max-height: 86vh;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  padding: 24rpx 28rpx calc(24rpx + env(safe-area-inset-bottom));
  display: flex; flex-direction: column;
}
.sheet-scroll { flex: 1; max-height: 66vh; }
.d-cover {
  height: 300rpx; border-radius: 20rpx;
  display: flex; align-items: center; justify-content: center;
}
.d-cover-emoji { font-size: 120rpx; }
.d-title { display: block; font-size: 32rpx; font-weight: 600; margin-top: 20rpx; }
.d-author { display: block; font-size: 20rpx; color: #8d94a6; margin-top: 8rpx; }
.d-body { display: block; font-size: 26rpx; line-height: 1.8; color: #1a1d24; margin-top: 16rpx; }
.d-prods { margin-top: 24rpx; }
.d-prods-title { font-size: 22rpx; color: #8d94a6; }
.d-prod { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 0; border-bottom: 1rpx solid #f1f3f7; }
.d-prod-thumb {
  width: 88rpx; height: 88rpx; border-radius: 12rpx; background: #f1f3f7;
  display: flex; align-items: center; justify-content: center;
}
.d-prod-title {
  font-size: 24rpx; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.d-prod-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6rpx; }
.d-buy { font-size: 20rpx; color: #fff; background: #2f5bea; padding: 4rpx 16rpx; border-radius: 999rpx; }
.sheet-actions { display: flex; gap: 16rpx; margin-top: 20rpx; }
</style>
