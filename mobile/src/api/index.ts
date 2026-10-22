/**
 * 多端请求层
 * - H5：走同源 /api（vite 代理）
 * - 小程序 / App：直连后端，地址由 vite.config.ts 在编译期探测本机局域网 IP 注入
 *   （需要固定地址时用 VITE_API_BASE_URL 覆盖）
 */

declare const __API_BASE__: string;

// 小程序 / App 端直连后端；H5 端用相对路径（由 devServer 代理）
export const BASE_URL = (() => {
  // #ifdef H5
  return '/api';
  // #endif
  // #ifndef H5
  return __API_BASE__;
  // #endif
})();

const TOKEN_KEY = 'aimall_token';

export const tokenStore = {
  get(): string {
    try { return uni.getStorageSync(TOKEN_KEY) || ''; } catch { return ''; }
  },
  set(t: string) {
    try { uni.setStorageSync(TOKEN_KEY, t); } catch { /* ignore */ }
  },
  clear() {
    try { uni.removeStorageSync(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export function request<T = any>(path: string, opts: Options = {}): Promise<T> {
  const token = tokenStore.get();
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + path,
      method: (opts.method || 'GET') as any,
      data: opts.body,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      timeout: 30000,
      success: (res: any) => {
        const json = res.data;
        if (res.statusCode >= 200 && res.statusCode < 300 && json?.ok) {
          resolve(json.data as T);
          return;
        }
        const code = json?.error?.code || 'UNKNOWN';
        const message = json?.error?.message || `请求失败 (${res.statusCode})`;
        if (res.statusCode === 401 && onUnauthorized) onUnauthorized();
        reject(new ApiError(code, message, res.statusCode));
      },
      fail: (err: any) => {
        reject(new ApiError('NETWORK', err?.errMsg || '网络异常，请检查后端是否启动', 0));
      },
    });
  });
}

const qs = (o: Record<string, any>) => {
  const s = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

/**
 * 上传图片 / 视频（评价晒单）
 * uni.uploadFile 会自动带 multipart 边界，H5 与小程序行为一致。
 */
export function uploadMedia(filePath: string): Promise<{ url: string; type: 'image' | 'video'; size: number }> {
  const token = tokenStore.get();
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${BASE_URL}/uploads`,
      filePath,
      name: 'file',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 120000,
      success: (res: any) => {
        try {
          const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (res.statusCode >= 200 && res.statusCode < 300 && json?.ok) {
            resolve(json.data);
            return;
          }
          reject(new ApiError(json?.error?.code || 'UPLOAD_FAILED', json?.error?.message || '上传失败', res.statusCode));
        } catch {
          reject(new ApiError('BAD_RESPONSE', '上传响应异常', res.statusCode));
        }
      },
      fail: (err: any) => reject(new ApiError('NETWORK', err?.errMsg || '网络异常，上传失败', 0)),
    });
  });
}

export const api = {
  login: (email: string, password: string) => request('/auth/login', { method: 'POST', body: { email, password } }),
  register: (email: string, password: string, name: string) => request('/auth/register', { method: 'POST', body: { email, password, name } }),
  me: () => request('/auth/me'),
  meta: () => request('/meta'),

  products: (p: { q?: string; category?: string; shopId?: number; sort?: string; page?: number; pageSize?: number } = {}) =>
    request(`/products${qs(p)}`),
  product: (id: number | string) => request(`/products/${id}`),
  rankings: () => request('/rankings'),
  shops: () => request('/shops'),

  // 评价
  reviews: (productId: number | string, p: {
    page?: number; pageSize?: number; rating?: number; withImage?: number;
    tagId?: number; tag?: string; dimension?: string;
  } = {}) => request(`/products/${productId}/reviews${qs(p)}`),
  createReview: (body: any) => request('/reviews', { method: 'POST', body }),
  usefulReview: (id: number | string) => request(`/reviews/${id}/useful`, { method: 'POST' }),
  reviewRules: () => request('/reviews/rules'),
  // 评价弹窗候选标签 + 商品页标签云
  reviewTagOptions: (productId: number | string) => request(`/reviews/tag-options?productId=${productId}`),
  productReviewTags: (productId: number | string) => request(`/products/${productId}/review-tags`),

  // 内容流（逛逛）
  feed: (p: { page?: number; pageSize?: number } = {}) => request(`/feed${qs(p)}`),
  feedDetail: (id: number | string) => request(`/feed/${id}`),
  likeFeed: (id: number | string) => request(`/feed/${id}/like`, { method: 'POST' }),

  // 营销
  coupons: () => request('/coupons'),
  claimCoupon: (id: number | string) => request(`/coupons/${id}/claim`, { method: 'POST' }),
  myCoupons: (status?: string) => request(`/my/coupons${qs({ status })}`),
  flashSales: () => request('/flash-sales'),
  groupBuys: () => request('/group-buys'),
  groupBuy: (id: number | string) => request(`/group-buys/${id}`),
  createGroupOrder: (body: any, idemKey: string) =>
    request('/orders/group', { method: 'POST', body, headers: { 'X-Idempotency-Key': idemKey } }),
  myTeams: () => request('/my/teams'),

  // 用户资产
  favorites: () => request('/favorites'),
  toggleFavorite: (productId: number | string) => request(`/favorites/${productId}`, { method: 'POST' }),
  footprints: () => request('/footprints'),
  clearFootprints: () => request('/footprints', { method: 'DELETE' }),
  points: () => request('/points'),
  wallet: () => request('/wallet'),

  cart: () => request('/cart'),
  addCart: (productId: number, qty = 1, skuId = 0) => request('/cart', { method: 'POST', body: { productId, qty, skuId } }),
  updateCart: (id: number, qty: number) => request(`/cart/${id}`, { method: 'PATCH', body: { qty } }),
  removeCart: (id: number) => request(`/cart/${id}`, { method: 'DELETE' }),
  selectCart: (id: number, selected: boolean) => request(`/cart/${id}/select`, { method: 'PATCH', body: { selected } }),
  selectAllCart: (selected: boolean) => request('/cart/select-all', { method: 'PATCH', body: { selected } }),
  removeInvalidCart: () => request('/cart/invalid', { method: 'DELETE' }),

  previewOrder: (body: any) => request('/orders/preview', { method: 'POST', body }),
  advanceShipment: (id: number | string) => request(`/admin/orders/${id}/shipment`, { method: 'PATCH' }),

  createOrder: (body: any, idemKey: string) => request('/orders', { method: 'POST', body, headers: { 'X-Idempotency-Key': idemKey } }),
  myOrders: () => request('/orders/mine'),
  order: (id: number | string) => request(`/orders/${id}`),
  payOrder: (id: number | string) => request(`/orders/${id}/pay`, { method: 'POST' }),
  cancelOrder: (id: number | string, reason = '') => request(`/orders/${id}/cancel`, { method: 'POST', body: { reason } }),
  confirmOrder: (id: number | string) => request(`/orders/${id}/confirm`, { method: 'POST' }),
  refund: (id: number | string, reason: string) => request(`/orders/${id}/refund`, { method: 'POST', body: { reason } }),
  eligibility: (id: number | string) => request(`/orders/${id}/eligibility`),

  addresses: () => request('/addresses'),
  addAddress: (body: any) => request('/addresses', { method: 'POST', body }),
  updateAddress: (id: number, body: any) => request(`/addresses/${id}`, { method: 'PATCH', body }),
  removeAddress: (id: number) => request(`/addresses/${id}`, { method: 'DELETE' }),
  setDefaultAddress: (id: number) => request(`/addresses/${id}/default`, { method: 'POST' }),

  chat: (body: { scene: string; text: string; conversationId?: number }) => request('/ai/chat', { method: 'POST', body }),
  messages: (id: number) => request(`/ai/conversations/${id}/messages`),
  rate: (id: number, rating: number) => request(`/ai/messages/${id}/rate`, { method: 'POST', body: { rating } }),
  handoff: (body: { conversationId?: number; summary: string; contact?: string }) => request('/ai/handoff', { method: 'POST', body }),
};
