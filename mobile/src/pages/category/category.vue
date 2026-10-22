<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';import { api } from '@/api';
import { useAuth, useCart, toast, requireLogin } from '@/store';
import ProductCard from '@/components/ProductCard.vue';
import type { Product } from '@/api/types';

const auth = useAuth();
const cart = useCart();

const items = ref<Product[]>([]);
const total = ref(0);
const loading = ref(true);
const q = ref('');
const category = ref('');
const keyword = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;
const categories = ref<{ name: string; count: number }[]>([]);

async function load() {
  loading.value = true;
  try {
    const r: any = await api.products({ q: q.value, category: category.value, pageSize: 30 });
    items.value = r.items;
    total.value = r.total;
  } catch (e: any) { toast.err(e.message); }
  finally { loading.value = false; }
}

onLoad(async (opt: any) => {
  q.value = opt?.q ? decodeURIComponent(opt.q) : '';
  category.value = opt?.category ? decodeURIComponent(opt.category) : '';
  keyword.value = q.value;
  try {
    const meta: any = await api.meta();
    categories.value = meta.categories;
  } catch { /* ignore */ }
  load();
});

function pickCategory(c: string) {
  category.value = c;
  load();
}

function doSearch() {
  q.value = keyword.value.trim();
  load();
}

// 输入即搜（400ms 防抖），不用非得按回车才出结果
function onKeywordInput(e: any) {
  keyword.value = e?.detail?.value ?? e?.detail ?? '';
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 400);
}

async function add(p: Product) {
  if (!requireLogin(auth)) return;
  try {
    await cart.add(p.id, 1);
    toast.ok('已加入购物车');
  } catch (e: any) { toast.err(e.message); }
}
</script>

<template>
  <view class="page">
    <view class="topbar">
      <view class="search">
        <text class="s-icon">🔍</text>
        <input v-model="keyword" class="s-input" placeholder="搜索商品" confirm-type="search" @confirm="doSearch" @input="onKeywordInput" />
      </view>
    </view>

    <scroll-view scroll-x :show-scrollbar="false" class="cats">
      <view class="cat-row">
        <text class="cat" :class="{ on: !category }" @tap="pickCategory('')">全部</text>
        <text v-for="c in categories" :key="c.name" class="cat" :class="{ on: category === c.name }"
              @tap="pickCategory(c.name)">{{ c.name }}</text>
      </view>
    </scroll-view>

    <view class="count">
      <text class="dim">共 {{ total }} 件</text>
      <text v-if="q" class="qtag">「{{ q }}」<text class="qclose" @tap="q = ''; keyword = ''; load()"> ×</text></text>
    </view>

    <view v-if="loading" class="grid">
      <view v-for="i in 4" :key="i" class="skel" />
    </view>
    <view v-else-if="!items.length" class="empty">
      <text class="empty-icon">🔍</text>
      <text>没有找到匹配的商品</text>
      <text class="dim" style="display:block; font-size:22rpx; margin-top:12rpx">可以试试问 AI 助手</text>
      <view class="btn btn-ai btn-sm" style="display:inline-flex; margin-top:24rpx"
            @tap="uni.navigateTo({ url: '/pages/ai/ai?scene=shopping' })">问 AI</view>
    </view>
    <view v-else class="grid">
      <ProductCard v-for="p in items" :key="p.id" :product="p" @add="add" />
    </view>
  </view>
</template>

<style scoped>
.page { padding-bottom: 40rpx; }

.topbar { background: #fff; padding: 20rpx 32rpx; }
.search {
  display: flex; align-items: center;
  height: 76rpx; background: #f1f3f7; border-radius: 999rpx;
  padding: 0 24rpx;
}
.s-icon { font-size: 24rpx; margin-right: 12rpx; }
.s-input { flex: 1; font-size: 26rpx; }

.cats { background: #fff; padding: 0 32rpx 20rpx; white-space: nowrap; }
.cat-row { display: flex; gap: 14rpx; }
.cat {
  flex-shrink: 0;
  font-size: 26rpx;
  color: #5a6072;
  background: #f1f3f7;
  border-radius: 999rpx;
  padding: 10rpx 26rpx;
}
.cat.on { background: #2f5bea; color: #fff; }

.count { display: flex; align-items: center; gap: 16rpx; padding: 24rpx 32rpx 16rpx; font-size: 24rpx; }
.qtag { font-size: 22rpx; background: #f1f3f7; padding: 4rpx 12rpx; border-radius: 999rpx; }
.qclose { color: #8d94a6; }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20rpx; padding: 0 32rpx; }
.skel { height: 480rpx; background: #f1f3f7; border-radius: 20rpx; }
</style>
