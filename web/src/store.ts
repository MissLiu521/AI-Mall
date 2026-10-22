import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, tokenStore, setUnauthorizedHandler } from './api';
import type { User, Cart } from './api/types';

export const useAuth = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const ready = ref(false);

  const isLoggedIn = computed(() => !!user.value);
  const isMerchant = computed(() => user.value?.role === 'merchant');

  async function bootstrap() {
    if (tokenStore.get()) {
      try { user.value = await api.me(); } catch { tokenStore.clear(); user.value = null; }
    }
    ready.value = true;
  }

  async function login(email: string, password: string) {
    const r = await api.login(email, password);
    tokenStore.set(r.token);
    user.value = r.user;
    return r.user as User;
  }

  async function register(email: string, password: string, name: string) {
    const r = await api.register(email, password, name);
    tokenStore.set(r.token);
    user.value = r.user;
    return r.user as User;
  }

  function logout() {
    tokenStore.clear();
    user.value = null;
  }

  setUnauthorizedHandler(() => { user.value = null; });

  return { user, ready, isLoggedIn, isMerchant, bootstrap, login, register, logout };
});

export const useCart = defineStore('cart', () => {
  // 购物车结构随 SKU / 店铺分组扩展，这里保持宽松类型，避免每次加字段都要改接口
  const empty = { items: [], count: 0, subtotal: 0, shipping: 0, groups: [], selectedCount: 0, invalidCount: 0 };
  const data = ref<any>({ ...empty });

  async function refresh() {
    if (!tokenStore.get()) { data.value = { ...empty }; return; }
    try { data.value = await api.cart(); } catch { /* 未登录静默 */ }
  }
  async function add(productId: number, qty = 1, skuId = 0) {
    data.value = await api.addCart(productId, qty, skuId);
  }
  async function update(id: number, qty: number) { data.value = await api.updateCart(id, qty); }
  async function remove(id: number) { data.value = await api.removeCart(id); }
  async function clear() { data.value = await api.clearCart(); }

  return { data, refresh, add, update, remove, clear };
});

export const useToast = defineStore('toast', () => {
  const items = ref<{ id: number; text: string; tone: 'info' | 'success' | 'error' }[]>([]);
  let seq = 0;
  function push(text: string, tone: 'info' | 'success' | 'error' = 'info') {
    const id = ++seq;
    items.value.push({ id, text, tone });
    setTimeout(() => { items.value = items.value.filter((t) => t.id !== id); }, 2800);
  }
  return { items, push };
});
