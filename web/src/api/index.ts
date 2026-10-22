import type { Product } from './types';

const BASE = '/api';
const TOKEN_KEY = 'aimall_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
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
  body?: unknown;
  headers?: Record<string, string>;
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

/** 错误码 → 用户可读文案兜底：任何报错都以「说人话」的文字提示，不暴露技术细节 */
const FRIENDLY: Record<string, string> = {
  UNAUTHORIZED: '登录已过期，请重新登录',
  FORBIDDEN: '没有权限执行此操作',
  NOT_FOUND: '要找的内容不存在或已被删除',
  VALIDATION: '填写的内容有误，请检查后重试',
  INVALID_JSON: '提交的数据格式有误，请刷新页面重试',
  PAYLOAD_TOO_LARGE: '内容太大啦，请缩小后再上传',
  BAD_RESPONSE: '服务响应异常，请稍后重试',
  NETWORK: '网络连接失败，请检查网络后重试',
  TIMEOUT: '请求超时，请稍后重试',
  RATE_LIMITED: '操作太频繁了，休息一下再试',
  TAG_LIMIT: '最多选择 8 个标签',
  TAG_CUSTOM_LIMIT: '最多自定义 3 个标签',
  TAG_BLOCKED: '该标签已被屏蔽，换个类似的吧',
  ALREADY_REVIEWED: '这件商品你已经评价过啦',
  BAD_STATUS: '当前状态不支持此操作，请刷新后重试',
  DUPLICATE: '重复操作啦，请勿重复提交',
  STOCK_SHORT: '库存不足，请调整数量',
  INTERNAL: '服务器开小差了，请稍后重试',
};
const friendly = (code: string, message: string) => {
  const m = (message || '').trim();
  // 服务端消息是给人看的就直接用；空/技术性内容（含堆栈、SQL、堆码特征）用兜底文案
  if (m && !/SELECT|INSERT|SQLITE|Error:|at \w+ \(|ECONN|EPERM/i.test(m)) return m;
  return FRIENDLY[code] || '操作没有成功，请稍后重试';
};

export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', '服务返回异常', res.status);
  }

  if (!res.ok || !json.ok) {
    const code = json?.error?.code || 'UNKNOWN';
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(code, friendly(code, json?.error?.message), res.status);
  }
  return json.data as T;
}

/** 上传图片 / 短视频：走 XHR 才能拿到进度条，fetch 没有上传进度事件 */
export function uploadMedia(
  file: File | Blob,
  onProgress?: (percent: number) => void,
): Promise<{ url: string; type: 'image' | 'video'; mime: string; size: number }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file, (file as File).name || 'upload');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/uploads');
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    const done = () => {
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && json.ok) resolve(json.data);
        else reject(new ApiError(json?.error?.code || 'UPLOAD_FAILED', json?.error?.message || '上传失败', xhr.status));
      } catch {
        reject(new ApiError('BAD_RESPONSE', '上传响应异常', xhr.status));
      }
    };
    xhr.onload = done;
    xhr.onerror = () => reject(new ApiError('NETWORK', '网络异常，上传失败，请重试', 0));
    xhr.ontimeout = () => reject(new ApiError('TIMEOUT', '上传超时，请检查网络后重试', 0));
    xhr.send(fd);
  });
}

export const api = {  // auth
  login: (email: string, password: string) => request<{ token: string; user: any }>('/auth/login', { method: 'POST', body: { email, password } }),
  register: (email: string, password: string, name: string) => request<{ token: string; user: any }>('/auth/register', { method: 'POST', body: { email, password, name } }),
  me: () => request<any>('/auth/me'),
  meta: () => request<{ ai: { enabled: boolean; model: string }; categories: { name: string; count: number }[] }>('/meta'),

  // products
  products: (p: { q?: string; category?: string; shopId?: number; sort?: string; page?: number; pageSize?: number; explain?: 0 | 1 } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '') as any).toString();
    return request<{ items: Product[]; total: number; page: number; pageSize: number; suggestions?: string[] }>(`/products${qs ? '?' + qs : ''}`);
  },
  product: (id: number | string) => request<any>(`/products/${id}`),
  rankings: () => request<{ hot: any[]; rated: any[]; deals: any[] }>('/rankings'),
  shops: () => request<any[]>('/shops'),

  // reviews
  reviews: (productId: number | string, p: {
    page?: number; pageSize?: number; rating?: number; withImage?: 0 | 1; withMedia?: 0 | 1;
    tagId?: number; tag?: string; dimension?: string;
  } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as any).toString();
    return request<any>(`/products/${productId}/reviews${qs ? '?' + qs : ''}`);
  },
  reviewRules: () => request<any>('/reviews/rules'),
  // 商品页买家印象：维度均分 + 标签云
  productReviewTags: (productId: number | string) => request<any>(`/products/${productId}/review-tags`),
  // 评价弹窗的候选标签（按商品类目下发）
  reviewTagOptions: (productId: number | string) => request<any>(`/reviews/tag-options?productId=${productId}`),
  createReview: (body: {
    orderId: number; orderItemId?: number; rating: number; content?: string; anonymous?: boolean;
    images?: string[]; video?: string; videoCover?: string;
    dimensions?: Record<string, number>;
    tags?: ({ id: number } | { name: string })[];
  }) => request<any>('/reviews', { method: 'POST', body }),
  usefulReview: (id: number) => request<any>(`/reviews/${id}/useful`, { method: 'POST' }),

  // 钱包（评价返现）
  wallet: (page = 1, pageSize = 20) => request<any>(`/wallet?page=${page}&pageSize=${pageSize}`),

  // feed（逛逛）
  feed: (p: { page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as any).toString();
    return request<{ items: any[]; total: number }>(`/feed${qs ? '?' + qs : ''}`);
  },
  feedDetail: (id: number) => request<any>(`/feed/${id}`),
  likeFeed: (id: number) => request<any>(`/feed/${id}/like`, { method: 'POST' }),

  // 营销
  coupons: () => request<any[]>('/coupons'),
  claimCoupon: (id: number) => request<any>(`/coupons/${id}/claim`, { method: 'POST' }),
  myCoupons: (status?: string) => request<any[]>(`/my/coupons${status ? '?status=' + status : ''}`),
  flashSales: () => request<any[]>('/flash-sales'),
  groupBuys: () => request<any[]>('/group-buys'),
  groupBuy: (id: number) => request<any>(`/group-buys/${id}`),
  createGroupOrder: (body: { groupBuyId: number; teamId?: number | null; address: string; idemKey?: string }) =>
    request<any>('/orders/group', { method: 'POST', body }),
  myTeams: () => request<any[]>('/my/teams'),

  // 用户资产
  favorites: () => request<{ items: any[]; total: number }>('/favorites'),
  toggleFavorite: (productId: number) => request<{ favorited: boolean }>(`/favorites/${productId}`, { method: 'POST' }),
  footprints: () => request<{ groups: any[]; total: number }>('/footprints'),
  clearFootprints: () => request<any>('/footprints', { method: 'DELETE' }),
  points: () => request<any>('/points'),

  // cart
  cart: () => request<any>('/cart'),
  addCart: (productId: number, qty = 1, skuId = 0) => request<any>('/cart', { method: 'POST', body: { productId, qty, skuId } }),
  updateCart: (id: number, qty: number) => request<any>(`/cart/${id}`, { method: 'PATCH', body: { qty } }),
  selectCart: (id: number, selected: boolean) => request<any>(`/cart/${id}/select`, { method: 'PATCH', body: { selected } }),
  selectAllCart: (selected: boolean) => request<any>('/cart/select-all', { method: 'PATCH', body: { selected } }),
  removeCart: (id: number) => request<any>(`/cart/${id}`, { method: 'DELETE' }),
  removeInvalidCart: () => request<any>('/cart/invalid', { method: 'DELETE' }),
  clearCart: () => request<any>('/cart', { method: 'DELETE' }),

  // orders
  previewOrder: (body: any) => request<any>('/orders/preview', { method: 'POST', body }),
  createOrder: (body: {
    address: string; remark?: string; productId?: number; skuId?: number | null; items?: any[];
    qty?: number; aiAssisted?: boolean; userCouponId?: number | null; usePoints?: number;
    useBalance?: number; flashSaleId?: number | null;
  }, idemKey: string) =>
    request<any>('/orders', { method: 'POST', body, headers: { 'X-Idempotency-Key': idemKey } }),
  myOrders: (p: { page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as any).toString();
    return request<any[]>(`/orders/mine${qs ? '?' + qs : ''}`);
  },
  order: (id: number | string) => request<any>(`/orders/${id}`),
  orderReviews: (id: number | string) => request<any[]>(`/orders/${id}/reviews`),
  payOrder: (id: number | string) => request<any>(`/orders/${id}/pay`, { method: 'POST' }),
  cancelOrder: (id: number | string, reason = '') => request<any>(`/orders/${id}/cancel`, { method: 'POST', body: { reason } }),
  confirmOrder: (id: number | string) => request<any>(`/orders/${id}/confirm`, { method: 'POST' }),
  refund: (id: number | string, reason: string) => request<any>(`/orders/${id}/refund`, { method: 'POST', body: { reason } }),
  eligibility: (id: number | string) => request<any>(`/orders/${id}/eligibility`),

  // addresses
  addresses: () => request<any[]>('/addresses'),
  addAddress: (body: any) => request<any>('/addresses', { method: 'POST', body }),
  updateAddress: (id: number, body: any) => request<any>(`/addresses/${id}`, { method: 'PATCH', body }),
  removeAddress: (id: number) => request<any>(`/addresses/${id}`, { method: 'DELETE' }),
  setDefaultAddress: (id: number) => request<any>(`/addresses/${id}/default`, { method: 'POST' }),

  // ai
  chat: (body: { scene: string; text: string; conversationId?: number }) => request<any>('/ai/chat', { method: 'POST', body }),
  conversations: (scene?: string) => request<any[]>(`/ai/conversations${scene ? '?scene=' + scene : ''}`),
  messages: (id: number) => request<any[]>(`/ai/conversations/${id}/messages`),
  rate: (id: number, rating: number) => request<any>(`/ai/messages/${id}/rate`, { method: 'POST', body: { rating } }),
  handoff: (body: { conversationId?: number; summary: string; contact?: string }) => request<any>('/ai/handoff', { method: 'POST', body }),
  applyDraft: (body: { productId: number; subtitle: string; description: string }) => request<any>('/ai/draft/apply', { method: 'POST', body }),

  // admin
  stats: () => request<any>('/admin/stats'),
  adminProducts: (p: { q?: string } = {}) => request<any>(`/admin/products${p.q ? '?q=' + encodeURIComponent(p.q) : ''}`),
  createProduct: (body: any) => request<any>('/admin/products', { method: 'POST', body }),
  updateProduct: (id: number, body: any) => request<any>(`/admin/products/${id}`, { method: 'PATCH', body }),
  deleteProduct: (id: number) => request<any>(`/admin/products/${id}`, { method: 'DELETE' }),
  adminOrders: (p: { status?: string; q?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as any).toString();
    return request<{ items: any[]; total: number; page: number; pageSize: number }>(`/admin/orders${qs ? '?' + qs : ''}`);
  },
  ship: (id: number, body: { carrier?: string; trackingNo?: string } = {}) => request<any>(`/admin/orders/${id}/ship`, { method: 'PATCH', body }),
  advanceShipment: (id: number) => request<any>(`/admin/orders/${id}/shipment`, { method: 'PATCH', body: {} }),
  adminReviews: (p: { rating?: number; q?: string; tagId?: number; category?: string; dimension?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '') as any).toString();
    return request<{ items: any[]; total: number }>(`/admin/reviews${qs ? '?' + qs : ''}`);
  },
  replyReview: (id: number, reply: string) => request<any>(`/admin/reviews/${id}`, { method: 'PATCH', body: { reply } }),
  // 评价标签词库
  adminReviewTags: (p: { q?: string; status?: string; dimension?: string; category?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '') as any).toString();
    return request<{ items: any[]; total: number; counts: any }>(`/admin/review-tags${qs ? '?' + qs : ''}`);
  },
  createReviewTag: (body: any) => request<any>('/admin/review-tags', { method: 'POST', body }),
  updateReviewTag: (id: number, body: any) => request<any>(`/admin/review-tags/${id}`, { method: 'PATCH', body }),
  deleteReviewTag: (id: number) => request<any>(`/admin/review-tags/${id}`, { method: 'DELETE' }),
  mergeReviewTag: (id: number, targetId: number) => request<any>(`/admin/review-tags/${id}/merge`, { method: 'POST', body: { targetId } }),
  adminFeeds: (p: { page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as any).toString();
    return request<{ items: any[]; total: number }>(`/admin/feeds${qs ? '?' + qs : ''}`);
  },
  createFeed: (body: any) => request<any>('/admin/feeds', { method: 'POST', body }),
  deleteFeed: (id: number) => request<any>(`/admin/feeds/${id}`, { method: 'DELETE' }),
  adminCoupons: () => request<any[]>('/admin/coupons'),
  createCoupon: (body: any) => request<any>('/admin/coupons', { method: 'POST', body }),
  refunds: (p: { status?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as any).toString();
    return request<any[]>(`/admin/refunds${qs ? '?' + qs : ''}`);
  },
  decideRefund: (id: number, approve: boolean, reason = '') => request<any>(`/admin/refunds/${id}`, { method: 'PATCH', body: { approve, reason } }),
  // 商家消息提醒：新订单 / 待办计数
  adminNotify: (since = '') => request<{ newOrders: { id: number; orderNo: string; total: number; createdAt: string }[]; pendingRefunds: number; pendingTags: number; now: string }>(`/admin/notify${since ? '?since=' + encodeURIComponent(since) : ''}`),
  tickets: (p: { status?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as any).toString();
    return request<any[]>(`/admin/tickets${qs ? '?' + qs : ''}`);
  },
  resolveTicket: (id: number, reply = '') => request<any>(`/admin/tickets/${id}`, { method: 'PATCH', body: { reply } }),
  aiConfig: () => request<any>('/admin/ai/config'),
  saveAiConfig: (body: any) => request<any>('/admin/ai/config', { method: 'PUT', body }),
  aiConversations: (scene?: string) => request<any[]>(`/admin/ai/conversations${scene ? '?scene=' + scene : ''}`),
  aiMessages: (id: number) => request<any[]>(`/admin/ai/conversations/${id}/messages`),
  kb: () => request<any[]>('/admin/kb'),
  addKb: (body: { question: string; answer: string; tags?: string }) => request<any>('/admin/kb', { method: 'POST', body }),
  updateKb: (id: number, body: { question?: string; answer?: string; tags?: string }) => request<any>(`/admin/kb/${id}`, { method: 'PATCH', body }),
  deleteKb: (id: number) => request<any>(`/admin/kb/${id}`, { method: 'DELETE' }),
  ops: (text: string, conversationId?: number) => request<any>('/admin/ai/ops', { method: 'POST', body: { text, conversationId } }),
  aiProductDraft: (body: { hint: string; seed?: number; imageName?: string; partial?: Record<string, any> }) =>
    request<{ title: string; subtitle: string; description: string; price: number; compareAt: number; stock: number; category: string; tags: string[]; image: string; source: string }>('/admin/ai/product-draft', { method: 'POST', body }),
};
