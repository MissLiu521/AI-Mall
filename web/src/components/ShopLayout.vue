<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth, useCart } from '../store';
import AiAssistant from './AiAssistant.vue';

const router = useRouter();
const auth = useAuth();
const cart = useCart();
const keyword = ref('');
const menuOpen = ref(false);

onMounted(() => { cart.refresh(); });
watch(() => auth.user, () => cart.refresh());

function search() {
  router.push({ name: 'category', query: keyword.value ? { q: keyword.value } : {} });
}

// 输入即搜（500ms 防抖）：不必按回车也能看到结果，回车仍然立即搜索
let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 500);
}
onUnmounted(() => { if (searchTimer) clearTimeout(searchTimer); });

function logout() {
  auth.logout();
  cart.refresh();
  router.push('/shop');
}
</script>

<template>
  <div class="shell">
    <header class="nav">
      <div class="nav-inner">
        <router-link to="/shop" class="logo">
          <span class="logo-mark">八</span>
          <span class="logo-text">AI Mall</span>
        </router-link>

        <nav class="nav-links">
          <router-link to="/shop" class="nav-link">首页</router-link>
          <router-link to="/shop/category" class="nav-link">全部商品</router-link>
          <router-link to="/promo" class="nav-link">领券中心</router-link>
          <router-link to="/feed" class="nav-link">逛逛</router-link>
          <router-link to="/mine" class="nav-link">我的</router-link>
          <router-link to="/orders" class="nav-link">订单</router-link>
        </nav>

        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input v-model="keyword" class="search-input" placeholder="搜索商品，或直接描述你的需求" @keyup.enter="search" @input="onSearchInput" />
          <span class="search-ai" title="支持自然语言">AI</span>
        </div>

        <div class="nav-actions">
          <router-link to="/cart" class="icon-btn" aria-label="购物车">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" />
              <circle cx="10" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" />
            </svg>
            <span v-if="cart.data.count" class="cart-badge">{{ cart.data.count }}</span>
          </router-link>

          <template v-if="auth.isLoggedIn">
            <div class="user-menu" @click="menuOpen = !menuOpen">
              <div class="avatar">{{ auth.user?.name?.[0] || 'U' }}</div>
              <span class="user-name">{{ auth.user?.name }}</span>
              <transition name="fade">
                <div v-if="menuOpen" class="dropdown" @click.stop>
                  <div class="dropdown-item" @click="router.push('/orders'); menuOpen = false">我的订单</div>
                  <div v-if="auth.isMerchant" class="dropdown-item" @click="router.push('/admin'); menuOpen = false">
                    商家后台
                  </div>
                  <div class="dropdown-divider" />
                  <div class="dropdown-item danger" @click="logout">退出登录</div>
                </div>
              </transition>
            </div>
          </template>
          <router-link v-else to="/login" class="btn btn-primary btn-sm">登录</router-link>
        </div>
      </div>
    </header>

    <main class="main">
      <router-view />
    </main>

    <footer class="footer">
      <div class="footer-inner">
        <span>AI Mall · B/C 一体化智能商城</span>
        <span class="dim">AI 导购 · AI 客服 · 运营智能体</span>
      </div>
    </footer>

    <AiAssistant />
  </div>
</template>

<style scoped>
.shell { display: flex; flex-direction: column; min-height: 100vh; }

.nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--line);
}
.nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 60px;
  display: flex;
  align-items: center;
  gap: 24px;
}
.logo { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.logo-mark {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  background: var(--text);
  color: #fff;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
}
.logo-text { font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }

.nav-links { display: flex; gap: 4px; }
.nav-link {
  padding: 6px 10px;
  border-radius: var(--r-sm);
  font-size: 14px;
  color: var(--text-2);
  transition: background 0.16s, color 0.16s;
}
.nav-link:hover { background: var(--surface-2); color: var(--text); }
.nav-link.router-link-exact-active { color: var(--text); font-weight: 500; background: var(--surface-2); }

.search-box {
  flex: 1;
  max-width: 420px;
  margin-left: auto;
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon { position: absolute; left: 12px; color: var(--text-3); pointer-events: none; }
.search-input {
  width: 100%;
  height: 36px;
  padding: 0 44px 0 34px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-full);
  background: var(--surface-2);
  outline: none;
  font-size: 13px;
  transition: all 0.16s;
}
.search-input:focus {
  background: var(--surface);
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(47, 91, 234, 0.1);
}
.search-ai {
  position: absolute;
  right: 10px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ai);
  background: var(--ai-soft);
  padding: 2px 6px;
  border-radius: 4px;
}

.nav-actions { display: flex; align-items: center; gap: 12px; }
.icon-btn {
  position: relative;
  width: 36px; height: 36px;
  display: grid; place-items: center;
  border-radius: var(--r-sm);
  color: var(--text-2);
  transition: background 0.16s;
}
.icon-btn:hover { background: var(--surface-2); color: var(--text); }
.cart-badge {
  position: absolute;
  top: 2px; right: 2px;
  min-width: 16px; height: 16px;
  padding: 0 4px;
  border-radius: 99px;
  background: var(--price);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: grid; place-items: center;
}

.user-menu { position: relative; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--primary);
  display: grid; place-items: center;
  font-size: 13px;
  font-weight: 600;
}
.user-name { font-size: 13px; color: var(--text-2); }
.dropdown {
  position: absolute;
  top: 44px; right: 0;
  min-width: 150px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--sh-2);
  padding: 6px;
  z-index: 200;
}
.dropdown-item {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}
.dropdown-item:hover { background: var(--surface-2); color: var(--text); }
.dropdown-item.danger:hover { background: var(--danger-soft); color: var(--danger); }
.dropdown-divider { height: 1px; background: var(--line); margin: 4px 0; }

.main { flex: 1; }
.footer { border-top: 1px solid var(--line); background: var(--surface); }
.footer-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-3);
}

@media (max-width: 900px) {
  .nav-links { display: none; }
  .user-name { display: none; }
  .nav-inner { gap: 12px; }
}
@media (max-width: 640px) {
  .nav-inner { padding: 0 16px; }
  .search-box { max-width: none; }
  .logo-text { display: none; }
}
</style>
