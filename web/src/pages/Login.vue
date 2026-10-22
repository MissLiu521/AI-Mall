<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth, useToast } from '../store';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const toast = useToast();

const mode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const name = ref('');
const submitting = ref(false);
const needMerchant = ref(route.query.needMerchant === '1');

onMounted(() => {
  if (route.query.redirect) {
    // 从需要登录的页面跳转过来
  }
});

async function submit() {
  submitting.value = true;
  try {
    if (mode.value === 'login') await auth.login(email.value.trim(), password.value);
    else await auth.register(email.value.trim(), password.value, name.value.trim());

    toast.push('欢迎回来', 'success');
    const redirect = (route.query.redirect as string) || (auth.isMerchant ? '/admin' : '/shop');
    router.replace(redirect);
  } catch (e: any) {
    toast.push(e.message, 'error');
    if (e.code === 'FORBIDDEN') needMerchant.value = true;
  } finally {
    submitting.value = false;
  }
}

function fill(role: 'customer' | 'merchant') {
  mode.value = 'login';
  email.value = role === 'merchant' ? 'admin@mall.dev' : 'demo@mall.dev';
  password.value = role === 'merchant' ? 'admin123' : 'demo123';
}

function back() {
  router.push('/shop');
}
</script>

<template>
  <div class="login-page">
    <div class="login-left">
      <button class="back" @click="back">← 返回商城</button>
      <div class="brand">
        <div class="brand-mark">八</div>
        <span>AI Mall</span>
      </div>
      <h1 class="brand-title">一套系统<br />服务买家与商家</h1>
      <ul class="features">
        <li><span class="tick">✦</span> AI 导购：说需求，不说关键词</li>
        <li><span class="tick">✦</span> AI 客服：能查订单、能办退款</li>
        <li><span class="tick">✦</span> 运营智能体：分析数据、生成文案</li>
      </ul>
      <div class="brand-foot">B / C 一体化 · Vue3 + Node · 可接任意 OpenAI 兼容模型</div>
    </div>

    <div class="login-right">
      <div class="form-box">
        <h2 class="form-title">{{ mode === 'login' ? '登录' : '注册账号' }}</h2>
        <p class="form-sub dim">{{ mode === 'login' ? '使用邮箱登录你的账户' : '注册后即可下单并使用 AI 客服' }}</p>

        <div v-if="needMerchant" class="warn-box">进入商家后台需要商家账号，可用下方演示账号</div>

        <form class="form" @submit.prevent="submit">
          <div v-if="mode === 'register'" class="field">
            <label>昵称</label>
            <input v-model="name" class="input" placeholder="怎么称呼你" autocomplete="nickname" />
          </div>
          <div class="field">
            <label>邮箱</label>
            <input v-model="email" class="input" type="email" placeholder="you@example.com" autocomplete="email" required />
          </div>
          <div class="field">
            <label>密码</label>
            <input v-model="password" class="input" type="password" placeholder="至少 6 位" autocomplete="current-password" required />
          </div>
          <button class="btn btn-primary btn-lg btn-block" type="submit" :disabled="submitting">
            {{ submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并登录' }}
          </button>
        </form>

        <div class="switch">
          {{ mode === 'login' ? '还没有账号？' : '已有账号？' }}
          <button @click="mode = mode === 'login' ? 'register' : 'login'">
            {{ mode === 'login' ? '去注册' : '去登录' }}
          </button>
        </div>

        <div class="demo">
          <div class="demo-title">演示账号</div>
          <div class="demo-row">
            <button class="demo-btn" @click="fill('customer')">
              <span class="demo-role">买家</span>
              <span class="mono dim">demo@mall.dev / demo123</span>
            </button>
            <button class="demo-btn" @click="fill('merchant')">
              <span class="demo-role">商家</span>
              <span class="mono dim">admin@mall.dev / admin123</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page { min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; }

.login-left {
  position: relative;
  padding: 48px;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
}
.login-left::before {
  content: '';
  position: absolute;
  width: 420px; height: 420px;
  right: -160px; top: -120px;
  background: radial-gradient(circle, rgba(107, 78, 245, 0.1), transparent 65%);
  filter: blur(10px);
}
.back {
  position: absolute;
  top: 24px; left: 48px;
  border: 0; background: transparent;
  color: var(--text-2); font-size: 13px;
}
.back:hover { color: var(--primary); }

.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 32px; }
.brand-mark {
  width: 30px; height: 30px;
  background: var(--text);
  color: #fff;
  border-radius: 8px;
  display: grid; place-items: center;
  font-size: 15px;
}
.brand-title { font-size: 34px; font-weight: 600; line-height: 1.25; letter-spacing: -0.02em; margin: 0 0 28px; }
.features { list-style: none; padding: 0; margin: 0 0 auto; display: flex; flex-direction: column; gap: 12px; }
.features li { display: flex; gap: 10px; font-size: 14px; color: var(--text-2); }
.tick { color: var(--ai); font-size: 12px; }
.brand-foot { font-size: 12px; color: var(--text-3); margin-top: 40px; }

.login-right { display: grid; place-items: center; padding: 40px 24px; background: var(--bg); }
.form-box { width: 100%; max-width: 360px; }
.form-title { font-size: 24px; font-weight: 600; margin: 0 0 6px; }
.form-sub { font-size: 13px; margin: 0 0 24px; }
.warn-box {
  font-size: 12px;
  color: var(--warning);
  background: var(--warning-soft);
  padding: 9px 12px;
  border-radius: var(--r-sm);
  margin-bottom: 16px;
}
.form { display: flex; flex-direction: column; gap: 14px; }
.switch { margin-top: 16px; font-size: 13px; color: var(--text-2); text-align: center; }
.switch button { border: 0; background: transparent; color: var(--primary); font-size: 13px; padding: 0 2px; }
.switch button:hover { text-decoration: underline; }

.demo { margin-top: 28px; padding-top: 20px; border-top: 1px dashed var(--line); }
.demo-title { font-size: 12px; color: var(--text-3); margin-bottom: 8px; }
.demo-row { display: flex; flex-direction: column; gap: 8px; }
.demo-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface);
  font-size: 12px;
  transition: all 0.16s;
}
.demo-btn:hover { border-color: var(--primary); background: var(--primary-soft); }
.demo-role { font-weight: 600; font-size: 12px; color: var(--text); }

@media (max-width: 900px) {
  .login-page { grid-template-columns: 1fr; }
  .login-left { display: none; }
}
</style>
