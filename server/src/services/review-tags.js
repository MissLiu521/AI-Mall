/**
 * 评价标签域：分项评分维度 + 印象标签词库 + 商品侧聚合
 *
 * 设计参照淘宝「买家印象」、京东「商品口碑」、拼多多「评价标签」：
 * - 一次评价可以分别给「外观 / 性能 / 颜色 / 质量 / 性价比 / 服务物流」打分（可选）；
 * - 每个维度下有多枚短标签（如「颜值在线」「运行流畅」「无色差」），可多选；
 * - 词库没覆盖到的，买家可以自己写（最多 3 个），进入待审核池，审核通过后进入公共词库；
 * - 商品页把标签按维度聚合成标签云，点标签即可筛选评价。
 *
 * 事实源：
 * - review_tag_links 是"评价 ↔ 标签"的唯一真相，reviews 不存标签快照，
 *   这样后台改名 / 合并 / 屏蔽能立刻反映到已发布的评价上；
 * - 标签计数实时聚合，不做冗余计数，避免回补 / 删评价后数字对不上。
 */
import { all, get, run } from '../db/index.js';
import { AppError } from './users.js';

/** 维度字典：key 存库，label/icon 只做展示 */
export const DIMENSIONS = {
  appearance: { key: 'appearance', label: '外观', icon: '✨', hint: '颜值、设计、做工' },
  performance: { key: 'performance', label: '性能', icon: '⚡', hint: '功能、流畅度、使用效果' },
  color: { key: 'color', label: '颜色', icon: '🎨', hint: '颜色、色差、实物还原' },
  quality: { key: 'quality', label: '质量', icon: '🛡', hint: '用料、耐用度、手感' },
  fit: { key: 'fit', label: '尺码', icon: '📏', hint: '大小、尺寸是否合适' },
  taste: { key: 'taste', label: '口感', icon: '😋', hint: '味道、口感' },
  fresh: { key: 'fresh', label: '新鲜度', icon: '🌿', hint: '日期、保鲜、冷链' },
  effect: { key: 'effect', label: '效果', icon: '💫', hint: '使用后的实际效果' },
  texture: { key: 'texture', label: '肤感', icon: '🫧', hint: '质地、吸收、清爽度' },
  price: { key: 'price', label: '性价比', icon: '💰', hint: '价格是否划算' },
  service: { key: 'service', label: '服务物流', icon: '🚚', hint: '发货、包装、客服' },
  custom: { key: 'custom', label: '我的标签', icon: '🏷', hint: '买家自己写的标签' },
};

/**
 * 不同类目关心的点不一样：
 * 服饰看版型与尺码，食品看口感与新鲜度，美妆看效果与肤感。
 * 不这么做的话，给一件卫衣评「运行流畅」会很怪。
 */
export const DIMENSION_SETS = {
  数码: ['appearance', 'performance', 'color', 'quality', 'price', 'service'],
  家居: ['appearance', 'performance', 'quality', 'color', 'price', 'service'],
  服饰: ['appearance', 'quality', 'fit', 'color', 'price', 'service'],
  美妆: ['appearance', 'effect', 'texture', 'quality', 'price', 'service'],
  个护: ['appearance', 'effect', 'texture', 'quality', 'price', 'service'],
  食品: ['appearance', 'taste', 'fresh', 'quality', 'price', 'service'],
};
const DEFAULT_SET = ['appearance', 'quality', 'color', 'price', 'service', 'performance'];

export const TAG_LIMITS = {
  maxTags: 8,
  maxCustom: 3,
  maxNameLength: 8,
};

export function dimensionsFor(category = '') {
  const keys = DIMENSION_SETS[category] || DEFAULT_SET;
  return keys.map((k) => ({ ...DIMENSIONS[k] }));
}

export function dimensionLabel(key) {
  return DIMENSIONS[key]?.label || key;
}

/**
 * 多值字段（维度/类目）：数组或逗号分隔字符串 → 去重 token 列表。
 * 维度与类目都支持多个值（如一个标签同时属于「外观+质量」、通用于「数码+家居」）。
 */
export function normTokens(v, { max = 4, maxLen = 12 } = {}) {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(/[,，、;；|]+/);
  const out = [];
  for (const r of raw) {
    const t = String(r ?? '').trim().slice(0, maxLen);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** 类目匹配片段：空 = 全类目通用，否则逗号包裹 LIKE（ref 为列名，可带别名） */
const catMatch = (ref) => `(${ref} = '' OR ',' || ${ref} || ',' LIKE '%,' || ? || ',%')`;

/**
 * 官方词库。
 * 元组：[维度, 标签名, 褒贬, 适用类目(空=通用)]
 * 同一维度内先列正向、后列负向，前端按顺序渲染，负向标签样式会区分开。
 */
const OFFICIAL_TAGS = [
  // ── 外观 ──
  ['appearance', '颜值在线', 'good', ''],
  ['appearance', '设计简约', 'good', ''],
  ['appearance', '做工精致', 'good', ''],
  ['appearance', '质感不错', 'good', ''],
  ['appearance', '包装讲究', 'good', ''],
  ['appearance', '有点廉价', 'bad', ''],
  ['appearance', '做工粗糙', 'bad', ''],
  ['appearance', '和图片有差距', 'bad', ''],
  ['appearance', '版型好看', 'good', '服饰'],
  ['appearance', '显瘦', 'good', '服饰'],
  ['appearance', '上身效果好', 'good', '服饰'],
  ['appearance', '细节到位', 'good', '服饰'],
  ['appearance', '版型偏大', 'bad', '服饰'],
  ['appearance', '线头多', 'bad', '服饰'],
  ['appearance', '轻薄便携', 'good', '数码'],
  ['appearance', '机身偏重', 'bad', '数码'],
  ['appearance', '摆着好看', 'good', '家居'],
  ['appearance', '很有氛围感', 'good', '家居'],
  ['appearance', '瓶身好挤', 'good', '美妆'],
  ['appearance', '瓶身好挤', 'good', '个护'],
  ['appearance', '分量足', 'good', '食品'],

  // ── 性能 / 效果 ──
  ['performance', '运行流畅', 'good', '数码'],
  ['performance', '反应灵敏', 'good', '数码'],
  ['performance', '续航持久', 'good', '数码'],
  ['performance', '降噪给力', 'good', '数码'],
  ['performance', '连接稳定', 'good', '数码'],
  ['performance', '屏幕清晰', 'good', '数码'],
  ['performance', '发热明显', 'bad', '数码'],
  ['performance', '偶尔卡顿', 'bad', '数码'],
  ['performance', '续航一般', 'bad', '数码'],
  ['performance', '噪音偏大', 'bad', '数码'],
  ['performance', '效果明显', 'good', '家居'],
  ['performance', '档位够用', 'good', '家居'],
  ['performance', '静音效果好', 'good', '家居'],
  ['performance', '风力偏小', 'bad', '家居'],
  ['performance', '噪音大', 'bad', '家居'],
  ['performance', '用起来顺手', 'good', ''],
  ['performance', '没达到预期', 'bad', ''],
  ['effect', '效果明显', 'good', '美妆'],
  ['effect', '温和不刺激', 'good', '美妆'],
  ['effect', '用完会回购', 'good', '美妆'],
  ['effect', '有点刺激', 'bad', '美妆'],
  ['effect', '效果一般', 'bad', '美妆'],
  ['effect', '效果明显', 'good', '个护'],
  ['effect', '温和不刺激', 'good', '个护'],
  ['effect', '用完会回购', 'good', '个护'],
  ['effect', '效果一般', 'bad', '个护'],
  ['effect', '有点刺激', 'bad', '个护'],

  // ── 颜色 ──
  ['color', '颜色正', 'good', ''],
  ['color', '无色差', 'good', ''],
  ['color', '比图片好看', 'good', ''],
  ['color', '实物偏暗', 'bad', ''],
  ['color', '色差明显', 'bad', ''],
  ['color', '颜色百搭', 'good', '服饰'],
  ['color', '显白', 'good', '服饰'],
  ['color', '掉色', 'bad', '服饰'],
  ['color', '配色高级', 'good', '数码'],
  ['color', '白色耐看', 'good', '数码'],
  ['color', '颜色温柔', 'good', '家居'],
  ['color', '和家里很搭', 'good', '家居'],

  // ── 质量 / 尺码 / 口感 / 新鲜度 ──
  ['quality', '用料扎实', 'good', ''],
  ['quality', '手感很好', 'good', ''],
  ['quality', '做工细致', 'good', ''],
  ['quality', '有点异味', 'bad', ''],
  ['quality', '不太耐用', 'bad', ''],
  ['quality', '容易磨损', 'bad', ''],
  ['quality', '面料厚实', 'good', '服饰'],
  ['quality', '洗后不变形', 'good', '服饰'],
  ['quality', '不起球', 'good', '服饰'],
  ['quality', '起球', 'bad', '服饰'],
  ['quality', '掉毛', 'bad', '服饰'],
  ['quality', '面料偏薄', 'bad', '服饰'],
  ['quality', '接口扎实', 'good', '数码'],
  ['quality', '屏幕无坏点', 'good', '数码'],
  ['quality', '材质结实', 'good', '家居'],
  ['quality', '没有异味', 'good', '家居'],
  ['quality', '日期新鲜', 'good', '食品'],
  ['quality', '品质稳定', 'good', '食品'],
  ['quality', '受潮', 'bad', '食品'],
  ['quality', '不新鲜', 'bad', '食品'],
  ['quality', '成分安全', 'good', '美妆'],
  ['quality', '成分安全', 'good', '个护'],
  ['fit', '尺码标准', 'good', '服饰'],
  ['fit', '尺寸合适', 'good', '服饰'],
  ['fit', '穿着舒适', 'good', '服饰'],
  ['fit', '偏大', 'bad', '服饰'],
  ['fit', '偏小', 'bad', '服饰'],
  ['fit', '鞋楦偏窄', 'bad', '服饰'],
  ['fit', '有点压脚', 'bad', '服饰'],
  ['taste', '味道不错', 'good', '食品'],
  ['taste', '口感细腻', 'good', '食品'],
  ['taste', '不太甜', 'good', '食品'],
  ['taste', '很香', 'good', '食品'],
  ['taste', '偏甜', 'bad', '食品'],
  ['taste', '味道一般', 'bad', '食品'],
  ['taste', '口感偏硬', 'bad', '食品'],
  ['fresh', '日期新鲜', 'good', '食品'],
  ['fresh', '保质期长', 'good', '食品'],
  ['fresh', '冷链到位', 'good', '食品'],
  ['fresh', '临期', 'bad', '食品'],
  ['fresh', '包装破损', 'bad', '食品'],
  ['texture', '质地清爽', 'good', '美妆'],
  ['texture', '不黏腻', 'good', '美妆'],
  ['texture', '吸收快', 'good', '美妆'],
  ['texture', '偏油', 'bad', '美妆'],
  ['texture', '香味太重', 'bad', '美妆'],
  ['texture', '搓泥', 'bad', '美妆'],
  ['texture', '泡沫细腻', 'good', '个护'],
  ['texture', '好冲洗', 'good', '个护'],
  ['texture', '不紧绷', 'good', '个护'],
  ['texture', '香味太重', 'bad', '个护'],
  ['texture', '洗完发干', 'bad', '个护'],

  // ── 性价比 ──
  ['price', '性价比高', 'good', ''],
  ['price', '物超所值', 'good', ''],
  ['price', '活动价划算', 'good', ''],
  ['price', '有点贵', 'bad', ''],
  ['price', '不值这个价', 'bad', ''],

  // ── 服务物流 ──
  ['service', '发货快', 'good', ''],
  ['service', '包装完好', 'good', ''],
  ['service', '物流给力', 'good', ''],
  ['service', '客服耐心', 'good', ''],
  ['service', '物流偏慢', 'bad', ''],
  ['service', '包装破损', 'bad', ''],
  ['service', '客服回复慢', 'bad', ''],
];

/** 排序值：同一维度/类目里按词库顺序，正向在前负向在后 */
function sortOf(dimension, category, polarity, index) {
  return (polarity === 'good' ? 0 : 100) + index;
}

/**
 * 幂等写入官方词库。
 * migrate 每次都跑，INSERT OR IGNORE 保证不重复、也不覆盖后台改过的字段。
 */
export function ensureTagLibrary() {
  const counters = new Map();
  for (const [dimension, name, polarity, category] of OFFICIAL_TAGS) {
    const key = `${dimension}|${category}`;
    const index = counters.get(key) || 0;
    counters.set(key, index + 1);
    run(
      `INSERT OR IGNORE INTO review_tags (name, dimension, polarity, category, source, status, sort)
       VALUES (?,?,?,?, 'official', 'active', ?)`,
      [name, dimension, polarity, category, sortOf(dimension, category, polarity, index)],
    );
  }
}

function productOf(productId) {
  const p = get('SELECT id, title, category FROM products WHERE id = ?', [+productId]);
  if (!p) throw new AppError('NOT_FOUND', '商品不存在', 404);
  return p;
}

/**
 * 评价弹窗用的候选标签：只返回本品类可用的维度与标签，避免跨类目乱入。
 */
export function tagOptions(productId) {
  const p = productOf(productId);
  const dims = dimensionsFor(p.category);
  const rows = all(
    `SELECT id, name, dimension, polarity, source FROM review_tags
      WHERE status = 'active' AND ${catMatch('category')}
      ORDER BY (category = '') ASC, sort, id`,
    [p.category],
  );
  // 一个标签可属多个维度（逗号分隔），分别挂进对应分组；同组去重
  const seen = new Map(dims.map((d) => [d.key, new Set()]));
  const groups = dims.map((d) => ({ ...d, tags: [] }));
  const extras = [];
  for (const r of rows) {
    const tokens = String(r.dimension || '').split(',').filter(Boolean);
    let placed = false;
    tokens.forEach((k) => {
      const gi = groups.findIndex((g) => g.key === k);
      if (gi >= 0 && !seen.get(k).has(r.id)) {
        seen.get(k).add(r.id);
        groups[gi].tags.push(r);
        placed = true;
      }
    });
    if (!placed) extras.push(r);
  }
  const result = groups.filter((g) => g.tags.length);
  if (extras.length) {
    result.push({ key: 'custom', label: '买家自创', icon: DIMENSIONS.custom.icon, hint: DIMENSIONS.custom.hint, tags: extras });
  }
  return {
    productId: p.id,
    category: p.category,
    dimensions: dims,
    groups: result,
    limits: TAG_LIMITS,
  };
}

/** 从 reviews.dimensions JSON 里解析分项评分 */
function parseDimensions(raw) {
  try {
    const o = JSON.parse(raw || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

/**
 * 商品页聚合：维度均分 + 标签云（只统计 active 标签）
 */
export function productTagStats(productId) {
  const p = productOf(productId);
  const dims = dimensionsFor(p.category);

  const reviews = all('SELECT id, dimensions FROM reviews WHERE product_id = ?', [+productId]);
  const acc = new Map(dims.map((d) => [d.key, { ...d, count: 0, sum: 0 }]));
  for (const r of reviews) {
    const d = parseDimensions(r.dimensions);
    for (const [k, v] of Object.entries(d)) {
      const item = acc.get(k);
      const n = Number(v);
      if (!item || !(n >= 1 && n <= 5)) continue;
      item.count += 1;
      item.sum += n;
    }
  }
  const dimensionStats = dims.map((d) => {
    const a = acc.get(d.key);
    return {
      key: d.key,
      label: d.label,
      icon: d.icon,
      hint: d.hint,
      count: a.count,
      avg: a.count ? +(a.sum / a.count).toFixed(1) : 0,
    };
  });

  const rows = all(
    `SELECT t.id, t.name, t.dimension, t.polarity, COUNT(*) AS count
       FROM review_tag_links l
       JOIN review_tags t ON t.id = l.tag_id
       JOIN reviews r ON r.id = l.review_id
      WHERE r.product_id = ? AND t.status = 'active'
      GROUP BY t.id
      ORDER BY (t.category = '') ASC, t.sort, t.id`,
    [+productId],
  );
  // 多维度标签（逗号分隔）分别挂进对应分组；没命中白名单维度的归到"买家自创"
  const seen = new Map(dims.map((d) => [d.key, new Set()]));
  const groups = dims.map((d) => ({ ...d, tags: [] }));
  const extras = [];
  for (const r of rows) {
    const tokens = String(r.dimension || '').split(',').filter(Boolean);
    let placed = false;
    tokens.forEach((k) => {
      const gi = groups.findIndex((g) => g.key === k);
      if (gi >= 0 && !seen.get(k).has(r.id)) {
        seen.get(k).add(r.id);
        groups[gi].tags.push(r);
        placed = true;
      }
    });
    if (!placed) extras.push(r);
  }
  const result = groups.filter((g) => g.tags.length);
  if (extras.length) {
    result.push({
      key: 'custom', label: '买家自创', icon: DIMENSIONS.custom.icon, hint: DIMENSIONS.custom.hint, tags: extras,
    });
  }

  const tagged = get(
    `SELECT COUNT(DISTINCT l.review_id) c
       FROM review_tag_links l JOIN reviews r ON r.id = l.review_id
      WHERE r.product_id = ?`,
    [+productId],
  ).c;

  return {
    productId: p.id,
    category: p.category,
    dimensions: dimensionStats,
    groups: result,
    // 扁平一份，前端做"点击标签筛选"时不用再找分组
    tags: result.flatMap((g) => g.tags.map((t) => ({ ...t, dimensionLabel: g.label }))),
    total: reviews.length,
    tagged,
  };
}

/** 标签名清洗：去掉 #、控制字符，压缩空白 */
export function sanitizeTagName(raw = '') {
  return String(raw)
    .replace(/[#＃\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAG_LIMITS.maxNameLength);
}

function findTagByName(name, category) {
  return get(
    `SELECT * FROM review_tags
      WHERE name = ? AND (category = '' OR ',' || category || ',' LIKE '%,' || ? || ',%')
      ORDER BY (category = ?) DESC, id ASC LIMIT 1`,
    [name, category, category],
  );
}

function createCustomTag(name, category, createdBy) {
  run(
    `INSERT OR IGNORE INTO review_tags (name, dimension, polarity, category, source, status, sort, created_by)
     VALUES (?, 'custom', 'neutral', ?, 'user', 'pending', 900, ?)`,
    [name, category, createdBy],
  );
  return get(
    'SELECT * FROM review_tags WHERE name = ? AND dimension = ? AND category = ?',
    [name, 'custom', category],
  );
}

/**
 * 把前端传来的标签（官方 id 或自定义名称）解析成可落库的标签行。
 * 规则：
 * - 总标签 ≤ 8，自定义 ≤ 3；
 * - id 必须存在且未被屏蔽；
 * - 自定义名与已有标签同名时复用，不重复造词。
 */
export function resolveTags(product, input, userId = null) {
  const list = Array.isArray(input) ? input.slice(0, 40) : [];
  const picked = [];
  const seen = new Set();
  let custom = 0;

  for (const raw of list) {
    if (picked.length >= TAG_LIMITS.maxTags) {
      throw new AppError('TAG_LIMIT', `最多选择 ${TAG_LIMITS.maxTags} 个标签`, 400);
    }

    let tag = null;
    let wantedName = '';
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
      tag = get('SELECT * FROM review_tags WHERE id = ?', [+raw]);
      if (!tag) throw new AppError('TAG_NOT_FOUND', '标签不存在', 400);
      if (tag.status === 'blocked') throw new AppError('TAG_BLOCKED', '该标签已被屏蔽', 400);
    } else if (typeof raw === 'string') {
      wantedName = sanitizeTagName(raw);
    } else if (raw && typeof raw === 'object') {
      if (raw.id) {
        tag = get('SELECT * FROM review_tags WHERE id = ?', [+raw.id]);
        if (!tag) throw new AppError('TAG_NOT_FOUND', '标签不存在', 400);
        if (tag.status === 'blocked') throw new AppError('TAG_BLOCKED', '该标签已被屏蔽', 400);
      } else if (raw.name) {
        wantedName = sanitizeTagName(raw.name);
      }
    }

    if (!tag && wantedName) {
      if ([...wantedName].length < 2) throw new AppError('TAG_TOO_SHORT', '自定义标签至少 2 个字', 400);
      tag = findTagByName(wantedName, product.category);
      if (tag?.status === 'blocked') throw new AppError('TAG_BLOCKED', '该标签已被屏蔽', 400);
      if (!tag) {
        custom += 1;
        if (custom > TAG_LIMITS.maxCustom) {
          throw new AppError('TAG_CUSTOM_LIMIT', `最多自定义 ${TAG_LIMITS.maxCustom} 个标签`, 400);
        }
        tag = createCustomTag(wantedName, product.category, userId);
      }
    }

    if (!tag) continue;
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    picked.push({
      id: tag.id,
      name: tag.name,
      dimension: tag.dimension,
      polarity: tag.polarity,
      source: tag.source,
      status: tag.status,
    });
  }
  return picked;
}

/** 评价插入后写关联表（多维度标签只记主维度，按维度筛选保持准确） */
export function linkTags(reviewId, tags) {
  for (const t of tags) {
    const primary = String(t.dimension || 'custom').split(',')[0] || 'custom';
    run(
      `INSERT OR IGNORE INTO review_tag_links (review_id, tag_id, dimension) VALUES (?,?,?)`,
      [+reviewId, t.id, primary],
    );
  }
}

/**
 * 批量取标签，避免评价列表 N+1。
 * 屏蔽的标签不展示（词库治理后历史评价不该继续带违规词）。
 */
export function tagsForReviews(reviewIds) {
  const ids = [...new Set((reviewIds || []).map(Number).filter((x) => x > 0))];
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const rows = all(
    `SELECT l.review_id, t.id, t.name, t.dimension, t.polarity
       FROM review_tag_links l JOIN review_tags t ON t.id = l.tag_id
      WHERE l.review_id IN (${ids.map(() => '?').join(',')}) AND t.status != 'blocked'
      ORDER BY t.sort, t.id`,
    ids,
  );
  for (const r of rows) {
    map.get(r.review_id)?.push({
      id: r.id,
      name: r.name,
      dimension: r.dimension,
      dimensionLabel: dimensionLabel(r.dimension),
      polarity: r.polarity,
    });
  }
  return map;
}

/** 分项评分只接受本品类定义过的维度，值 1–5；空对象表示不评 */
export function normalizeDimensions(category, input) {
  const allowed = new Set(dimensionsFor(category).map((d) => d.key));
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input)) {
    if (!allowed.has(k)) continue;
    const n = Math.round(Number(v));
    if (!(n >= 1 && n <= 5)) continue;
    out[k] = n;
  }
  return out;
}

// ── 后台词库管理 ──────────────────────────────────────────

const TAG_STATUS = ['active', 'pending', 'blocked'];
const POLARITY = ['good', 'bad', 'neutral'];

/** 维度多值校验：官方维度直接过；自建维度 2–8 字（后台可自行维护词表） */
function assertDimensionList(tokens) {
  if (!tokens.length) throw new AppError('BAD_DIMENSION', '请至少选择一个归属维度', 400);
  for (const t of tokens) {
    if (DIMENSIONS[t]) continue;
    const n = [...t].length;
    if (n < 2 || n > 8) throw new AppError('BAD_DIMENSION', `维度「${t}」需为 2–8 个字`, 400);
  }
}

export function adminListTags({ page = 1, pageSize = 20, q = '', status = '', dimension = '', category = null } = {}) {
  const where = [];
  const params = [];
  if (q) { where.push('t.name LIKE ?'); params.push(`%${q}%`); }
  if (status) { where.push('t.status = ?'); params.push(status); }
  // 多值字段（逗号分隔）：用「,值,」LIKE 匹配任意一个 token
  if (dimension) {
    where.push(`(${normTokens(dimension).map(() => `',' || t.dimension || ',' LIKE ?`).join(' OR ')})`);
    for (const t of normTokens(dimension)) params.push(`%,${t},%`);
  }
  // null/undefined = 不筛类目；空串 = 只看全类目通用词；具体值 = 命中该类目（多值 LIKE）
  if (category !== null && category !== undefined) {
    if (category === '') where.push("t.category = ''");
    else { where.push(catMatch('t.category')); params.push(category); }
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = get(`SELECT COUNT(*) c FROM review_tags t ${w}`, params).c;
  const counts = {
    all: get('SELECT COUNT(*) c FROM review_tags').c,
    active: get("SELECT COUNT(*) c FROM review_tags WHERE status = 'active'").c,
    pending: get("SELECT COUNT(*) c FROM review_tags WHERE status = 'pending'").c,
    blocked: get("SELECT COUNT(*) c FROM review_tags WHERE status = 'blocked'").c,
    used: get('SELECT COUNT(DISTINCT tag_id) c FROM review_tag_links').c,
  };
  const items = all(
    `SELECT t.*, (SELECT COUNT(*) FROM review_tag_links l WHERE l.tag_id = t.id) AS use_count
       FROM review_tags t ${w}
      ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, t.dimension, t.sort, t.id
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  ).map((t) => ({
    id: t.id,
    name: t.name,
    dimension: t.dimension,
    dimensionLabel: String(t.dimension).split(',').filter(Boolean).map(dimensionLabel).join(' / '),
    polarity: t.polarity,
    category: t.category,
    source: t.source,
    status: t.status,
    sort: t.sort,
    useCount: t.use_count,
    createdAt: t.created_at,
  }));
  return { items, total, page, pageSize, counts };
}

export function createTag(input = {}) {
  const dimTokens = normTokens(input.dimensions ?? input.dimension ?? 'appearance', { maxLen: 8 });
  const catTokens = normTokens(input.categories ?? input.category ?? '', { maxLen: 20 });
  const clean = sanitizeTagName(input.name);
  if ([...clean].length < 2) throw new AppError('TAG_TOO_SHORT', '标签至少 2 个字', 400);
  assertDimensionList(dimTokens);
  const dimension = dimTokens.join(',');
  const category = catTokens.join(',');
  const polarity = input.polarity || 'good';
  const status = input.status || 'active';
  if (!POLARITY.includes(polarity)) throw new AppError('BAD_POLARITY', '褒贬取值不合法', 400);
  if (!TAG_STATUS.includes(status)) throw new AppError('BAD_STATUS', '状态不合法', 400);
  if (get('SELECT id FROM review_tags WHERE name = ? AND dimension = ? AND category = ?', [clean, dimension, category])) {
    throw new AppError('TAG_EXISTS', '同维度下已有同名标签', 409);
  }
  const { lastId } = run(
    `INSERT INTO review_tags (name, dimension, polarity, category, source, status, sort)
     VALUES (?,?,?,?, 'official', ?, ?)`,
    [clean, dimension, polarity, category, status, Number(input.sort) || 0],
  );
  return {
    id: lastId,
    name: clean,
    dimension,
    dimensionLabel: dimTokens.map(dimensionLabel).join(' / '),
    polarity,
    category,
    source: 'official',
    status,
    sort: Number(input.sort) || 0,
    useCount: 0,
  };
}

export function updateTag(id, patch = {}) {
  const tag = get('SELECT * FROM review_tags WHERE id = ?', [+id]);
  if (!tag) throw new AppError('NOT_FOUND', '标签不存在', 404);

  const dimTokens = normTokens(patch.dimensions ?? patch.dimension ?? tag.dimension, { maxLen: 8 });
  const catTokens = normTokens(patch.categories ?? patch.category ?? tag.category, { maxLen: 20 });
  const next = {
    name: patch.name !== undefined ? sanitizeTagName(patch.name) : tag.name,
    dimension: dimTokens.join(','),
    polarity: patch.polarity !== undefined ? patch.polarity : tag.polarity,
    category: catTokens.join(','),
    status: patch.status !== undefined ? patch.status : tag.status,
    sort: patch.sort !== undefined ? Number(patch.sort) || 0 : tag.sort,
  };
  if ([...next.name].length < 2) throw new AppError('TAG_TOO_SHORT', '标签至少 2 个字', 400);
  assertDimensionList(dimTokens);
  if (!POLARITY.includes(next.polarity)) throw new AppError('BAD_POLARITY', '褒贬取值不合法', 400);
  if (!TAG_STATUS.includes(next.status)) throw new AppError('BAD_STATUS', '状态不合法', 400);
  const dup = get(
    'SELECT id FROM review_tags WHERE name = ? AND dimension = ? AND category = ? AND id != ?',
    [next.name, next.dimension, next.category, +id],
  );
  if (dup) throw new AppError('TAG_EXISTS', '同维度下已有同名标签', 409);

  run(
    `UPDATE review_tags SET name = ?, dimension = ?, polarity = ?, category = ?, status = ?, sort = ? WHERE id = ?`,
    [next.name, next.dimension, next.polarity, next.category, next.status, next.sort, +id],
  );
  // 维度冗余在校验表里，改名 / 改维度后同步（多维度存主维度，按维度筛选仍准确）
  run('UPDATE review_tag_links SET dimension = ? WHERE tag_id = ?', [dimTokens[0], +id]);
  return { ...tag, ...next, id: +id, dimensionLabel: dimTokens.map(dimensionLabel).join(' / ') };
}

/**
 * 删除：有评价引用就只做屏蔽，保留历史评价的语义；
 * 没有任何引用才物理删除，避免词库被误删后无法恢复关联。
 */
export function deleteTag(id) {
  const tag = get('SELECT * FROM review_tags WHERE id = ?', [+id]);
  if (!tag) throw new AppError('NOT_FOUND', '标签不存在', 404);
  const used = get('SELECT COUNT(*) c FROM review_tag_links WHERE tag_id = ?', [+id]).c;
  if (used > 0) {
    run("UPDATE review_tags SET status = 'blocked' WHERE id = ?", [+id]);
    return { deleted: false, blocked: true, used };
  }
  run('DELETE FROM review_tags WHERE id = ?', [+id]);
  return { deleted: true, blocked: false, used: 0 };
}

/** 合并同义标签：把来源标签的关联迁到目标标签，来源置为屏蔽 */
export function mergeTag(sourceId, targetId) {
  if (+sourceId === +targetId) throw new AppError('BAD_MERGE', '不能合并到自己', 400);
  const src = get('SELECT * FROM review_tags WHERE id = ?', [+sourceId]);
  const dst = get('SELECT * FROM review_tags WHERE id = ?', [+targetId]);
  if (!src || !dst) throw new AppError('NOT_FOUND', '标签不存在', 404);
  const links = all('SELECT review_id FROM review_tag_links WHERE tag_id = ?', [+sourceId]);
  const primaryDim = String(dst.dimension || '').split(',')[0] || 'custom';
  for (const l of links) {
    run('INSERT OR IGNORE INTO review_tag_links (review_id, tag_id, dimension) VALUES (?,?,?)',
      [l.review_id, dst.id, primaryDim]);
  }
  run('DELETE FROM review_tag_links WHERE tag_id = ?', [+sourceId]);
  run("UPDATE review_tags SET status = 'blocked' WHERE id = ?", [+sourceId]);
  return { merged: links.length, sourceId: +sourceId, targetId: +targetId };
}

/**
 * 演示数据：给种子评价挂上标签与分项评分，让商品页开箱就有"买家印象"。
 * 只在一条标签关联都没有时执行，重复启动不会叠加。
 */
export function attachDemoTags() {
  if (get('SELECT COUNT(*) c FROM review_tag_links').c > 0) return { attached: 0 };
  const reviews = all(
    `SELECT r.id, r.rating, r.product_id, p.category
       FROM reviews r JOIN products p ON p.id = r.product_id ORDER BY r.id`,
  );
  let attached = 0;
  for (const r of reviews) {
    const dims = dimensionsFor(r.category);
    const pool = all(
      `SELECT * FROM review_tags
        WHERE status = 'active' AND source = 'official' AND (category = '' OR category = ?)`,
      [r.category],
    );
    const good = r.rating >= 4;
    // 高星给 3 个维度打分并挂 2 个正向标签；低星给 2 个维度、1 正 1 负
    const dimCount = good ? 3 : 2;
    const pickedDims = dims.slice(0, dimCount);
    const values = {};
    for (const d of pickedDims) {
      values[d.key] = good ? (r.rating === 5 ? 5 : 4) : Math.max(1, r.rating);
    }
    run('UPDATE reviews SET dimensions = ? WHERE id = ?', [JSON.stringify(values), r.id]);
    attached += 1;

    const tagDims = pickedDims.slice(0, 2);
    const chosen = [];
    tagDims.forEach((d, i) => {
      const want = good || i === 0 ? 'good' : 'bad';
      const list = pool.filter((t) => t.dimension === d.key && t.polarity === want);
      if (list.length) chosen.push(list[r.id % list.length]);
    });
    if (!good) {
      const bad = pool.filter((t) => t.polarity === 'bad');
      if (bad.length) chosen.push(bad[r.id % bad.length]);
    }
    for (const t of chosen) {
      run('INSERT OR IGNORE INTO review_tag_links (review_id, tag_id, dimension) VALUES (?,?,?)',
        [r.id, t.id, t.dimension]);
    }
  }
  return { attached };
}
