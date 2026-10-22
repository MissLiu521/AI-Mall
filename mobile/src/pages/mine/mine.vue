<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, useCart, toast } from '@/store';

const auth = useAuth();
const cart = useCart();
const points = ref<any>(null);
const wallet = ref<any>(null);

onShow(async () => {
  if (!auth.ready) await auth.bootstrap();
  if (auth.isLoggedIn) {
    await cart.refresh();
    try { points.value = await api.points(); } catch { /* ignore */ }
    try { wallet.value = await api.wallet(); } catch { /* ignore */ }
  }
});

function logout() {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    success: (r) => {
      if (!r.confirm) return;
      auth.logout();
      cart.refresh();
      points.value = null;
      wallet.value = null;
      toast.info('已退出');
    },
  });
}
</script>

<template>
  <view class="page">
    <!-- 用户卡片 -->
    <view class="user-card">
      <template v-if="auth.isLoggedIn">
        <view class="avatar"><text class="avatar-txt">{{ auth.user?.name?.[0] || 'U' }}</text></view>
        <view class="grow">
          <text class="name">{{ auth.user?.name }}</text>
          <text class="email">{{ auth.user?.email }}</text>
        </view>
        <text class="badge" :class="auth.user?.role === 'merchant' ? 'badge-warning' : 'badge-primary'">
          {{ auth.user?.role === 'merchant' ? '商家' : '会员' }}
        </text>
      </template>
      <template v-else>
        <view class="avatar"><text class="avatar-txt">?</text></view>
        <view class="grow">
          <text class="name">未登录</text>
          <text class="email">登录后可下单、查订单</text>
        </view>
        <view class="btn btn-primary btn-sm" @tap="uni.navigateTo({ url: '/pages/login/login' })">登录</view>
      </template>
    </view>

    <!-- 会员资产 -->
    <view v-if="auth.isLoggedIn" class="asset-card" @tap="uni.navigateTo({ url: '/pages/assets/assets' })">
      <view class="asset-item">
        <text class="asset-num mono">{{ points?.points ?? 0 }}</text>
        <text class="asset-lbl">积分</text>
      </view>
      <view class="asset-line" />
      <view class="asset-item">
        <text class="asset-num">¥{{ points?.cashValue?.toFixed(2) ?? '0.00' }}</text>
        <text class="asset-lbl">积分抵现</text>
      </view>
      <view class="asset-line" />
      <view class="asset-item">
        <text class="asset-num">¥{{ wallet?.balance ?? '0.00' }}</text>
        <text class="asset-lbl">评价返现</text>
      </view>
      <view class="asset-line" />
      <view class="asset-item">
        <text class="asset-num">{{ points?.level?.label || '普通会员' }}</text>
        <text class="asset-lbl">会员等级</text>
      </view>
      <text class="asset-arrow">›</text>
    </view>

    <!-- 订单入口 -->
    <view class="card menu">
      <view class="menu-item" @tap="uni.navigateTo({ url: '/pages/orders/orders' })">
        <text class="mi-ic">📦</text>
        <text class="mi-txt">我的订单</text>
        <text class="mi-arrow">›</text>
      </view>
      <view class="menu-item" @tap="uni.switchTab({ url: '/pages/cart/cart' })">
        <text class="mi-ic">🛒</text>
        <text class="mi-txt">购物车</text>
        <text class="mi-count" v-if="cart.data.count">{{ cart.data.count }}</text>
        <text class="mi-arrow">›</text>
      </view>
      <view class="menu-item" @tap="uni.navigateTo({ url: '/pages/assets/assets' })">
        <text class="mi-ic">🎟</text>
        <text class="mi-txt">券包 / 收藏 / 足迹</text>
        <text class="mi-desc">积分与拼团记录</text>
        <text class="mi-arrow">›</text>
      </view>
    </view>

    <!-- 逛与促销 -->
    <view class="card menu">
      <view class="menu-item" @tap="uni.navigateTo({ url: '/pages/promo/promo' })">
        <text class="mi-ic">🎁</text>
        <text class="mi-txt">领券中心 · 秒杀 · 拼团</text>
        <text class="mi-arrow">›</text>
      </view>
      <view class="menu-item" @tap="uni.navigateTo({ url: '/pages/feed/feed' })">
        <text class="mi-ic">✦</text>
        <text class="mi-txt">逛逛</text>
        <text class="mi-desc">内容即货架</text>
        <text class="mi-arrow">›</text>
      </view>
    </view>

    <!-- AI 服务 -->
    <view class="card menu">
      <view class="menu-label">AI 服务</view>
      <view class="menu-item" @tap="uni.navigateTo({ url: '/pages/ai/ai?scene=shopping' })">
        <text class="mi-ic">✨</text>
        <text class="mi-txt">AI 导购</text>
        <text class="mi-desc">说需求即可选品</text>
        <text class="mi-arrow">›</text>
      </view>
      <view class="menu-item" @tap="uni.navigateTo({ url: '/pages/ai/ai?scene=support' })">
        <text class="mi-ic">🎧</text>
        <text class="mi-txt">AI 客服</text>
        <text class="mi-desc">查订单 / 办退款</text>
        <text class="mi-arrow">›</text>
      </view>
    </view>

    <view class="card menu" v-if="auth.isLoggedIn">
      <view class="menu-item" @tap="logout">
        <text class="mi-ic">↩</text>
        <text class="mi-txt danger">退出登录</text>
      </view>
    </view>

    <view class="tip">
      <text class="tip-txt">同一账号可在网页端与 App / 小程序端登录，数据互通</text>
    </view>
    <view class="footer">AI Mall · v1.0.0</view>
  </view>
</template>

<style scoped>
.page { padding: 20rpx 20rpx 60rpx; }

.user-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 40rpx 32rpx;
  background: #fff;
  border-radius: 24rpx;
  margin-bottom: 24rpx;
}
.avatar {
  width: 112rpx; height: 112rpx;
  border-radius: 50%;
  background: #edf1fe;
  display: flex; align-items: center; justify-content: center;
}
.avatar-txt { font-size: 44rpx; color: #2f5bea; font-weight: 600; }
.name { display: block; font-size: 32rpx; font-weight: 600; }
.email { display: block; font-size: 22rpx; color: #8d94a6; margin-top: 4rpx; }

.asset-card {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 20rpx;
  padding: 26rpx 20rpx;
  margin-bottom: 24rpx;
}
.asset-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4rpx; }
.asset-num { font-size: 30rpx; font-weight: 600; }
.asset-lbl { font-size: 18rpx; color: #8d94a6; }
.asset-line { width: 1rpx; height: 48rpx; background: #e4e7ee; }
.asset-arrow { font-size: 30rpx; color: #c2c8d4; padding-left: 8rpx; }

.menu { margin-bottom: 24rpx; overflow: hidden; }.menu-label { font-size: 22rpx; color: #8d94a6; padding: 24rpx 28rpx 8rpx; }
.menu-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 28rpx;
  border-bottom: 1rpx solid #f1f3f7;
}
.menu-item:last-child { border-bottom: none; }
.mi-ic { font-size: 32rpx; width: 44rpx; text-align: center; }
.mi-txt { flex: 1; font-size: 28rpx; }
.mi-txt.danger { color: #d93b4a; }
.mi-count {
  min-width: 36rpx; height: 36rpx;
  border-radius: 999rpx;
  background: #d93b4a;
  color: #fff;
  font-size: 20rpx;
  display: flex; align-items: center; justify-content: center;
  padding: 0 10rpx;
}
.mi-desc { font-size: 20rpx; color: #8d94a6; }
.mi-arrow { font-size: 32rpx; color: #c2c8d4; }

.tip { padding: 8rpx 12rpx; }
.tip-txt { font-size: 20rpx; color: #8d94a6; line-height: 1.6; }
.footer { text-align: center; font-size: 20rpx; color: #c2c8d4; margin-top: 40rpx; }
</style>
