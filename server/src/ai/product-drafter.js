/**
 * 商品信息智能起草器
 * 输入：一句话描述（必填）+ 可选图片文件名/已有部分字段
 * 输出：完整商品字段草稿（标题/副标题/描述/价格/划线价/库存/分类/标签/图标）
 * - 配置了远端模型时走 chat() 生成 JSON
 * - 否则用本地规则起草（关键词 → 分类/卖点/图标，价格从文本中抽取），可按 seed 换一版
 */
import { chat, gatewayConfig, AIUnavailable } from './gateway.js';

const CATEGORY_RULES = [
  { key: '数码', icon: '🎧', kws: ['耳机', '手机', '电脑', '键盘', '鼠标', '音箱', '充电', '蓝牙', '屏幕', '平板', '手表', '摄像', '投影', '路由', '存储', 'u盘', '数码'] },
  { key: '家居', icon: '🏠', kws: ['台灯', '沙发布', '收纳', '床上', '枕头', '被子', '窗帘', '香薰', '花瓶', '摆件', '桌', '椅', '灯', '家居', '风扇', '加湿'] },
  { key: '服饰', icon: '👕', kws: ['卫衣', 't恤', '衬衫', '裤子', '鞋', '袜', '外套', '羽绒服', '裙', '帽', '包', '围巾', '服饰', '穿'] },
  { key: '美妆', icon: '💄', kws: ['口红', '粉底', '面膜', '精华', '护肤', '乳液', '防晒', '香水', '眼影', '美妆', '妆'] },
  { key: '个护', icon: '🧴', kws: ['洗发', '沐浴', '牙膏', '牙刷', '身体乳', '护手', '剃须', '个护', '洗'] },
  { key: '食品', icon: '🍜', kws: ['咖啡', '茶', '零食', '麦片', '面', '米', '油', '坚果', '饼干', '糖', '食品', '吃', '早餐', '饮料'] },
];

const TAG_POOL = {
  数码: ['降噪', '长续航', '轻便', '快充', '高清', '便携'],
  家居: ['护眼', '静音', '简约', '易清洁', '大容量', '温馨'],
  服饰: ['宽松', '百搭', '透气', '保暖', '基础款', '亲肤'],
  美妆: ['保湿', '持妆', '温和', '提亮', '敏感肌可用'],
  个护: ['清爽', '温和', '留香', '滋润'],
  食品: ['低糖', '0添加', '独立包装', '提神', '新鲜'],
  其他: ['高性价比', '实用', '口碑好'],
};

const SUBTITLE_TPL = [
  (t) => `${t.tagA} · ${t.tagB}，${t.crowd}的首选`,
  (t) => `${t.crowd}都在回购：${t.tagA}又${t.tagB}`,
  (t) => `${t.tagA}体验，${t.tagB}不将就`,
  (t) => `${t.useScene}神器：${t.tagA}，${t.tagB}`,
];
const CROWD = ['学生党', '上班族', '注重品质的你', '居家达人', '送礼人群'];
const SCENE = ['日常通勤', '居家生活', '办公室', '周末出行', '深夜加班'];

/** 抽取价格：¥199 / 199 元 / 价格 199 / 199.9 */
function pickPrice(text) {
  const m = String(text).match(/(?:¥|￥|价格\s*)?(\d{1,5}(?:\.\d{1,2})?)\s*(?:元|块|块钱)/) || String(text).match(/[¥￥]\s*(\d{1,5}(?:\.\d{1,2})?)/);
  return m ? Math.max(1, Number(m[1])) : null;
}

function pickCategory(text) {
  const t = String(text).toLowerCase();
  for (const r of CATEGORY_RULES) if (r.kws.some((k) => t.includes(k))) return { key: r.key, icon: r.icon };
  return { key: '其他', icon: '📦' };
}

/** 提炼核心词：去掉价格/量词等噪音，取前 12 字作为品名主干 */
function coreName(text) {
  const t = String(text)
    .replace(/[，。！？、,.!?]/g, ' ')
    .replace(/(?:¥|￥)?\d{1,5}(?:\.\d{1,2})?\s*(?:元|块|块钱)?/g, ' ')
    .replace(/一个|一件|一款|这个|帮我|新增|上架|想上|发布|商品|产品/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.split(' ').filter(Boolean).slice(0, 3).join(' ') || '新品好物';
}

function localDraft({ hint, seed = 0, partial = {} }) {
  const text = String(hint || '').trim();
  if (!text) throw new Error('缺少商品描述');
  const cat = partial.category ? { key: partial.category, icon: '📦' } : pickCategory(text);
  const pool = TAG_POOL[cat.key] || TAG_POOL.其他;
  const rot = (i) => pool[(i + seed) % pool.length];
  const tags = [rot(0), rot(1), rot(2)].filter((v, i, a) => a.indexOf(v) === i);
  const name = partial.title || coreName(text);
  const price = partial.price || pickPrice(text) || [59, 79, 99, 129, 159, 199][(seed + name.length) % 6];
  const tpl = SUBTITLE_TPL[(seed + name.length) % SUBTITLE_TPL.length];
  const subtitle = partial.subtitle || tpl({
    tagA: tags[0], tagB: tags[1] || '有质感',
    crowd: CROWD[(seed + name.length) % CROWD.length],
    useScene: SCENE[(seed + name.length) % SCENE.length],
  });
  const description = partial.description || [
    `${name}，主打「${tags.join('、')}」。`,
    `从选材到工艺都按 ${cat.key} 类目的标准来，${tags[0]}表现稳定，日常使用场景都能覆盖。`,
    `到手即可使用，包装完整，支持七天无理由退换。已上架库存 ${100 + ((seed * 37 + name.length * 13) % 400)} 件，欢迎体验。`,
  ].join('\n');
  return {
    title: name.length >= 4 ? name : `${name}（${tags[0]}款）`,
    subtitle,
    description,
    price,
    compareAt: Math.round(price * 1.25),
    stock: partial.stock || 100 + ((seed * 37 + name.length * 13) % 400),
    category: cat.key,
    tags,
    image: cat.icon,
    source: 'local',
  };
}

async function modelDraft({ hint, partial = {} }) {
  const sys = '你是电商商品上架助手。根据用户的商品描述与图片线索，输出一个 JSON 对象（不要输出任何其他文字）表示商品草稿，字段：title(≤20字), subtitle(≤24字卖点), description(80-150字，含卖点/材质/场景/售后), price(数字，元), compareAt(划线价，数字), stock(数字), category(从 数码/家居/服饰/美妆/个护/食品/其他 中选), tags(3-5个词的数组), image(一个贴合品类的 emoji 图标)。';
  const user = [
    hint ? `商品描述：${hint}` : '',
    partial.imageHint ? `图片线索：${partial.imageHint}` : '',
    partial.title ? `已定标题：${partial.title}` : '',
    partial.category ? `已定分类：${partial.category}` : '',
  ].filter(Boolean).join('\n');
  const resp = await chat({
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user || '请给一个通用的优质商品示例' },
    ],
    temperature: 0.8,
  });
  const m = resp.content.match(/\{[\s\S]*\}/);
  if (!m) throw new AIUnavailable('模型未返回 JSON');
  const d = JSON.parse(m[0]);
  return {
    title: String(d.title || '').slice(0, 40) || '新品好物',
    subtitle: String(d.subtitle || '').slice(0, 60),
    description: String(d.description || '').slice(0, 1000),
    price: Math.max(0.01, Number(d.price) || 0),
    compareAt: Number(d.compareAt) || Math.round((Number(d.price) || 100) * 1.25),
    stock: Math.max(0, Number(d.stock) || 100),
    category: CATEGORY_RULES.some((c) => c.key === d.category) ? d.category : '其他',
    tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t).slice(0, 8)).filter(Boolean).slice(0, 5) : [],
    image: String(d.image || '📦').slice(0, 4),
    source: 'model',
  };
}

export async function draftProduct({ hint, seed = 0, partial = {} }) {
  const cfg = gatewayConfig();
  if (cfg.enabled) {
    try {
      return await modelDraft({ hint, partial });
    } catch (e) {
      if (!(e instanceof AIUnavailable)) throw e;
      // 模型失败降级本地
    }
  }
  return localDraft({ hint, seed, partial });
}
