import { run, get, all, tx } from './index.js';
import { SCHEMA } from './schema.js';
import { hashPassword } from '../services/auth.js';
import { ensureTagLibrary, attachDemoTags } from '../services/review-tags.js';

export function migrate() {
  tx(() => {
    const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
    for (const s of statements) run(s + ';');
  // 增量迁移：老库补列（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）
  ensureColumn('products', 'specs', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('refunds', 'reject_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('refunds', 'operator', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('orders', 'shipping_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'status_before_refund', 'TEXT');
  ensureColumn('orders', 'cancel_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('orders', 'carrier', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('orders', 'tracking_no', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('orders', 'completed_at', 'TEXT');
  ensureColumn('orders', 'cancelled_at', 'TEXT');
  ensureColumn('ai_conversations', 'handoff', 'INTEGER NOT NULL DEFAULT 0');

  // 商城 2.0：店铺 / SKU / 营销 / 会员
  ensureColumn('products', 'shop_id', 'INTEGER');
  ensureColumn('products', 'images', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('products', 'video', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('products', 'sold_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'shop_id', 'INTEGER');
  ensureColumn('orders', 'coupon_id', 'INTEGER');
  ensureColumn('orders', 'coupon_discount_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'fullcut_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'points_used', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'points_discount_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'group_team_id', 'INTEGER');
  ensureColumn('orders', 'flash_sale_id', 'INTEGER');
  ensureColumn('orders', 'reviewed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('order_items', 'sku_id', 'INTEGER');
  ensureColumn('order_items', 'spec_text', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('order_items', 'image', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'points', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'level', "TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn('users', 'total_spent_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'avatar', "TEXT NOT NULL DEFAULT ''");

  // 评价 3.0：晒视频 + 图文返现（余额可下单抵扣）
  ensureColumn('users', 'balance_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('reviews', 'video', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('reviews', 'video_cover', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('reviews', 'reward_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('reviews', 'reward_points', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('reviews', 'tier', "TEXT NOT NULL DEFAULT 'basic'");
  ensureColumn('orders', 'balance_used', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'balance_discount_cents', 'INTEGER NOT NULL DEFAULT 0');

  // 评价 4.0：分项评分与印象标签（老库补列 + 官方词库幂等写入）
  ensureColumn('reviews', 'dimensions', "TEXT NOT NULL DEFAULT '{}'");
  ensureTagLibrary();
  // 老库升级：一条标签关联都没有时，给历史评价补上演示标签，避免商品页开箱空白
  if (get('SELECT COUNT(*) c FROM review_tag_links').c === 0) attachDemoTags();

  rebuildCartForSku();
  });
}

/**
 * 老库的 cart_items 只有 UNIQUE(user_id, product_id)，同一商品的不同规格会互相覆盖。
 * SQLite 不能删除约束，只能重建表。这里做一次幂等迁移。
 */
function rebuildCartForSku() {
  try {
    const info = all('PRAGMA table_info(cart_items)');
    if (!info.length) return;
    if (info.some((c) => c.name === 'sku_id')) return;
    run('ALTER TABLE cart_items RENAME TO cart_items_legacy');
    run(`CREATE TABLE cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku_id INTEGER NOT NULL DEFAULT 0,
      qty INTEGER NOT NULL DEFAULT 1,
      selected INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, product_id, sku_id)
    )`);
    run(`INSERT INTO cart_items (user_id, product_id, sku_id, qty, created_at)
         SELECT user_id, product_id, 0, qty, created_at FROM cart_items_legacy`);
    run('DROP TABLE cart_items_legacy');
    console.log('[migrate] cart_items 已按 SKU 维度重建');
  } catch (e) {
    if (!/no such table/i.test(e.message)) console.warn('[migrate] cart_items 迁移跳过:', e.message);
  }
}

function ensureColumn(table, column, ddl) {
  try {
    const cols = all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch { /* 表尚未创建时忽略 */ }
}

const PRODUCTS = [
  ['AirFlow Pro 无线降噪耳机', '40h 续航 · 自适应降噪', '双馈降噪麦克风，通勤地铁里也能听清人声。支持多设备无缝切换，充电 10 分钟可用 4 小时。', 89900, 109900, 120, '数码', '降噪,耳机,通勤', '🎧'],
  ['Lumos 智能台灯', '无频闪 · 自动调光', '内置环境光传感器，随昼夜自动调节色温。触控调光，支持记忆上次亮度。', 32900, 39900, 86, '家居', '护眼,台灯,卧室', '💡'],
  ['CloudKnit 云感卫衣', '320g 双面绒 · 抗起球', '落肩版型，宽松但有型。领口罗纹加固，洗十次不变形。', 25900, null, 200, '服饰', '卫衣,秋冬,基础款', '🧥'],
  ['BrewMaster 手冲咖啡壶', '细口控流 · 304 不锈钢', '壶嘴 6mm 细口设计，水流稳定。配 600ml 容量，一次两杯。', 18900, 22900, 64, '家居', '咖啡,手冲,器具', '☕'],
  ['Nomad 通勤双肩包', '16 寸隔层 · 防泼水', '独立电脑仓带缓冲，侧边隐藏防盗口袋。背负系统透气减压。', 45900, null, 150, '服饰', '背包,通勤,电脑包', '🎒'],
  ['Glow 精华水 150ml', '烟酰胺 5% · 温和配方', '低刺激配方，敏感肌可用。搭配化妆棉湿敷效果更佳。', 27900, 32900, 300, '美妆', '护肤,精华,保湿', '🧴'],
  ['Sonic 电动牙刷', '5 档模式 · 30 天续航', '压力感应提醒，刷太用力会震动提示。IPX7 全身水洗。', 21900, 26900, 95, '个护', '牙刷,口腔,个护', '🪥'],
  ['Terra 有机燕麦片 1kg', '0 添加糖 · 高纤维', '整粒压片，保留胚芽。冷泡热煮皆可，早餐三分钟搞定。', 5900, null, 500, '食品', '早餐,燕麦,健康', '🥣'],
  ['PixelPad 11 平板', '2.5K 120Hz · 8+256G', '支持手写笔，记笔记延迟低。四扬声器，横屏观影体验好。', 219900, 249900, 40, '数码', '平板,学习,影音', '📱'],
  ['Aero 空气循环扇', '直流变频 · 静音 22dB', '8 档风速，可上下左右摇头。睡眠模式自动降档。', 39900, 45900, 70, '家居', '风扇,静音,夏天', '🌀'],
  ['Stride 轻量跑鞋', '单只 210g · 回弹中底', '工程网布鞋面，透气不闷脚。适合 5-10km 日常跑量。', 49900, 59900, 110, '服饰', '跑鞋,运动,轻量', '👟'],
  ['PureAir 迷你净化器', 'CADR 200 · 桌面级', '三层滤网，除甲醛除异味。夜间模式噪音低于 25dB。', 69900, null, 55, '家居', '净化器,空气,除甲醛', '🌬️'],
  ['Zen 香薰蜡烛礼盒', '大豆蜡 · 3 种香型', '无烟配方，燃烧时长约 30 小时/支。含雪松、白茶、鼠尾草。', 16900, 19900, 180, '家居', '香薰,礼物,蜡烛', '🕯️'],
  ['Chef 不粘炒锅 28cm', '蜂窝纹理 · 少油不粘', '适用于电磁炉和燃气灶。锅体加厚，受热均匀。', 28900, 34900, 88, '家居', '锅具,厨房,不粘', '🍳'],
  ['Silk 真丝眼罩', '6A 级桑蚕丝 · 遮光', '可调节绑带，侧睡不压眼。附赠收纳袋，出差带着方便。', 9900, null, 240, '个护', '眼罩,助眠,真丝', '😴'],
  ['Vision 便携投影仪', '1080P · 自动对焦', '自动梯形校正，白墙即投。内置电池，户外露营可看一部电影。', 159900, 189900, 35, '数码', '投影,露营,影音', '📽️'],
];

/** 结构化规格：直接回应"规格/尺寸是否真实""到手价怎么算"的决策焦虑 */
const SPECS = {
  'AirFlow Pro 无线降噪耳机': { 重量: '单耳 4.8g / 充电盒 42g', 续航: '单次 8h，配盒 40h', 降噪深度: '最高 -42dB', 连接: '蓝牙 5.3，双设备切换', 充电口: 'USB-C，10 分钟用 4 小时', 保修: '1 年质保，7 天内非人为损坏可换新' },
  'Lumos 智能台灯': { 尺寸: '灯头 42cm × 18cm，底座 18cm × 18cm', 色温: '2700K–6500K 无级可调', 显色指数: 'Ra ≥ 95', 功率: '最大 18W', 供电: 'DC 24V 适配器', 保修: '2 年质保' },
  'CloudKnit 云感卫衣': { 尺码: 'S/M/L/XL（模特 178cm 68kg 穿 M）', 面料: '320g 双面绒，82% 棉 18% 聚酯', 版型: '落肩宽松，胸围 M 码 116cm', 洗护: '30℃ 机洗，反面洗，不可漂白', 产地: '中国', 退换: '7 天无理由，吊牌完整可退' },
  'BrewMaster 手冲咖啡壶': { 容量: '600ml（约 2 杯）', 材质: '304 不锈钢，壶嘴口 6mm', 适配: '明火 / 电磁炉通用', 重量: '328g', 附件: '附赠滤杯 1 个', 保修: '1 年' },
  'Nomad 通勤双肩包': { 尺寸: '45cm × 30cm × 15cm', 容量: '22L', 电脑仓: '可放 16 寸笔记本（38cm × 26cm）', 面料: '900D 防泼水尼龙', 重量: '850g', 退换: '7 天无理由' },
  'Glow 精华水 150ml': { 容量: '150ml', 核心成分: '烟酰胺 5%、透明质酸', 适用肤质: '干性 / 混合性（敏感肌建议先试用）', 保质期: '未开封 3 年，开封后 12 个月', 备案号: '国妆网备字（示例）', 退换: '开封后不支持无理由退货' },
  'Sonic 电动牙刷': { 模式: '清洁 / 亮白 / 敏感 / 按摩 / 抛光 5 档', 续航: '30 天（每天 2 次）', 防水: 'IPX7 全身水洗', 刷头: '标配 2 支，建议 3 个月更换', 充电: 'USB-C，6 小时充满', 保修: '主机 1 年，刷头不保' },
  'Terra 有机燕麦片 1kg': { 净含量: '1kg（约 20 份）', 配料: '100% 全麦燕麦', 保质期: '12 个月', 储存: '阴凉干燥处，开封后密封', 认证: '有机认证（示例）', 退换: '食品类未开封 7 天可退' },
  'PixelPad 11 平板': { 屏幕: '11 英寸 2.5K 120Hz', 存储: '8GB + 256GB', 重量: '480g', 电池: '8000mAh，支持 33W 快充', 手写笔: '单独购买，延迟 4ms', 保修: '整机 1 年' },
  'Aero 空气循环扇': { 尺寸: '直径 30cm，高 95cm', 风量: '8 档，最大 1200m³/h', 噪音: '最低 22dB', 功率: '28W', 摇头: '上下 90° / 左右 120°', 保修: '2 年' },
  'Stride 轻量跑鞋': { 尺码: '36–45（偏标准码，脚宽建议大半码）', 单只重量: '210g（42 码）', 鞋面: '工程网布', 中底: '超临界发泡，回弹率 78%', 适用: '5–10km 日常跑 / 通勤', 退换: '未外穿可 7 天无理由' },
  'PureAir 迷你净化器': { 尺寸: '22cm × 22cm × 35cm', CADR: '200m³/h（适用 20–30㎡）', 滤网: '三层复合，建议 6–8 个月更换', 噪音: '夜间模式 < 25dB', 功率: '35W', 保修: '整机 1 年' },
  'Zen 香薰蜡烛礼盒': { 规格: '3 支 × 120g', 香型: '雪松 / 白茶 / 鼠尾草', 燃烧时长: '约 30 小时/支', 蜡质: '天然大豆蜡，无烟配方', 礼盒: '含礼袋，可直接送人', 退换: '未点燃可 7 天无理由' },
  'Chef 不粘炒锅 28cm': { 口径: '28cm，深 8cm', 材质: '铝合金锅体 + 蜂窝纹理涂层', 适配: '电磁炉 / 燃气灶通用', 重量: '1.15kg', 洗护: '不建议钢丝球，可用软海绵', 保修: '1 年涂层质保' },
  'Silk 真丝眼罩': { 材质: '6A 级 19 姆米桑蚕丝', 尺寸: '展开 21cm × 9cm，绑带可调 55–70cm', 重量: '18g', 洗护: '手洗冷水，阴干', 附件: '收纳袋 × 1', 退换: '未使用可 7 天无理由' },
  'Vision 便携投影仪': { 分辨率: '1920 × 1080', 亮度: '500 ANSI 流明', 投影尺寸: '40–120 英寸', 电池: '内置 12000mAh，约 2.5 小时', 接口: 'HDMI / USB / 3.5mm', 保修: '整机 1 年' },
};

const KB = [
  ['运费怎么算', '全场满 99 元包邮，未满 99 元收取 8 元运费。偏远地区（新疆、西藏、内蒙古部分地区）需额外补 12 元。', '物流,运费'],
  ['多久发货', '现货商品在付款后 24 小时内发出，大促期间可能延迟至 48 小时。预售商品以详情页标注时间为准。', '物流,发货'],
  ['支持七天无理由吗', '服饰、家居、个护类商品支持签收后 7 天无理由退换，需保持吊牌完整、不影响二次销售。食品、贴身衣物、已拆封的美妆不支持。', '售后,退货'],
  ['退款多久到账', '审核通过后 1-3 个工作日原路退回。银行卡支付可能延至 5 个工作日。', '售后,退款'],
  ['可以修改收货地址吗', '未发货的订单可以联系客服修改地址；已发货的订单需联系快递公司中转，可能产生额外费用。', '订单,地址'],
  ['有发票吗', '支持开具电子普通发票，下单时在备注中填写抬头与税号，发货后 3 个工作日内发送至预留邮箱。', '发票,订单'],
  ['质量问题怎么办', '签收 15 天内出现非人为质量问题，可申请免费换新，运费由我们承担。请保留开箱视频或照片。', '售后,质量'],
  ['会员有优惠吗', '注册即成为普通会员，累计消费满 1000 元升级为银卡（95 折），满 5000 元升级金卡（9 折）。', '会员,优惠'],
];

/**
 * 种子数据整包放在一个事务里：
 * 逐条自动提交时，首次启动要跑上千条 INSERT，耗时接近一分钟；
 * 包事务后同样数据 1–2 秒完成，且中途失败不会留下半套数据。
 */
export function seed(opts = {}) {
  return tx(() => seedInner(opts));
}

function seedInner({ force = false } = {}) {
  const userCount = get('SELECT COUNT(*) AS c FROM users').c;
  if (userCount > 0 && !force) return { seeded: false };

  if (force) {
    for (const t of ['feed_likes', 'feeds', 'shipment_events', 'points_log', 'footprints', 'favorites',
      'group_members', 'group_teams', 'group_buys', 'flash_sales', 'user_coupons', 'coupons',
      'review_tag_links', 'reviews', 'product_skus', 'shops',
      'support_tickets', 'addresses', 'ai_messages', 'ai_conversations', 'refunds', 'order_items',
      'orders', 'cart_items', 'products', 'kb_entries', 'ai_config', 'users']) {
      run(`DELETE FROM ${t}`);
    }
    // 官方词库保留（migrate 已幂等写入），自定义词条随演示数据一起清掉
    run("DELETE FROM review_tags WHERE source = 'user'");
    run(`DELETE FROM sqlite_sequence WHERE name IN ('users','products','orders','order_items','refunds',
      'ai_conversations','ai_messages','kb_entries','cart_items','addresses','support_tickets',
      'shops','product_skus','reviews','coupons','user_coupons','flash_sales','group_buys',
      'group_teams','group_members','points_log','feeds','shipment_events','review_tags')`);
  }

  const users = [
    ['admin@mall.dev', 'admin123', '运营小八', 'merchant'],
    ['demo@mall.dev', 'demo123', '演示用户', 'customer'],
    ['amy@mall.dev', 'demo123', 'Amy', 'customer'],
  ];
  for (const [email, pwd, name, role] of users) {
    run('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)', [email, hashPassword(pwd), name, role]);
  }

  // ── 店铺：淘宝/京东的"店"概念，商品必须有归属方 ──
  const SHOPS = [
    ['AI Mall 自营旗舰店', '🏬', 4.9, 1, '官方自营，正品保障，48 小时内发货'],
    ['潮流服饰馆', '👕', 4.7, 0, '专注基础款与通勤穿搭，支持 7 天无理由'],
    ['悦己生活馆', '🌿', 4.8, 0, '美妆个护与健康食品，正品可查'],
  ];
  for (const [name, logo, rating, isSelf, desc] of SHOPS) {
    run('INSERT INTO shops (name, logo, rating, is_self, description) VALUES (?,?,?,?,?)',
      [name, logo, rating, isSelf, desc]);
  }
  const shopOf = (category) => (category === '服饰' ? 2 : ['美妆', '个护', '食品'].includes(category) ? 3 : 1);

  for (const p of PRODUCTS) {
    // 第 10 项为结构化规格（键值对），用于详情页"规格实测"表，解决"信息不透明"
    run(
      `INSERT INTO products (title, subtitle, description, price_cents, compare_at_cents, stock, category, tags, image, sales, rating, specs, shop_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], Math.floor(Math.random() * 800) + 20,
        (Math.random() * 0.4 + 4.6).toFixed(1), JSON.stringify(SPECS[p[0]] || {}), shopOf(p[6])],
    );
  }

  // ── SKU：按品类生成有意义的规格组合，价格与库存独立 ──
  const skuPlan = (p) => {
    if (p[6] === '服饰') {
      return ['S', 'M', 'L', 'XL'].map((size, i) => ({
        spec: { 尺码: size }, price: p[3], stock: Math.max(3, Math.round(p[5] / 4)),
        image: p[8], code: `-${size}`, delta: i,
      }));
    }
    if (p[6] === '数码') {
      return [
        { spec: { 颜色: '深空灰' }, price: p[3], stock: Math.round(p[5] * 0.6), image: '⬛', code: '-GY' },
        { spec: { 颜色: '星光白' }, price: p[3] + 2000, stock: Math.round(p[5] * 0.4), image: '⬜', code: '-WH' },
      ];
    }
    return [
      { spec: { 规格: '标准装' }, price: p[3], stock: Math.round(p[5] * 0.7), image: p[8], code: '-STD' },
      { spec: { 规格: '套装' }, price: Math.round(p[3] * 1.8), stock: Math.round(p[5] * 0.3), image: p[8], code: '-SET' },
    ];
  };
  for (const [i, p] of PRODUCTS.entries()) {
    for (const s of skuPlan(p)) {
      run(`INSERT INTO product_skus (product_id, spec_json, price_cents, stock, image, sku_code)
           VALUES (?,?,?,?,?,?)`,
        [i + 1, JSON.stringify(s.spec), s.price, s.stock, s.image, `SKU${String(i + 1).padStart(3, '0')}${s.code}`]);
    }
  }

  // ── 优惠券：新人券 / 品类券 / 满减券 / 免邮券 / 折扣券 ──
  const COUPONS = [
    ['新人专享 满 99 减 20', 'reduce', 9900, 2000, 0, 9999, 1, '', '+30 days'],
    ['全场 满 199 减 30', 'reduce', 19900, 3000, 0, 9999, 3, '', '+60 days'],
    ['数码专享 满 500 减 60', 'reduce', 50000, 6000, 0, 999, 1, '数码', '+30 days'],
    ['满 300 享 9 折（最高减 100）', 'discount', 30000, 90, 10000, 999, 2, '', '+45 days'],
    ['免邮券（无门槛）', 'free_ship', 0, 0, 0, 9999, 2, '', '+30 days'],
  ];
  for (const [title, type, threshold, value, maxDiscount, total, perUser, category, window] of COUPONS) {
    run(`INSERT INTO coupons (title, type, threshold_cents, value, max_discount_cents, total, per_user, category, end_at)
         VALUES (?,?,?,?,?,?,?,?,datetime('now', ?))`,
      [title, type, threshold, value, maxDiscount, total, perUser, category, window]);
  }

  // ── 秒杀：3 场进行中的限时低价 ──
  const flashPlan = [
    [1, 69900, 20, -30, '+6 hours', '限时直降 200'],
    [6, 19900, 30, -30, '+4 hours', '今日秒杀'],
    [9, 189900, 8, -20, '+8 hours', '整点开抢'],
  ];
  for (const [pid, price, stock, startMin, endWindow, title] of flashPlan) {
    run(`INSERT INTO flash_sales (product_id, sku_id, title, price_cents, stock, start_at, end_at)
         VALUES (?,?,?,?,?,datetime('now', ?),datetime('now', ?))`,
      [pid, null, title, price, stock, `${startMin} minutes`, endWindow]);
  }

  // ── 拼团：2 人成团，24 小时有效 ──
  for (const [pid, price, required] of [[2, 27900, 2], [3, 21900, 2], [8, 4900, 3]]) {
    run(`INSERT INTO group_buys (product_id, title, price_cents, required, expire_hours)
         VALUES (?,?,?,?,24)`, [pid, '拼团更划算', price, required]);
  }

  for (const [q, a, t] of KB) {
    run('INSERT INTO kb_entries (question, answer, tags) VALUES (?,?,?)', [q, a, t]);
  }

  const defaults = {
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    temperature: '0.6',
    persona: '你是「小八」，一位温和、专业、不啰嗦的商城助手。先给结论，再给必要细节。',
    allow_refund: 'true',
  };
  for (const [k, v] of Object.entries(defaults)) {
    run('INSERT INTO ai_config (key, value) VALUES (?,?)', [k, v]);
  }

  // 给演示用户造两笔历史订单，便于 AI 客服有真实数据可查
  const demo = get('SELECT id FROM users WHERE email = ?', ['demo@mall.dev']);
  const p1 = get('SELECT * FROM products WHERE category = ? LIMIT 1', ['数码']);
  const p2 = get('SELECT * FROM products WHERE category = ? LIMIT 1', ['家居']);

  const mkOrder = (no, status, items, paidDaysAgo) => {
    const subtotal = items.reduce((s, i) => s + i.price_cents * i.qty, 0);
    const { lastId } = run(
      `INSERT INTO orders (order_no, user_id, status, subtotal_cents, total_cents, address, created_at, paid_at, shipped_at)
       VALUES (?,?,?,?,?,?,datetime('now', ?),?,?)`,
      [no, demo.id, status, subtotal, subtotal, '北京市朝阳区建国路 88 号 SOHO 现代城 B 座 1203', `-${paidDaysAgo} days`,
       `-${paidDaysAgo} days`, status === 'shipped' || status === 'completed' ? `-${paidDaysAgo - 1} days` : null],
    );
    for (const it of items) {
      run('INSERT INTO order_items (order_id, product_id, title, price_cents, qty) VALUES (?,?,?,?,?)',
        [lastId, it.id, it.title, it.price_cents, it.qty]);
    }
    return lastId;
  };

  mkOrder('AIM20261001001', 'shipped', [{ ...p1, qty: 1 }], 4);
  const completedOrderId = mkOrder('AIM20261010002', 'completed', [{ ...p2, qty: 2 }], 9);

  // ── 评价：真实已购评价 + 历史口碑，构成评分分布 ──
  const REVIEW_SEED = [
    [1, 5, '降噪确实到位，地铁上开最强档几乎听不到报站。佩戴久了耳朵不疼，续航一周充一次。', '[]', 1, '感谢认可，佩戴建议先选中等耳塞，密封更好降噪更明显。'],
    [1, 5, '音质偏流行调音，人声很清楚。双设备切换很顺，电脑手机来回切不用重连。', '[]', 0, ''],
    [1, 4, '整体满意，就是充电盒稍大，放裤兜有点鼓。', '[]', 0, ''],
    [1, 3, '降噪不错，但通话时对方说有点闷，风大的时候明显。', '[]', 0, '已记录，建议在安静环境下通话或开启通透模式。'],
    [2, 5, '自动调光很实用，晚上写东西不刺眼，显色也准。', '[]', 0, ''],
    [2, 4, '灯头有点重，调节角度时底座会轻微移动，其他都好。', '[]', 0, ''],
    [2, 5, '给孩子买的，无频闪这点最看重，用了两个月没问题。', '[]', 0, ''],
    [3, 5, '面料厚实不透，洗了三次没起球也没变形。落肩版型显瘦。', '[]', 0, ''],
    [3, 4, '颜色比图片深一点，但质感不错。165cm 穿 M 刚好。', '[]', 0, ''],
    [3, 5, '回购第二件了，秋冬当内搭很舒服。', '[]', 0, ''],
    [6, 5, '敏感肌用了一周没泛红，质地清爽不黏。', '[]', 0, ''],
    [6, 4, '味道很淡几乎没有，保湿够用，夏天单涂就行。', '[]', 0, ''],
    [9, 5, '屏幕素质好，看文档不累眼。手写笔延迟低，记笔记跟纸质差不多。', '[]', 0, ''],
    [9, 4, '性能足够日常，就是充电速度一般。', '[]', 0, ''],
    [11, 5, '很轻，跑 8 公里脚不酸。鞋楦偏窄，宽脚建议大半码。', '[]', 0, ''],
    [11, 4, '回弹不错，鞋面透气。鞋带偏短。', '[]', 0, ''],
  ];
  const reviewers = ['amy@mall.dev', 'demo@mall.dev', 'admin@mall.dev'];
  for (const [pid, rating, content, images, anonymous, reply] of REVIEW_SEED) {
    const openid = get('SELECT id FROM users WHERE email = ?', [reviewers[pid % 3]]).id;
    run(`INSERT INTO reviews (order_id, order_item_id, user_id, product_id, rating, content, images, anonymous, reply, useful)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [completedOrderId, null, openid, pid, rating, content, images, anonymous, reply, Math.floor(Math.random() * 40)]);
  }
  // 让演示用户对已完成订单的那件商品留下一条真实评价（order_item 维度，用来验证"一单一评"）
  const completedItem = get('SELECT * FROM order_items WHERE order_id = ? LIMIT 1', [completedOrderId]);
  run(`INSERT INTO reviews (order_id, order_item_id, user_id, product_id, rating, content, images, anonymous, reply)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    [completedOrderId, completedItem.id, demo.id, completedItem.product_id, 5,
      '灯很好用，自动调光省心，包装也扎实。', '[]', 0, '']);
  run('UPDATE orders SET reviewed = 1 WHERE id = ?', [completedOrderId]);

  // 重算商品评分与评价数（列表页直接读，避免每次聚合）
  for (const pid of new Set(REVIEW_SEED.map((r) => r[0]))) {
    const s = get('SELECT AVG(rating) a, COUNT(*) c FROM reviews WHERE product_id = ?', [pid]);
    run('UPDATE products SET rating = ? WHERE id = ?', [+(s.a || 4.8).toFixed(1), pid]);
  }

  // 给演示评价挂上分项评分与印象标签，商品页开箱就有"买家印象"
  attachDemoTags();

  // ── 逛逛内容流：内容即货架，点进去直接买 ──
  const FEEDS = [
    ['通勤降噪实测：地铁 80 分贝下的真实表现', '连续戴了两周，把降噪开到最强，报站声基本听不见。缺点是过马路要记得开通透。', '🎧', 'linear-gradient(135deg,#667eea,#764ba2)', '[1]', 132, 2400],
    ['租房改造 300 元搞定全屋氛围光', '一盏台灯 + 一支香薰，晚上回家幸福感直接拉满。台灯色温调到 3000K 最舒服。', '💡', 'linear-gradient(135deg,#f6d365,#fda085)', '[2,13]', 268, 5100],
    ['基础款卫衣怎么穿不显土', '关键是落肩版型 + 下半身收窄。配直筒裤或半裙都行，别选太软塌的面料。', '🧥', 'linear-gradient(135deg,#a1c4fd,#c2e9fb)', '[3]', 431, 8800],
    ['早八人的 3 分钟早餐方案', '燕麦 + 冷萃 + 一把坚果，饱腹到中午。附我常买的燕麦链接，0 添加糖那款。', '🥣', 'linear-gradient(135deg,#84fab0,#8fd3f4)', '[8]', 197, 3600],
    ['手冲入门：不看参数也能稳定出杯', '记住 1:15 粉水比、92℃ 水温、2 分半结束，剩下靠喝。壶嘴细一点对新手更友好。', '☕', 'linear-gradient(135deg,#d4a373,#ccd5ae)', '[4]', 156, 2900],
    ['桌面焕新：把工位变成想待的地方', '净化器 + 台灯 + 一个好用的包，三个东西解决空气、光线和收纳。', '🌬️', 'linear-gradient(135deg,#e0c3fc,#8ec5fc)', '[12,2,5]', 89, 1700],
  ];
  for (const [title, body, cover, media, pids, likes, views] of FEEDS) {
    run(`INSERT INTO feeds (author_id, author_name, type, title, body, cover, media, product_ids, likes, views)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [demo.id, 'AI Mall 种草官', 'image', title, body, cover, media, pids, likes, views]);
  }

  // ── 物流轨迹：给已发货订单补齐节点，售后问答有据可查 ──
  const shippedOrder = get("SELECT id, tracking_no, carrier FROM orders WHERE status = 'shipped' ORDER BY id DESC LIMIT 1");
  if (shippedOrder) {
    const events = [
      ['已揽收', '商家已发货，顺丰速运已揽收', '北京市朝阳区', '-3 days'],
      ['运输中', '快件已到达【北京转运中心】', '北京市', '-2 days'],
      ['派送中', '快递员正在派送，请保持电话畅通', '北京市朝阳区', '-1 days'],
    ];
    for (const [status, desc, loc, at] of events) {
      run(`INSERT INTO shipment_events (order_id, status, description, location, created_at)
           VALUES (?,?,?,?,datetime('now', ?))`, [shippedOrder.id, status, desc, loc, at]);
    }
  }

  // ── 演示用户积分与会员资产 ──
  run('UPDATE users SET points = 1200, total_spent_cents = 128000 WHERE id = ?', [demo.id]);
  run("UPDATE users SET level = 'silver' WHERE id = ?", [demo.id]);
  for (const [delta, reason] of [[1500, '历史消费累计'], [-300, '抵扣订单 AIM20261010002']]) {
    run('INSERT INTO points_log (user_id, delta, reason) VALUES (?,?,?)', [demo.id, delta, reason]);
  }

  // 演示地址簿：移动端结算时可直接选用
  run(
    'INSERT INTO addresses (user_id, name, phone, region, detail, is_default) VALUES (?,?,?,?,?,1)',
    [demo.id, '演示用户', '13800138000', '北京市 朝阳区', '建国路 88 号 SOHO 现代城 B 座 1203'],
  );

  return { seeded: true, products: PRODUCTS.length, users: users.length };
}

export const demoAccounts = {
  merchant: { email: 'admin@mall.dev', password: 'admin123' },
  customer: { email: 'demo@mall.dev', password: 'demo123' },
};

export { all };

// ── CLI 入口：node src/db/seed.js [--force] ──
// 之前 npm run seed 只是 import 了本模块，什么都不会发生
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('db/seed.js');
if (invokedDirectly) {
  const force = process.argv.includes('--force');
  migrate();
  const r = seed({ force });
  if (r.seeded) {
    console.log(`✓ 种子数据已写入：${r.products} 个商品 / ${r.users} 个账号${force ? '（已清空重建）' : ''}`);
    console.log(`  商家 ${demoAccounts.merchant.email} / ${demoAccounts.merchant.password}`);
    console.log(`  买家 ${demoAccounts.customer.email} / ${demoAccounts.customer.password}`);
  } else {
    console.log('· 数据库已有数据，跳过。加 --force 可清空重建。');
  }
}
