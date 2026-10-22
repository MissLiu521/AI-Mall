<script setup lang="ts">
import { ref } from 'vue';
import { useAuth, useCart, toast } from '@/store';

const auth = useAuth();
const cart = useCart();

const mode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const name = ref('');
const submitting = ref(false);

async function submit() {
  if (!email.value.trim() || !password.value) { toast.err('请填写邮箱和密码'); return; }
  submitting.value = true;
  try {
    if (mode.value === 'login') await auth.login(email.value.trim(), password.value);
    else await auth.register(email.value.trim(), password.value, name.value.trim());
    await cart.refresh();
    toast.ok('欢迎回来');
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.switchTab({ url: '/pages/index/index' });
    }, 400);
  } catch (e: any) {
    toast.err(e.message);
  } finally { submitting.value = false; }
}

function fill(role: 'customer' | 'merchant') {
  mode.value = 'login';
  email.value = role === 'merchant' ? 'admin@mall.dev' : 'demo@mall.dev';
  password.value = role === 'merchant' ? 'admin123' : 'demo123';
}
</script>

<template>
  <view class="page">
    <view class="brand">
      <view class="logo"><text class="logo-txt">八</text></view>
      <text class="brand-name">AI Mall</text>
    </view>

    <text class="title">{{ mode === 'login' ? '登录账户' : '注册账号' }}</text>
    <text class="subtitle">{{ mode === 'login' ? '与网页端共用同一账号' : '注册后即可下单、使用 AI 客服' }}</text>

    <view class="form">
      <view v-if="mode === 'register'" class="field">
        <text class="label">昵称</text>
        <input v-model="name" class="input" placeholder="怎么称呼你" />
      </view>
      <view class="field">
        <text class="label">邮箱</text>
        <input v-model="email" class="input" type="text" placeholder="you@example.com" />
      </view>
      <view class="field">
        <text class="label">密码</text>
        <input v-model="password" class="input" password placeholder="至少 6 位" />
      </view>

      <view class="btn btn-primary btn-block" :class="{ dis: submitting }" @tap="submit">
        {{ submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并登录' }}
      </view>
    </view>

    <view class="switch">
      <text class="muted">{{ mode === 'login' ? '还没有账号？' : '已有账号？' }}</text>
      <text class="switch-btn" @tap="mode = mode === 'login' ? 'register' : 'login'">
        {{ mode === 'login' ? '去注册' : '去登录' }}
      </text>
    </view>

    <view class="demo">
      <text class="demo-title">演示账号（点一下自动填入）</text>
      <view class="demo-btn" @tap="fill('customer')">
        <text class="demo-role">买家</text>
        <text class="demo-acc">demo@mall.dev / demo123</text>
      </view>
      <view class="demo-btn" @tap="fill('merchant')">
        <text class="demo-role">商家</text>
        <text class="demo-acc">admin@mall.dev / admin123</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 60rpx 48rpx; background: #fff; min-height: 100vh; }

.brand { display: flex; align-items: center; gap: 16rpx; margin-bottom: 60rpx; }
.logo {
  width: 56rpx; height: 56rpx;
  border-radius: 14rpx;
  background: #1a1d24;
  display: flex; align-items: center; justify-content: center;
}
.logo-txt { color: #fff; font-size: 28rpx; font-weight: 600; }
.brand-name { font-size: 28rpx; font-weight: 600; }

.title { display: block; font-size: 52rpx; font-weight: 600; letter-spacing: -1rpx; }
.subtitle { display: block; font-size: 24rpx; color: #8d94a6; margin-top: 12rpx; margin-bottom: 56rpx; }

.form { display: flex; flex-direction: column; gap: 28rpx; }
.field { display: flex; flex-direction: column; gap: 12rpx; }
.label { font-size: 24rpx; color: #5a6072; }
.input {
  height: 92rpx;
  background: #f7f8fa;
  border: 1rpx solid #e4e7ee;
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
}
.btn.dis { opacity: 0.5; }

.switch { margin-top: 32rpx; text-align: center; font-size: 24rpx; }
.switch-btn { color: #2f5bea; margin-left: 8rpx; }

.demo { margin-top: 72rpx; padding-top: 40rpx; border-top: 1rpx dashed #e4e7ee; }
.demo-title { font-size: 22rpx; color: #8d94a6; display: block; margin-bottom: 20rpx; }
.demo-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx;
  border: 1rpx solid #e4e7ee;
  border-radius: 16rpx;
  margin-bottom: 16rpx;
}
.demo-role { font-size: 26rpx; font-weight: 600; }
.demo-acc { font-size: 22rpx; color: #8d94a6; }
</style>
