/**
 * 商品检索：共享给 C 端列表搜索与 AI 工具调用。
 *
 * 设计取舍：
 * - 不用向量库，用「中文 2-gram + 字段加权 + 理由归因」的实现
 * - 关键不在打分精度，而在**可解释**：每条结果必须能说出"为什么是它"
 *   这正是用户反馈里"搜索结果不可解释"的痛点解法
 */

const STOP = new Set(['想', '买', '个', '的', '了', '要', '我', '你', '他', '她', '请', '帮', '找', '有', '没', '吗',
  '呢', '吧', '啊', '和', '与', '就', '是', '在', '这', '那', '一个', '一些', '什么', '怎么', '可以', '能',
  '想买', '要不', '多少', '推荐', '一款', '一件', '以内', '以下', '左右', '便宜', '好']);

/** 中文无空格分词：按标点切分后对长串做 2-gram 展开 + 停用词剔除 */
export function tokenize(query) {
  const raw = String(query || '').toLowerCase().split(/[\s,，。、！？!?;；:：]+/).filter(Boolean);
  const out = new Set();
  for (const chunk of raw) {
    out.add(chunk);
    if (/[\u4e00-\u9fa5]/.test(chunk)) {
      for (let i = 0; i < chunk.length - 1; i += 1) out.add(chunk.slice(i, i + 2));
      if (chunk.length > 1) out.add(chunk.slice(-2));
    }
  }
  return [...out].filter((w) => w.length >= 1 && !STOP.has(w));
}

/** 从查询里抽取价格意图：500 以内 / 200 元以下 */
export function parseBudget(query) {
  const m = String(query || '').match(/(\d{2,6})\s*(元|块|rmb)?\s*(以内|以下|左右)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  // 仅当带价格单位或"以内/以下"才视为预算，避免把型号数字误判
  if (!m[2] && !m[3]) return null;
  return n * 100;
}

/**
 * 理由归因：把命中点翻译成用户能读的一句话
 * 返回 [{ field, word, text }]
 */
function explainMatch(p, words, budgetCents) {
  const title = p.title.toLowerCase();
  const tags = (p.tags || '').toLowerCase();
  const cat = (p.category || '').toLowerCase();
  const desc = `${p.subtitle || ''} ${p.description || ''}`.toLowerCase();

  const reasons = [];
  const titleHits = [];
  const tagHits = [];
  const descHits = [];

  for (const w of words) {
    if (w.length < 2) continue;
    if (title.includes(w)) titleHits.push(w);
    else if (tags.includes(w)) tagHits.push(w);
    else if (desc.includes(w)) descHits.push(w);
  }

  const uniq = (arr) => [...new Set(arr)];
  const t = uniq(titleHits).slice(0, 2);
  const g = uniq(tagHits).slice(0, 2);
  const d = uniq(descHits).slice(0, 1);

  if (t.length) reasons.push({ field: 'title', words: t, text: `标题命中「${t.join('、')}」` });
  if (g.length) reasons.push({ field: 'tags', words: g, text: `标签匹配「${g.join('、')}」` });
  if (cat && words.some((w) => w.length >= 2 && cat.includes(w))) {
    reasons.push({ field: 'category', words: [p.category], text: `属于「${p.category}」类目` });
  }
  if (d.length) reasons.push({ field: 'desc', words: d, text: `描述提及「${d.join('、')}」` });
  if (budgetCents) {
    reasons.push({
      field: 'price',
      words: [],
      text: p.price_cents <= budgetCents
        ? `价格 ¥${(p.price_cents / 100).toFixed(0)} 在你的预算内`
        : `价格 ¥${(p.price_cents / 100).toFixed(0)} 略超预算`,
    });
  }
  return reasons;
}

/**
 * 语义检索（可解释版）
 * @returns {{ items: Array, total: number, suggestions: string[] , relaxed: boolean}}
 */
export function searchProducts(rows, query, { limit = 20, budgetCents = null } = {}) {
  const words = tokenize(query);
  const budget = budgetCents ?? parseBudget(query);
  const q = String(query || '').trim();

  const scored = rows.map((p) => {
    const title = String(p.title || '').toLowerCase();
    const tags = String(p.tags || '').toLowerCase();
    const desc = `${p.subtitle || ''} ${p.description || ''} ${p.category || ''}`.toLowerCase();

    let score = 0;
    let hitCount = 0;
    for (const w of words) {
      let hit = 0;
      if (title.includes(w)) { score += 3; hit = 1; }
      if (tags.includes(w)) { score += 2; hit = 1; }
      if (desc.includes(w)) { score += 1; hit = 1; }
      if (hit) hitCount += 1;
    }
    // 整串精确命中给额外权重，避免被 2-gram 稀释
    if (q.length >= 2 && title.includes(q.toLowerCase())) score += 4;
    if (budget) score += p.price_cents <= budget ? 1.5 : -2;
    score += (p.rating || 0) * 0.1;

    return { p, score, hitCount };
  }).filter((x) => x.score > 0.5);

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  const items = top.map(({ p, score, hitCount }) => ({
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    price: +(p.price_cents / 100).toFixed(2),
    priceCents: p.price_cents,
    compareAt: p.compare_at_cents ? +(p.compare_at_cents / 100).toFixed(2) : null,
    category: p.category,
    tags: p.tags ? String(p.tags).split(',').filter(Boolean) : [],
    image: p.image,
    stock: p.stock,
    rating: p.rating,
    sales: p.sales,
    matchScore: Math.round(score * 10) / 10,
    hitCount,
    matchReasons: explainMatch(p, words, budget),
  }));

  // 零结果兜底：给出可点击的放宽建议
  const suggestions = [];
  if (!items.length) {
    if (budget) suggestions.push('去掉价格限制，看看同类里更贵的选择');
    if (q.length > 2) suggestions.push(`把「${q}」换成更短的关键词试试`);
    suggestions.push('浏览全部商品，或直接问 AI 导购');
  }

  return { items, total: items.length, suggestions, relaxed: false, words };
}

/** 判断搜索结果是否需要"放宽"再给一批（给前端一个稳定的兜底入口） */
export function fallbackSuggestions(query) {
  const q = String(query || '').trim();
  const out = [];
  if (q) out.push(`放宽「${q}」的价格或品类条件`);
  out.push('按销量看热卖商品');
  out.push('让 AI 导购帮你挑');
  return out;
}
