export interface Product {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  price: number;
  priceCents: number;
  compareAt: number | null;
  stock: number;
  category: string;
  tags: string[];
  image: string;
  status: 'active' | 'inactive';
  rating: number;
  sales: number;
}

export interface Sku {
  id: number;
  spec: Record<string, string>;
  price: number;
  priceCents: number;
  stock: number;
  image: string;
  code: string;
  buyable: boolean;
}

/** 商品详情（比列表多出规格、店铺、收藏、评价摘要、同类对比） */
export interface ProductDetail extends Product {
  shop: { id: number; name: string; logo: string; rating: number; isSelf: boolean; description: string } | null;
  skus: Sku[];
  priceRange: { min: number; max: number } | null;
  totalStock: number;
  images: string[];
  video: string;
  favorite: boolean;
  reviewSummary: { total: number; average: number; goodRate: number; preview: { rating: number; content: string }[] };
  compare: { id: number; title: string; price: number; rating: number; sales: number; stock: number; diff: string }[];
}

export interface Coupon {
  id: number;
  title: string;
  type: 'amount' | 'discount' | 'free_ship';
  threshold: number;
  value: number;
  maxDiscount: number | null;
  category: string;
  total: number;
  claimed: number;
  remain: number;
  perUser: number;
  claimedByMe: number;
  soldOut: boolean;
  canClaim: boolean;
  endAt: string | null;
  rule: string;
}

export interface UserCoupon {
  id: number;
  couponId: number;
  title: string;
  type: string;
  threshold: number;
  value: number;
  category: string;
  rule: string;
  status: 'unused' | 'used' | 'expired';
  orderId: number | null;
  expireAt: string | null;
}

/** 结算报价（服务端统一计价，与下单结果逐分一致） */
export interface Pricing {
  subtotalCents: number;
  memberDiscountCents: number;
  couponDiscountCents: number;
  fullCutCents: number;
  pointsUsed: number;
  pointsDiscountCents: number;
  shippingCents: number;
  totalCents: number;
  steps: { label: string; cents: number; note?: string }[];
  couponNote: string;
  level: { key: string; label: string; rate: number };
  display: { subtotal: number; discount: number; shipping: number; total: number; saved: number };
  next: { label: string; gapCents: number; cutCents: number } | null;
}

export interface PreviewResult extends Pricing {
  items: any[];
  coupons: (UserCoupon & { userCouponId: number; usable: boolean; reason: string | null; discount: number; freeShip: boolean })[];
  pointsBalance: number;
}

export interface FlashSale {
  id: number;
  productId: number;
  skuId: number;
  campaign: string;
  productName: string;
  image: string;
  origin: number;
  price: number;
  off: number;
  stock: number;
  sold: number;
  remain: number;
  progress: number;
  endAt: string;
  serverNow: number;
}

export interface GroupBuy {
  id: number;
  productId: number;
  productTitle: string;
  image: string;
  origin: number;
  price: number;
  save: number;
  required: number;
  expireHours: number;
  teams: number;
}

export interface Review {
  id: number;
  rating: number;
  content: string;
  images: string[];
  userName: string;
  reply: string | null;
  useful: number;
  createdAt: string;
}

export interface ShipmentEvent {
  id: number;
  node: string;
  description: string;
  at: string;
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: ToolTrace[];
  latency?: number;
  pending?: boolean;
}
