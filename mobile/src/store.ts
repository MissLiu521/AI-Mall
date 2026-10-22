import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, tokenStore, setUnauthorizedHandler } from '@/api';

export const useAuth = defineStore('auth', () => {
  const user = ref<any>(null);
  const ready = ref(false);
  const isLoggedIn = computed(() => !!user.value);

  async function bootstrap() {
    if (tokenStore.get()) {
      try { user.value = await api.me(); } catch { tokenStore.clear(); user.value = null; }
    }
    ready.value = true;
  }

  async function login(email: string, password: string) {
    const r: any = await api.login(email, password);
    tokenStore.set(r.token);
    user.value = r.user;
    return r.user;
  }

  async function register(email: string, password: string, name: string) {
    const r: any = await api.register(email, password, name);
    tokenStore.set(r.token);
    user.value = r.user;
    return r.user;
  }

  function logout() {
    tokenStore.clear();
    user.value = null;
  }

  setUnauthorizedHandler(() => { user.value = null; });

  return { user, ready, isLoggedIn, bootstrap, login, register, logout };
});

export const useCart = defineStore('cart', () => {
  // 结构以服务端为准：items + 按店铺分组 groups + 选中统计，这里不再复刻一份规则
  const empty = () => ({ items: [], groups: [], count: 0, selectedCount: 0, subtotal: 0, shipping: 0, invalidCount: 0 });
  const data = ref<any>(empty());

  async function refresh() {
    if (!tokenStore.get()) { data.value = empty(); return; }
    try { data.value = await api.cart(); } catch { /* ignore */ }
  }
  async function add(productId: number, qty = 1, skuId = 0) { data.value = await api.addCart(productId, qty, skuId); }
  async function update(id: number, qty: number) { data.value = await api.updateCart(id, qty); }
  async function remove(id: number) { data.value = await api.removeCart(id); }
  async function select(id: number, selected: boolean) { data.value = await api.selectCart(id, selected); }
  async function selectAll(selected: boolean) { data.value = await api.selectAllCart(selected); }
  // 服务端返回 { removed, cart }，不能整体塞进 data，否则列表渲染会拿到 undefined
  async function removeInvalid() {
    const r: any = await api.removeInvalidCart();
    if (r?.cart) data.value = r.cart;
    else await refresh();
    return r?.removed || 0;
  }

  return { data, refresh, add, update, remove, select, selectAll, removeInvalid };
});

export const toast = {
  info: (t: string) => uni.showToast({ title: t, icon: 'none' }),
  ok: (t: string) => uni.showToast({ title: t, icon: 'success' }),
  err: (t: string) => uni.showToast({ title: t, icon: 'none', duration: 2500 }),
};

/** 需要登录的操作统一拦截 */
export function requireLogin(auth: any): boolean {
  if (auth.isLoggedIn) return true;
  uni.navigateTo({ url: '/pages/login/login' });
  return false;
}
