/**
 * 评价域：买家晒单（图 / 短视频）、评分分布、商家回复、AI 评价摘要、图文返现
 *
 * 规则约束（对应验收标准第 5 条）：
 * - 只能评价自己的、已完成的订单对应的订单行；
 * - 一个订单行只能评一次（order_item_id 唯一索引兜底）。
 *
 * 返现规则（对齐拼多多"1 张图 + 15 字"的默认引导，但档位更清楚）：
 * - 基础：发评价即得 20 积分（无图也可）；
 * - 图文：文字 ≥ 15 字 + 图片 ≥ 1 张 → 返 ¥1.00 + 30 积分；
 * - 优质：文字 ≥ 50 字 + 图片 ≥ 3 张 → 返 ¥3.00 + 60 积分（与图文档不叠加，取高档）；
 * - 视频：视频 ≥ 1 段 + 文字 ≥ 15 字 → 额外返 ¥2.00 + 40 积分（可与上图档叠加）；
 * - 单条评价返现上限 ¥5.00。
 */
import { all, get, run, tx } from '../db/index.js';
import { AppError } from './users.js';
import { toIso } from '../lib/time.js';
import * as wallet from './wallet.js';
import {
  dimensionLabel, normalizeDimensions, resolveTags, linkTags, tagsForReviews, productTagStats,
} from './review-tags.js';

/** 评价返现规则：前端通过 GET /api/reviews/rules 拉取，保证与服务端同一份 */
export const REVIEW_REWARD_RULES = {
  basePoints: 20,
  tiers: [
    {
      key: 'silver', label: '图文评价', minChars: 15, minImages: 1,
      cashCents: 100, points: 30, tip: '1 张图 + 15 字',
    },
    {
      key: 'gold', label: '优质长图文', minChars: 50, minImages: 3,
      cashCents: 300, points: 60, tip: '3 张图 + 50 字',
    },
  ],
  video: { minChars: 15, cashCents: 200, points: 40, tip: '1 段视频 + 15 字' },
  maxCashCents: 500,
  maxImages: 9,
  maxVideoBytes: 60 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  defaultHint: '默认最低要求：1 张图 + 15 字，即可获得 ¥1.00 返现',
};

/** 字数统计：去掉首尾与连续空白，中文按 1 字、英文按 1 字符（与前端一致） */
export function countChars(content = '') {
  return String(content).replace(/\s+/g, ' ').trim().length;
}

/**
 * 纯函数：按内容算返现，预览与真实入账共用
 * @returns {{ chars, imageCount, hasVideo, tier, cashCents, points, next, missing, tips }}
 */
export function evaluateReward({ content = '', images = [], video = '' } = {}) {
  const chars = countChars(content);
  const imageCount = Array.isArray(images) ? images.length : 0;
  const hasVideo = !!video;
  const rules = REVIEW_REWARD_RULES;

  // 取满足条件的最高图文档
  let tier = null;
  for (const t of rules.tiers) {
    if (chars >= t.minChars && imageCount >= t.minImages) tier = t;
  }
  let cashCents = tier ? tier.cashCents : 0;
  let points = rules.basePoints + (tier ? tier.points : 0);
  let videoBonus = 0;
  if (hasVideo && chars >= rules.video.minChars) {
    videoBonus = rules.video.cashCents;
    cashCents += videoBonus;
    points += rules.video.points;
  }
  cashCents = Math.min(cashCents, rules.maxCashCents);

  // 距离"下一个还没拿到的档位"还差什么，直接驱动前端提示文案
  let next = null;
  for (const t of rules.tiers) {
    if (tier && rules.tiers.indexOf(t) <= rules.tiers.indexOf(tier)) continue;
    next = {
      tier: t.key,
      label: t.label,
      needChars: Math.max(0, t.minChars - chars),
      needImages: Math.max(0, t.minImages - imageCount),
      addCents: Math.max(0, t.cashCents - (tier ? tier.cashCents : 0)),
      tip: t.tip,
    };
    break;
  }
  if (!next && !hasVideo) {
    next = {
      tier: 'video',
      label: '带视频评价',
      needChars: Math.max(0, rules.video.minChars - chars),
      needImages: 0,
      addCents: rules.video.cashCents,
      tip: rules.video.tip,
      needVideo: true,
    };
  }

  const tips = [];
  if (cashCents === 0) {
    const t = rules.tiers[0];
    const lack = [];
    if (chars < t.minChars) lack.push(`再写 ${t.minChars - chars} 字`);
    if (imageCount < t.minImages) lack.push(`再传 ${t.minImages - imageCount} 张图`);
    tips.push(`${lack.join('、') || '补充图文'}即可获得 ¥${(t.cashCents / 100).toFixed(2)} 返现`);
  } else {
    tips.push(`当前可返 ¥${(cashCents / 100).toFixed(2)}${videoBonus ? `（含视频加码 ¥${(videoBonus / 100).toFixed(2)}）` : ''}`);
  }
  if (next && next.addCents > 0) {
    const lack = [];
    if (next.needChars) lack.push(`${next.needChars} 字`);
    if (next.needImages) lack.push(`${next.needImages} 张图`);
    if (next.needVideo) lack.push('1 段视频');
    if (lack.length) tips.push(`再加 ${lack.join(' + ')}，可多返 ¥${(next.addCents / 100).toFixed(2)}`);
  }

  return {
    chars,
    imageCount,
    hasVideo,
    tier: tier ? tier.key : (hasVideo ? 'video' : 'basic'),
    tierLabel: tier ? tier.label : (hasVideo ? '视频评价' : '基础评价'),
    cashCents,
    cash: +(cashCents / 100).toFixed(2),
    points,
    videoBonusCents: videoBonus,
    next,
    tips,
    maxed: cashCents >= rules.maxCashCents,
  };
}

/** 只接受本地上传或 https 地址，挡掉 javascript: / data: 之类的注入面 */
function sanitizeMedia(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const s = String(raw || '').trim();
    if (!s || s.length > 300) continue;
    if (!(s.startsWith('/api/uploads/') || /^https?:\/\//i.test(s))) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const maskName = (name = '') => {
  const s = String(name || '匿名用户');
  if (s.length <= 1) return s;
  return s[0] + '*'.repeat(Math.max(1, s.length - 1));
};

export function ratingBreakdown(productId) {
  const rows = all(
    'SELECT rating, COUNT(*) c FROM reviews WHERE product_id = ? GROUP BY rating',
    [+productId],
  );
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let total = 0;
  let sum = 0;
  for (const r of rows) {
    dist[r.rating] = r.c;
    total += r.c;
    sum += r.rating * r.c;
  }
  return {
    total,
    average: total ? +(sum / total).toFixed(1) : 0,
    goodRate: total ? +(((dist[5] + dist[4]) / total) * 100).toFixed(1) : 0,
    dist: [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: dist[star],
      percent: total ? Math.round((dist[star] / total) * 100) : 0,
    })),
  };
}

export function listReviews(productId, {
  page = 1, pageSize = 10, rating = 0, withImage = false, withMedia = false,
  tagId = 0, tag = '', dimension = '',
} = {}) {
  const where = ['r.product_id = ?'];
  const params = [+productId];
  if (rating) { where.push('r.rating = ?'); params.push(+rating); }
  if (withImage || withMedia) {
    where.push("((r.images != '[]' AND r.images != '') OR (r.video IS NOT NULL AND r.video != ''))");
  }
  // 标签筛选：标签云点哪个就传哪个 id；维度筛选用于"只看外观相关"
  if (tagId) {
    where.push('EXISTS (SELECT 1 FROM review_tag_links l WHERE l.review_id = r.id AND l.tag_id = ?)');
    params.push(+tagId);
  }
  if (tag) {
    where.push(`EXISTS (SELECT 1 FROM review_tag_links l JOIN review_tags t ON t.id = l.tag_id
                        WHERE l.review_id = r.id AND t.name = ?)`);
    params.push(String(tag));
  }
  if (dimension) {
    where.push('EXISTS (SELECT 1 FROM review_tag_links l WHERE l.review_id = r.id AND l.dimension = ?)');
    params.push(String(dimension));
  }

  const total = get(`SELECT COUNT(*) c FROM reviews r WHERE ${where.join(' AND ')}`, params).c;
  const rows = all(
    `SELECT r.*, u.name AS user_name FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  const tagMap = tagsForReviews(rows.map((r) => r.id));
  const items = rows.map((r) => {
    const images = safeJson(r.images);
    return {
      id: r.id,
      rating: r.rating,
      content: r.content,
      images,
      imageCount: images.length,
      video: r.video || '',
      videoCover: r.video_cover || '',
      chars: countChars(r.content),
      rewardCents: r.reward_cents || 0,
      tier: r.tier || 'basic',
      anonymous: !!r.anonymous,
      userName: r.anonymous ? '匿***' : maskName(r.user_name),
      reply: r.reply,
      useful: r.useful,
      dimensions: safeJsonObject(r.dimensions),
      tags: tagMap.get(r.id) || [],
      createdAt: toIso(r.created_at),
    };
  });
  return {
    items, total, page, pageSize,
    breakdown: ratingBreakdown(productId),
    summary: aiSummary(productId),
    // 标签云与筛选条件一起返回，前端翻页 / 换筛选时不用再拉一次
    tagStats: productTagStats(productId),
  };
}

function safeJsonObject(s) {
  try {
    const o = JSON.parse(s || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

function safeJson(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

/**
 * AI 评价摘要：把几十条评价压成"好在哪、差在哪、适合谁"
 * 本地规则实现（无模型也能跑）；有模型时可由上层替换为 LLM 版本。
 */
export function aiSummary(productId) {
  const rows = all('SELECT rating, content FROM reviews WHERE product_id = ? ORDER BY id DESC LIMIT 200', [+productId]);
  if (!rows.length) return null;

  const GOOD = ['满意', '好用', '不错', '推荐', '舒服', '值', '喜欢', '清晰', '稳定', '快', '省心', '质感', '准确', '够用'];
  const BAD = ['但是', '就是', '可惜', '缺点', '一般', '失望', '偏', '有点', '不足', '太', '不够', '重', '贵'];
  const pros = [];
  const cons = [];
  const seen = new Set();

  for (const r of rows) {
    const sentences = String(r.content || '').split(/[。！？；!?;]/).filter((s) => s.trim().length >= 4);
    for (const s of sentences) {
      const t = s.trim();
      if (t.length > 40) continue;
      const isBad = BAD.some((w) => t.includes(w)) && r.rating <= 4;
      const isGood = r.rating >= 4 && GOOD.some((w) => t.includes(w)) && !isBad;
      const key = t.slice(0, 8);
      if (seen.has(key)) continue;
      if (isBad && cons.length < 3) { cons.push(t); seen.add(key); }
      else if (isGood && pros.length < 3) { pros.push(t); seen.add(key); }
    }
  }

  const b = ratingBreakdown(productId);
  const goodRate = b.goodRate;
  return {
    total: b.total,
    average: b.average,
    verdict: goodRate >= 90 ? '口碑很好，绝大多数买家认可'
      : goodRate >= 75 ? '整体正面，少数细节被提到'
        : '评价分化，建议先看差评再决定',
    pros,
    cons,
    // 一句话结论，直接渲染在商品页顶部
    oneLine: pros.length
      ? `买家最认可：${pros.slice(0, 2).join('；')}。${cons.length ? `被提到的问题：${cons[0]}。` : ''}`
      : `共 ${b.total} 条评价，好评率 ${goodRate}%。`,
  };
}

export function createReview(userId, {
  orderId, orderItemId, rating, content = '', images = [], video = '', videoCover = '', anonymous = false,
  dimensions = {}, tags = [],
}) {
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) throw new AppError('INVALID_RATING', '评分需在 1–5 之间', 400);

  const text = String(content || '').slice(0, 1000);
  const pics = sanitizeMedia(images, REVIEW_REWARD_RULES.maxImages);
  const videoUrl = sanitizeMedia([video], 1)[0] || '';
  const coverUrl = sanitizeMedia([videoCover], 1)[0] || '';

  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [+orderId, userId]);
    if (!o) throw new AppError('NOT_FOUND', '订单不存在', 404);
    if (o.status !== 'completed') throw new AppError('BAD_STATUS', '订单完成后才能评价', 400);
    if (o.reviewed) throw new AppError('ALREADY_REVIEWED', '该订单已评价', 400);

    const item = orderItemId
      ? get('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [+orderItemId, +orderId])
      : get('SELECT * FROM order_items WHERE order_id = ? LIMIT 1', [+orderId]);
    if (!item) throw new AppError('NOT_FOUND', '订单商品不存在', 404);
    if (get('SELECT id FROM reviews WHERE order_item_id = ?', [item.id])) {
      throw new AppError('ALREADY_REVIEWED', '该商品已评价', 400);
    }

    const product = get('SELECT id, title, category FROM products WHERE id = ?', [item.product_id]);
    if (!product) throw new AppError('NOT_FOUND', '商品不存在', 404);

    // 分项评分与标签都只认服务端规则：维度必须在同类目白名单里，标签必须是词库里的
    const dims = normalizeDimensions(product.category, dimensions);
    const pickedTags = resolveTags(product, tags, userId);

    // 服务端重算返现，不接受前端传来的金额
    const reward = evaluateReward({ content: text, images: pics, video: videoUrl });

    const { lastId } = run(
      `INSERT INTO reviews (order_id, order_item_id, user_id, product_id, rating, content, images,
                            video, video_cover, anonymous, reward_cents, reward_points, tier, dimensions)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [+orderId, item.id, userId, item.product_id, r, text,
        JSON.stringify(pics), videoUrl, coverUrl, anonymous ? 1 : 0,
        reward.cashCents, reward.points, reward.tier, JSON.stringify(dims)],
    );
    linkTags(lastId, pickedTags);

    // 重算商品均分，并同步订单已评标记
    const s = get('SELECT AVG(rating) a FROM reviews WHERE product_id = ?', [item.product_id]);
    run('UPDATE products SET rating = ? WHERE id = ?', [+(s.a || 5).toFixed(1), item.product_id]);
    const left = get('SELECT COUNT(*) c FROM order_items WHERE order_id = ?', [+orderId]).c;
    const done = get('SELECT COUNT(*) c FROM reviews WHERE order_id = ?', [+orderId]).c;
    if (done >= left) run('UPDATE orders SET reviewed = 1 WHERE id = ?', [+orderId]);

    // 积分奖励（基础 + 图文/视频加码）
    run('UPDATE users SET points = points + ? WHERE id = ?', [reward.points, userId]);
    run("INSERT INTO points_log (user_id, delta, reason, ref_id) VALUES (?,?,'发表评价奖励',?)",
      [userId, reward.points, +orderId]);

    // 返现进余额，可直接在下一单抵扣
    const balanceCents = reward.cashCents > 0
      ? wallet.credit(userId, reward.cashCents, '评价返现', { refType: 'review', refId: lastId })
      : wallet.balanceOf(userId);

    return {
      id: lastId,
      // 兼容旧前端字段（原固定 20 积分）
      pointsEarned: reward.points,
      dimensions: dims,
      tags: pickedTags.map((t) => ({
        id: t.id, name: t.name, dimension: t.dimension,
        dimensionLabel: dimensionLabel(t.dimension),
        polarity: t.polarity, pending: t.status === 'pending',
      })),
      reward: {
        ...reward,
        balanceCents,
        balance: +(balanceCents / 100).toFixed(2),
        message: reward.cashCents > 0
          ? `评价成功，返现 ¥${reward.cash.toFixed(2)} 已到账，另得 ${reward.points} 积分`
          : `评价成功，获得 ${reward.points} 积分`,
      },
    };
  });
}

/**
 * 退款通过时扣回该订单的评价返现与评价积分。
 *
 * 不这么做就存在"评价拿返现 → 申请退款"的套利路径。
 * 余额可能已经被花掉，只扣到当前余额为 0，不制造负余额；
 * 幂等：同一订单只扣一次（以 wallet_log 为准）。
 */
export function clawbackByOrder(orderId) {
  const already = get(
    "SELECT id FROM wallet_log WHERE ref_type = 'order' AND ref_id = ? AND reason = '退款扣回评价返现' LIMIT 1",
    [+orderId],
  );
  if (already) return { cashCents: 0, points: 0, skipped: true };

  const rows = all('SELECT user_id, reward_cents, reward_points FROM reviews WHERE order_id = ?', [+orderId]);
  if (!rows.length) return { cashCents: 0, points: 0 };

  const userId = rows[0].user_id;
  const cash = rows.reduce((s, r) => s + (r.reward_cents || 0), 0);
  const points = rows.reduce((s, r) => s + (r.reward_points || 0), 0);

  let cashBack = 0;
  if (cash > 0) {
    cashBack = Math.min(wallet.balanceOf(userId), cash);
    if (cashBack > 0) {
      wallet.debit(userId, cashBack, '退款扣回评价返现', { refType: 'order', refId: +orderId });
    }
  }
  let pointsBack = 0;
  if (points > 0) {
    const u = get('SELECT points FROM users WHERE id = ?', [userId]);
    pointsBack = Math.min(Number(u?.points) || 0, points);
    if (pointsBack > 0) {
      run('UPDATE users SET points = MAX(0, points - ?) WHERE id = ?', [pointsBack, userId]);
      run("INSERT INTO points_log (user_id, delta, reason, ref_id) VALUES (?,?,'退款扣回评价积分',?)",
        [userId, -pointsBack, +orderId]);
    }
  }
  return { cashCents: cashBack, points: pointsBack, shortfallCents: cash - cashBack };
}

export function replyReview(reviewId, reply) {  const r = get('SELECT id FROM reviews WHERE id = ?', [+reviewId]);
  if (!r) throw new AppError('NOT_FOUND', '评价不存在', 404);
  run('UPDATE reviews SET reply = ? WHERE id = ?', [String(reply).slice(0, 500), +reviewId]);
  return { replied: true };
}

export function markUseful(reviewId) {
  const r = get('SELECT useful FROM reviews WHERE id = ?', [+reviewId]);
  if (!r) throw new AppError('NOT_FOUND', '评价不存在', 404);
  run('UPDATE reviews SET useful = useful + 1 WHERE id = ?', [+reviewId]);
  // 返回累加后的数量，前端才能立刻把"有用 12"变成 13
  return { useful: (r.useful || 0) + 1 };
}

/** 后台：评价列表（可按商品/星级/标签筛选） */
export function adminListReviews({ page = 1, pageSize = 20, rating = 0, q = '', tagId = 0, dimension = '', category = '' } = {}) {
  const where = [];
  const params = [];
  if (rating) { where.push('r.rating = ?'); params.push(+rating); }
  if (q) { where.push('p.title LIKE ?'); params.push(`%${q}%`); }
  if (category) { where.push('p.category = ?'); params.push(category); }
  if (tagId) {
    where.push('EXISTS (SELECT 1 FROM review_tag_links l WHERE l.review_id = r.id AND l.tag_id = ?)');
    params.push(+tagId);
  }
  if (dimension) {
    where.push('EXISTS (SELECT 1 FROM review_tag_links l WHERE l.review_id = r.id AND l.dimension = ?)');
    params.push(dimension);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) c FROM reviews r JOIN products p ON p.id = r.product_id ${w}`, params).c;
  const rows = all(
    `SELECT r.*, p.title AS product_title, u.name AS user_name
       FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id
       ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  const tagMap = tagsForReviews(rows.map((r) => r.id));
  const items = rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productTitle: r.product_title,
    userName: maskName(r.user_name),
    rating: r.rating,
    content: r.content,
    images: safeJson(r.images),
    video: r.video || '',
    chars: countChars(r.content),
    rewardCents: r.reward_cents || 0,
    tier: r.tier || 'basic',
    dimensions: safeJsonObject(r.dimensions),
    tags: tagMap.get(r.id) || [],
    reply: r.reply,
    useful: r.useful,
    createdAt: toIso(r.created_at),
  }));
  return { items, total, page, pageSize };
}

export function reviewOfOrder(userId, orderId) {
  const rows = all(
    `SELECT r.*, oi.title FROM reviews r JOIN order_items oi ON oi.id = r.order_item_id
      WHERE r.order_id = ? AND r.user_id = ?`,
    [+orderId, userId],
  );
  const tagMap = tagsForReviews(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    orderItemId: r.order_item_id,
    productId: r.product_id,
    title: r.title,
    rating: r.rating,
    content: r.content,
    images: safeJson(r.images),
    video: r.video || '',
    dimensions: safeJsonObject(r.dimensions),
    tags: tagMap.get(r.id) || [],
    rewardCents: r.reward_cents || 0,
    tier: r.tier || 'basic',
  }));
}
