/** 建表 SQL —— 幂等，可重复执行 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  compare_at_cents INTEGER,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '其他',
  tags TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  rating REAL NOT NULL DEFAULT 4.8,
  sales INTEGER NOT NULL DEFAULT 0,
  specs TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- 0 表示该商品无规格；有规格时必须带上 sku_id，否则同商品不同规格会挤成一行
  sku_id INTEGER NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 1,
  selected INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id, sku_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  ai_assisted INTEGER NOT NULL DEFAULT 0,
  idem_key TEXT,
  -- 退款前的原状态：驳回时按它回滚，避免已发货订单被打回「待发货」
  status_before_refund TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  carrier TEXT NOT NULL DEFAULT '',
  tracking_no TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  shipped_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idem ON orders(user_id, idem_key) WHERE idem_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  reject_reason TEXT NOT NULL DEFAULT '',
  operator TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  scene TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '新会话',
  mode TEXT NOT NULL DEFAULT 'local',
  handoff INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON ai_conversations(user_id, scene);

-- 收货地址簿：移动端下单不再写死地址
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  region TEXT NOT NULL,
  detail TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_addr_user ON addresses(user_id);

-- AI 转人工工单：让「建议转人工」不再是死路
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  conversation_id INTEGER,
  summary TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ticket_status ON support_tickets(status, id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT NOT NULL DEFAULT '[]',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON ai_messages(conversation_id);

CREATE TABLE IF NOT EXISTS ai_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── 店铺：淘宝/京东都是"店"为核心，商品归属店铺 ──
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  logo TEXT NOT NULL DEFAULT '',
  rating REAL NOT NULL DEFAULT 4.8,
  is_self INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── SKU：同一商品多规格，价格与库存独立 ──
CREATE TABLE IF NOT EXISTS product_skus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  spec_json TEXT NOT NULL DEFAULT '{}',
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL DEFAULT '',
  sku_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sku_product ON product_skus(product_id);

-- ── 评价：一单一评，支持晒单图 / 短视频 / 返现 ──
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  content TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  video TEXT NOT NULL DEFAULT '',
  video_cover TEXT NOT NULL DEFAULT '',
  anonymous INTEGER NOT NULL DEFAULT 0,
  reply TEXT NOT NULL DEFAULT '',
  useful INTEGER NOT NULL DEFAULT 0,
  -- 发布时按「文字数 + 图片数 + 是否带视频」计算的返现，入账后不可变
  reward_cents INTEGER NOT NULL DEFAULT 0,
  reward_points INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'basic',
  -- 分项评分：{"appearance":5,"performance":4,...}，键由商品类目决定
  dimensions TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_item ON reviews(order_item_id);
CREATE INDEX IF NOT EXISTS idx_review_product ON reviews(product_id, id);

-- ── 评价标签：官方词库 + 买家自定义（待审核） ──
CREATE TABLE IF NOT EXISTS review_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- appearance / performance / color / quality / fit / taste / effect / texture / fresh / price / service / custom
  dimension TEXT NOT NULL DEFAULT 'appearance',
  -- good / bad / neutral，用于前端区分"夸"与"吐槽"
  polarity TEXT NOT NULL DEFAULT 'good',
  -- 空串表示全类目通用；否则只在对应类目的商品上出现
  category TEXT NOT NULL DEFAULT '',
  -- official 官方词库 / user 买家自定义
  source TEXT NOT NULL DEFAULT 'official',
  -- active 生效 / pending 待审核 / blocked 已屏蔽
  status TEXT NOT NULL DEFAULT 'active',
  sort INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_tag_unique ON review_tags(name, dimension, category);
CREATE INDEX IF NOT EXISTS idx_review_tag_status ON review_tags(status, dimension, category);

CREATE TABLE IF NOT EXISTS review_tag_links (
  review_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  -- 冗余维度，按维度筛选时少一次 JOIN
  dimension TEXT NOT NULL DEFAULT 'appearance',
  PRIMARY KEY (review_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_review_tag_link_tag ON review_tag_links(tag_id, review_id);

-- ── 优惠券模板 ──
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'reduce',
  threshold_cents INTEGER NOT NULL DEFAULT 0,
  value INTEGER NOT NULL DEFAULT 0,
  max_discount_cents INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  per_user INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL DEFAULT (datetime('now')),
  end_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS user_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coupon_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unused',
  order_id INTEGER,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  expire_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ucoupon_user ON user_coupons(user_id, status);

-- ── 秒杀：限量低价，每人限购 ──
CREATE TABLE IF NOT EXISTS flash_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  sku_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  sold INTEGER NOT NULL DEFAULT 0,
  limit_per_user INTEGER NOT NULL DEFAULT 1,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_flash_window ON flash_sales(status, start_at, end_at);

-- ── 拼团 ──
CREATE TABLE IF NOT EXISTS group_buys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  sku_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  required INTEGER NOT NULL DEFAULT 2,
  expire_hours INTEGER NOT NULL DEFAULT 24,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_buy_id INTEGER NOT NULL,
  leader_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'forming',
  expire_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_team_gb ON group_teams(group_buy_id, status);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  order_id INTEGER,
  is_leader INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_uniq ON group_members(team_id, user_id);

-- ── 收藏 / 足迹 ──
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS footprints (
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, product_id)
);

-- ── 积分流水 ──
CREATE TABLE IF NOT EXISTS points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_points_user ON points_log(user_id, id);

-- ── 余额（评价返现入账 / 下单抵扣）流水 ──
CREATE TABLE IF NOT EXISTS wallet_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  delta_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_log(user_id, id);

-- ── 逛逛内容流（抖音式内容即货架）──
CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER,
  author_name TEXT NOT NULL DEFAULT '官方账号',
  type TEXT NOT NULL DEFAULT 'image',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  media TEXT NOT NULL DEFAULT '',
  product_ids TEXT NOT NULL DEFAULT '[]',
  likes INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feed_likes (
  feed_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (feed_id, user_id)
);

-- ── 物流轨迹 ──
CREATE TABLE IF NOT EXISTS shipment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ship_order ON shipment_events(order_id, id);

CREATE TABLE IF NOT EXISTS kb_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
