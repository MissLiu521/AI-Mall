<script setup lang="ts">
import type { Product } from '@/api/types';

const props = defineProps<{ product: Product; aiPick?: boolean }>();
const emit = defineEmits<{ (e: 'add', p: Product): void }>();

const goDetail = () => uni.navigateTo({ url: `/pages/detail/detail?id=${props.product.id}` });
</script>

<template>
  <view class="pcard" @tap="goDetail">
    <view class="media">
      <text class="emoji">{{ product.image || '📦' }}</text>
      <text v-if="aiPick" class="ai-pick">AI 精选</text>
      <text v-if="product.compareAt" class="sale">-{{ Math.round((1 - product.price / product.compareAt) * 100) }}%</text>
    </view>
    <view class="body">
      <text class="title">{{ product.title }}</text>
      <text class="sub">{{ product.subtitle }}</text>
      <view class="foot">
        <view class="price-row">
          <text class="price">¥{{ product.price }}</text>
          <text v-if="product.compareAt" class="old">¥{{ product.compareAt }}</text>
        </view>
        <view class="add" @tap.stop="emit('add', product)">
          <text class="add-txt">{{ product.stock === 0 ? '缺货' : '+' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pcard {
  background: #fff;
  border-radius: 20rpx;
  border: 1rpx solid #e4e7ee;
  overflow: hidden;
}
.media {
  position: relative;
  width: 100%;
  height: 320rpx;
  background: linear-gradient(160deg, #f5f7fb, #eef1f7);
  display: flex;
  align-items: center;
  justify-content: center;
}
.emoji { font-size: 110rpx; }
.ai-pick {
  position: absolute;
  top: 16rpx; left: 16rpx;
  background: #f1eefe;
  color: #6b4ef5;
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.sale {
  position: absolute;
  top: 16rpx; right: 16rpx;
  background: #d93b4a;
  color: #fff;
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.body { padding: 20rpx 22rpx 24rpx; }
.title {
  font-size: 28rpx;
  font-weight: 500;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sub {
  display: block;
  font-size: 22rpx;
  color: #8d94a6;
  margin-top: 6rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot { display: flex; align-items: center; justify-content: space-between; margin-top: 16rpx; }
.price-row { display: flex; align-items: baseline; }
.price { font-size: 34rpx; }
.old { font-size: 22rpx; color: #8d94a6; text-decoration: line-through; margin-left: 8rpx; }
.add {
  width: 52rpx; height: 52rpx;
  border-radius: 50%;
  border: 1rpx solid #d3d8e3;
  display: flex; align-items: center; justify-content: center;
}
.add-txt { font-size: 28rpx; color: #1a1d24; }
</style>
