/** 检索归因：解释"为什么推荐这件商品"，回应搜索结果不可解释的痛点 */
export interface MatchReason {
  field: 'title' | 'tags' | 'category' | 'desc' | 'price';
  words: string[];
  text: string;
}

export interface StockStatus {
  level: 'enough' | 'limited' | 'low' | 'out';
  label: string;
  hint: string;
  buyable: boolean;
}

export interface PriceBreakdown {
  origin: number | null;
  final: number;
  saving: number;
  discountLabel: string | null;
  shipping: { freeThreshold: number; fee: number; text: string };
  note: string;
}

export interface ReturnPolicy {
  returnable: boolean;
  days: number;
  text: string;
}

export interface Product {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  price: number;
  priceCents: number;
  compareAt: number | null;
  stock: number;
  stockStatus?: StockStatus;
  priceBreakdown?: PriceBreakdown;
  returnPolicy?: ReturnPolicy;
  specs?: Record<string, string>;
  category: string;
  tags: string[];
  image: string;
  status: 'active' | 'inactive';
  rating: number;
  sales: number;
  createdAt: string;
  /** explain=1 时返回 */
  matchScore?: number;
  hitCount?: number;
  matchReasons?: MatchReason[];
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'customer' | 'merchant';
}

export interface CartItem {
  cartId: number;
  qty: number;
  product: Product;
  subtotal: number;
  stockEnough: boolean;
}

export interface Cart {
  items: CartItem[];
  count: number;
  subtotal: number;
  shipping: number;
}

export interface OrderItem {
  id: number;
  productId: number;
  skuId?: number | null;
  specText?: string;
  title: string;
  price: number;
  qty: number;
  image?: string;
  category?: string;
  reviewed?: boolean;
}

export interface ShipmentEvent {
  status: string;
  description: string;
  location: string;
  at: string;
}

export interface Shipment {
  carrier: string;
  trackingNo: string;
  events: ShipmentEvent[];
  next: string;
  progress: number;
}

export interface PricingDetail {
  memberLabel: string;
  memberDiscount: number;
  couponTitle: string;
  couponDiscount: number;
  fullCut: number;
  pointsUsed: number;
  pointsDiscount: number;
  balanceDiscount: number;
}

export interface RefundTimelineNode {
  key: string;
  title: string;
  owner: string;
  ownerType: 'user' | 'merchant' | 'system';
  done: boolean;
  active?: boolean;
  at: string | null;
  desc: string;
}

/** 退款进度时间轴：说清"卡在哪、谁在处理、还要多久" */
export interface RefundTimeline {
  refundId: number;
  status: 'pending' | 'approved' | 'rejected';
  amount: number;
  reason: string;
  currentIndex: number;
  currentNode: RefundTimelineNode;
  nodes: RefundTimelineNode[];
  nextAction: string;
}

export interface Order {
  id: number;
  orderNo: string;
  userId: number;
  status: string;
  statusLabel: string;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  address: string;
  remark: string;
  aiAssisted: boolean;
  carrier?: string;
  trackingNo?: string;
  cancelReason?: string;
  refundedFrom?: string | null;
  items: OrderItem[];
  refund?: RefundTimeline | null;
  pricing?: PricingDetail;
  shipment?: Shipment | null;
  shopName?: string;
  isSelf?: boolean;
  reviewed?: boolean;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface ChatResult {
  conversationId: number;
  messageId: number;
  content: string;
  mode: 'local' | 'remote';
  latency: number;
  toolTrace: ToolTrace[];
  draft: { productId: number; subtitle: string; description: string; selling: string[] } | null;
  aiEnabled: boolean;
}

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: ToolTrace[];
  latency?: number;
  pending?: boolean;
}

export interface Stats {
  gmv: number;
  paidOrders: number;
  totalOrders: number;
  avgOrderValue: number;
  pendingShip: number;
  pendingRefund: number;
  sku: number;
  lowStock: number;
  users: number;
  openTickets?: number;
  topProducts: { id: number; title: string; sales: number; stock: number; price: number }[];
  trend: { date: string; orders: number; gmv: number }[];
  ai: { conversations: number; aiMessages: number; toolCallRate: number; byScene: Record<string, number>; mode: string };
}

export interface Refund {
  id: number;
  orderId: number;
  orderNo: string;
  userName: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  amount: number;
  rejectReason: string;
  operator: string;
  createdAt: string;
  decidedAt: string | null;
  timeline: RefundTimeline | null;
}

export interface Conversation {
  id: number;
  scene: string;
  title: string;
  mode: string;
  handoff?: boolean;
  createdAt: string;
  messageCount: number;
}

export interface Address {
  id: number;
  name: string;
  phone: string;
  region: string;
  detail: string;
  isDefault: boolean;
  full: string;
  createdAt?: string;
}

export interface SupportTicket {
  id: number;
  userId: number | null;
  userName: string;
  userEmail: string;
  conversationId: number | null;
  summary: string;
  contact: string;
  status: 'open' | 'resolved';
  reply: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Coupon {
  id: number;
  title: string;
  type: 'reduce' | 'discount' | 'free_ship';
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

export interface FlashSale {
  id: number;
  productId: number;
  campaign: string;
  productName: string;
  subtitle: string;
  image: string;
  origin: number;
  price: number;
  priceCents: number;
  off: number;
  stock: number;
  sold: number;
  remain: number;
  progress: number;
  limitPerUser: number;
  startAt: string;
  endAt: string;
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

export interface FeedProduct {
  id: number;
  title: string;
  price: number;
  compareAt: number | null;
  image: string;
  category: string;
  rating: number;
  sales: number;
}

export interface Feed {
  id: number;
  type: string;
  title: string;
  body: string;
  cover: string;
  media: string;
  authorName: string;
  likes: number;
  views: number;
  liked: boolean;
  products: FeedProduct[];
  createdAt: string;
}

export interface Review {
  id: number;
  rating: number;
  content: string;
  images: string[];
  anonymous: boolean;
  userName: string;
  reply: string;
  useful: number;
  createdAt: string;
}
