<script setup lang="ts">
import { ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, toast } from '@/store';
import { formatTime } from '@/utils/format';

const auth = useAuth();
const orders = ref<any[]>([]);
const loading = ref(true);

const TONE: Record<string, string> = {
  pending_payment: 'badge-warning', paid: 'badge-primary', shipped: 'badge-primary',
  completed: 'badge-success', cancelled: 'badge-muted', refunding: 'badge-warning', refunded: 'badge-danger',
};

async function load() {
  if (!auth.isLoggedIn) { loading.value = false; orders.value = []; return; }
  try {
    orders.value = (await api.myOrders()) as any[];
  } catch (e: any) { toast.err(e.message); }
  finally { loading.value = false; }
}

onShow(load);
onPullDownRefresh(async () => { await load(); uni.stopPullDownRefresh(); });
</script>

<template>
  <view class="page">
    <view v-if="!auth.isLoggedIn" class="empty">
      <text class="empty-icon">📦</text>
      <text>登录后查看订单</text>
      <view class="btn btn-primary btn-sm" style="display:inline-flex; margin-top: 24rpx"
            @tap="uni.navigateTo({ url: '/pages/login/login' })">去登录</view>
    </view>

    <view v-else-if="loading" class="empty"><text>加载中…</text></view>

    <view v-else-if="!orders.length" class="empty">
      <text class="empty-icon">📦</text>
      <text>还没有订单</text>
    </view>

    <view v-else class="list">
      <view v-for="o in orders" :key="o.id" class="order card"
            @tap="uni.navigateTo({ url: `/pages/order-detail/order-detail?id=${o.id}` })">
        <view class="head">
          <text class="no mono">{{ o.orderNo }}</text>
          <text class="badge" :class="TONE[o.status]">{{ o.statusLabel }}</text>
        </view>
        <view class="body">
          <view class="items">
            <view v-for="it in o.items" :key="it.id" class="oi">
              <text class="oi-title">{{ it.title }}</text>
              <text class="dim mono">×{{ it.qty }}</text>
            </view>
          </view>
          <view class="right">
            <text class="dim" style="font-size: 20rpx">实付</text>
            <text class="price">¥{{ o.total }}</text>
          </view>
        </view>
        <view class="foot">
          <text class="dim" style="font-size: 20rpx">{{ formatTime(o.createdAt) }}</text>
          <text class="link">查看详情 ›</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 20rpx 20rpx 40rpx; }
.list { display: flex; flex-direction: column; gap: 20rpx; }
.order { overflow: hidden; }
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18rpx 24rpx;
  background: #f1f3f7;
}
.no { font-size: 22rpx; color: #5a6072; }
.body { display: flex; align-items: center; gap: 20rpx; padding: 24rpx; }
.items { flex: 1; display: flex; flex-direction: column; gap: 8rpx; }
.oi { display: flex; gap: 14rpx; font-size: 26rpx; }
.oi-title { flex: 1; }
.right { display: flex; flex-direction: column; align-items: flex-end; }
.foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24rpx 20rpx;
}
.link { font-size: 22rpx; color: #2f5bea; }
</style>
