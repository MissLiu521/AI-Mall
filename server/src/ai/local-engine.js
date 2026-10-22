/**
 * 本地降级引擎（无 LLM 场景）
 * 策略：意图分类 → 选工具 → 用真实数据套模板
 * 目的不是"假装 AI"，而是保证无 Key 时全链路仍可验证：工具调用真实、数据真实、操作真实落库。
 */

const INTENTS = [
  // ── 运营智能体：越具体的意图越靠前，避免"写文案"被"数据"抢走 ──
  { name: 'ops_copy', re: /文案|卖点|标题|描述|详情|写一段|帮我写|改写|润色/, scene: ['ops'] },
  { name: 'ops_price', re: /调价|定价|降价|涨价|改价|价格策略|怎么定价|定多少|划线价/, scene: ['ops'] },
  { name: 'ops_promo', re: /促销|活动|营销|推广|拉新|大促|运营方案|引流|转化|复购|怎么卖|没人买|怎么办/, scene: ['ops'] },
  { name: 'ops_review', re: /评价|差评|口碑|评分|回复评|买家秀|好评率/, scene: ['ops'] },
  { name: 'ops_stock', re: /库存|补货|进货|断货|缺货|备货/, scene: ['ops'] },
  { name: 'ops_data', re: /成交|营业额|GMV|gmv|销售额|单量|卖得怎么样|卖得如何|经营|数据|分析|概况|概览|表现|最近卖|生意|店铺情况/, scene: ['ops'] },
  { name: 'ops_insight', re: /滞销|卖不动|爆款|热卖|销量|排行/, scene: ['ops'] },
  // ── 全场景通用 ──
  { name: 'capability', re: /你会(什么|干嘛|做啥)|能(做什么|干嘛|做啥)|有什么功能|怎么用你|你能帮|可以帮你|介绍下你|你是谁/, scene: ['support', 'shopping', 'ops'] },
  { name: 'thanks', re: /^(好的|收到|谢谢你?|感谢|辛苦了|不错|很好|点赞|棒)[!！。~\s]*$/, scene: ['support', 'shopping', 'ops'] },
  { name: 'bye', re: /^(拜拜|再见|bye|晚安|回聊)[!！。~\s]*$/i, scene: ['support', 'shopping', 'ops'] },
  // ── 客服 / 导购 ──
  // 比价与算价排在 policy 之前：否则"优惠券怎么用"会被 policy 抢走，"选哪个"会被 recommend 抢走
  { name: 'compare', re: /对比|比价|比较|比一下|比比|哪个好|选哪个|有什么区别|差别|性价比|值不值/, scene: ['shopping', 'support'] },
  { name: 'coupon', re: /优惠券|用券|领券|怎么买最省|能便宜|最划算|凑单|满减|积分抵/, scene: ['shopping', 'support'] },
  { name: 'policy', re: /运费|包邮|发票|会员|优惠|几天到|保修|政策|支持.*(退|换)/, scene: ['support'] },
  { name: 'complaint', re: /投诉|差评|骗子|气死|垃圾|太差/, scene: ['support'] },
  { name: 'greeting', re: /^(你好|您好|hi|hello|在吗|哈喽)[!！。 ]*$/i, scene: ['support', 'shopping', 'ops'] },
  { name: 'recommend', re: /推荐|买什么|送|挑|选|有没有|想要|适合|预算|\d+\s*(元|块)/, scene: ['shopping', 'support'] },
  // refund 必须排在 order 之前："这个订单我要退款"两个词都命中，退款意图优先
  { name: 'refund', re: /退款|退货|退换|不想要了|退钱/, scene: ['support'] },
  { name: 'order', re: /订单|买的|快递|物流|发货|到哪|签收|收货/, scene: ['support'] },
];

/** 回复多样化：同一意图按输入内容稳定取样，不再千篇一律 */
function hashOf(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + (c.codePointAt(0) || 0)) >>> 0;
  return h;
}
const vary = (arr, key) => arr[hashOf(key) % arr.length];

export function detectIntent(text, scene) {
  for (const it of INTENTS) {
    if (!it.scene.includes(scene)) continue;
    if (it.re.test(text)) return it.name;
  }
  return scene === 'support' ? 'general' : scene === 'ops' ? 'ops_general' : 'recommend';
}

const fmt = (n) => `¥${Number(n).toFixed(2).replace(/\.00$/, '')}`;

function pickOrderFromText(text, orders) {
  // 订单号格式：AIM + 8 位日期 + 4 位随机码（数字或字母）
  const no = text.match(/AIM\d{8}[A-Za-z0-9]{0,6}/i);
  if (no) return orders.find((o) => o.orderNo.toUpperCase() === no[0].toUpperCase());
  const idx = text.match(/第\s*([一二三四五1-5])\s*(个|笔|单)/);
  if (idx) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
    const i = map[idx[1]] || Number(idx[1]);
    return orders[i - 1];
  }
  return orders[0];
}

/** 从自然语言里抠商品 ID：支持"3 号商品""商品 3""id:3""第 1 个商品" */
function pickProductId(text) {
  const m = String(text).match(/(?:商品|产品|id)\s*[:：]?\s*(\d{1,3})|第\s*(\d{1,3})\s*(?:个|件|号)|(\d{1,3})\s*号/i);
  return m ? Number(m[1] || m[2] || m[3]) : null;
}

/** 去掉算价/比价意图词，剩下的才是商品关键词 */
function cleanQuery(text) {
  return String(text)
    .replace(/[?？!！。，,、]/g, ' ')
    .replace(/能便宜多少|便宜多少|有券吗|有没有券|怎么买最省|最划算|帮我算|算一下|算算|凑单|满减|积分抵现|优惠券|用券|领券|还差多少|差多少|对比|比价|比较|比一下|比比|哪个好|选哪个|有什么区别|值不值|这个|这件|这款|商品|价格|实付|多少/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @returns {Promise<{content:string, toolTrace:any[], mode:'local'}>}
 */
export async function localAgent({ scene, text, ctx, exec }) {
  const toolTrace = [];
  const call = async (name, args) => {
    const r = await exec(name, args, ctx);
    toolTrace.push({ name, args, ok: !r.error, ms: r.ms || 0, error: r.error });
    return r.error ? null : r.result;
  };

  const intent = detectIntent(text, scene);

  if (intent === 'greeting') {
    const g = scene === 'support'
      ? vary(['你好呀，我是客服小八。查订单、问物流、申请退换，都可以直接说。', '你好～客服小八在的。订单、物流、退款，说出问题我来处理。', '您好！我是小八。想查订单进度还是咨询售后？'], text)
      : scene === 'ops'
        ? vary(['你好，运营智能体就位。可以让我看滞销、写文案、盘库存，说个方向吧。', '嗨，我来盯店的。想先看经营数据，还是让某个商品多卖出去点？', '你好～告诉我今天想推进什么：数据诊断、商品文案，还是活动建议。'], text)
        : vary(['嗨，我是导购小八。告诉我预算和用途，我来帮你挑。', '你好呀～想买点什么？说预算或者场景，我帮你找。', '在的在的，今天想看点什么？我按需求帮你筛。'], text);
    return { content: g, toolTrace, mode: 'local', intent };
  }

  if (intent === 'capability') {
    const c = scene === 'support'
      ? '我能帮你：\n1. 查订单/物流（说"我的订单到哪了"）\n2. 自助提交退款（说"申请退款"）\n3. 算最省买法（说"这单能便宜多少"）\n4. 答政策问题（运费、发票、会员）\n5. 帮你挑商品\n直接说需求就行。'
      : scene === 'ops'
        ? '我能做这几件事：\n1. 经营诊断：滞销/爆款/库存预警（说"看下滞销品"）\n2. 商品文案：生成后可直接写回（说"给 3 号商品写文案"）\n3. 成交盘点：GMV、单量、趋势（说"最近卖得怎么样"）\n4. 定价建议：结合销量与竞品（说"怎么给商品调价"）\n5. 促销方案：基于真实库存与销量出主意（说"帮我出个促销方案"）'
          + '\n6. 口碑跟进：差评处理思路（说"看看评价情况"）'
        : '我能帮你：\n1. 按需求/预算推荐商品（说"200 元内送人的礼物"）\n2. 同品类对比（说"这两个哪个好"）\n3. 算到手价（说"这单最省怎么买"）\n4. 查订单售后（转到客服场景）\n说说你的需求吧。';
    return { content: c, toolTrace, mode: 'local', intent };
  }

  if (intent === 'thanks') {
    return { content: vary(['不客气，还有需要随时叫我。', '应该的～有其他问题继续找我。', '好嘞，祝顺利！有需要再来。'], text), toolTrace, mode: 'local', intent };
  }

  if (intent === 'bye') {
    return { content: vary(['好的，回见～', '再见，有问题随时来找我。', '嗯嗯，慢走～'], text), toolTrace, mode: 'local', intent };
  }

  if (intent === 'order') {
    if (!ctx.userId) return { content: '查询订单需要先登录哦，登录后我就能帮你查了。', toolTrace, mode: 'local', intent };
    const orders = await call('get_my_orders', { limit: 10 });
    if (!orders?.length) return { content: '你还没有下过订单。要不要我帮你推荐几件？', toolTrace, mode: 'local', intent };

    const target = pickOrderFromText(text, orders);
    if (target) {
      const d = await call('get_order_detail', { orderNo: target.orderNo });
      if (d?.found) {
        const items = d.items.map((i) => `${i.title}×${i.qty}`).join('、');
        const shipLine = d.status === '已发货'
          ? `已于 ${String(d.shippedAt).slice(0, 10)} 发出，正常 2-3 天送达。`
          : d.status === '已完成' ? '已签收完成。' : d.status === '待发货' ? '仓库正在打包，24 小时内发出。' : '';
        return {
          content: `订单 ${d.orderNo} 当前状态：${d.status}。\n商品：${items}，实付 ${fmt(d.total)}。\n${shipLine}\n收货地址：${d.address}`,
          toolTrace, mode: 'local', intent,
        };
      }
    }
    const list = orders.slice(0, 3).map((o) => `· ${o.orderNo}｜${o.status}｜${fmt(o.total)}｜${o.items.join('、')}`).join('\n');
    return { content: `你最近有 ${orders.length} 笔订单：\n${list}\n你想查哪一笔？直接告诉我订单号就行。`, toolTrace, mode: 'local', intent };
  }

  if (intent === 'refund') {
    if (!ctx.userId) return { content: '申请退款前需要先登录，登录后我可以直接帮你提交。', toolTrace, mode: 'local', intent };
    const orders = await call('get_my_orders', { limit: 10 });
    const target = pickOrderFromText(text, orders || []);
    if (!target) return { content: '没找到可退款的订单。你可以在「我的订单」里确认一下。', toolTrace, mode: 'local', intent };

    const el = await call('check_return_eligibility', { orderId: target.orderId });
    if (!el?.eligible) {
      return { content: `这笔订单（${target.orderNo}）暂时不能自助退款：${el?.reason || '不符合条件'}。\n这个我办不了，建议联系人工客服进一步协商。`, toolTrace, mode: 'local', intent };
    }
    const reason = text.replace(/.*(因为|原因)[:：]?/, '').slice(0, 60) || '用户申请退款';
    const created = await call('create_refund_request', { orderId: target.orderId, reason });
    if (created?.ok) {
      return {
        content: `已为你提交退款申请 ✅\n订单：${target.orderNo}\n金额：${fmt(created.amount)}（原路退回）\n进度：商家 1-3 个工作日内审核，通过后 1-3 个工作日到账。\n在「订单详情」里可以看到每一步的处理人和时间。`,
        toolTrace, mode: 'local', intent,
      };
    }
    return { content: `退款没提交成功：${created?.message || '请稍后重试'}。`, toolTrace, mode: 'local', intent };
  }

  if (intent === 'compare') {
    const pid = pickProductId(text);
    const key = cleanQuery(text);
    const cmp = await call('compare_products', pid ? { productId: pid } : { query: key || text });
    if (!cmp?.found) {
      return { content: cmp?.message || '没找到可以对比的商品，你可以说个商品名或给我商品 ID。', toolTrace, mode: 'local', intent };
    }
    const rows = cmp.rows
      .map((r) => `· ${r.title}｜${fmt(r.price)}｜${r.rating} 分｜已售 ${r.sales}${r.inStock ? '' : '（缺货）'}`)
      .join('\n');
    return {
      content: `同品类对比（${cmp.category}）：\n${rows}\n\n结论：${cmp.verdict.note}。\n如果告诉我预算和用途，我可以直接给一个建议。`,
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'coupon') {
    if (!ctx.userId) {
      return { content: '算最省方案需要先登录，登录后我能按你的会员等级、券包和积分算到分。', toolTrace, mode: 'local', intent };
    }
    const pid = pickProductId(text);
    let productId = pid;
    if (!productId) {
      const key = cleanQuery(text);
      if (key) {
        const s = await call('search_products', { query: key, limit: 1 });
        productId = s?.items?.[0]?.id || null;
      }
    }
    if (!productId) {
      return { content: '告诉我具体想买哪件商品（说商品名或给我商品 ID），我帮你算最省的一单。', toolTrace, mode: 'local', intent };
    }
    const q = await call('quote_order', { productId, qty: 1 });
    if (!q?.login) return { content: q?.message || '暂时算不出价格，请稍后再试。', toolTrace, mode: 'local', intent };

    const steps = (q.steps || [])
      .map((s) => `· ${s.label}：${s.amount > 0 ? '-' + fmt(s.amount) : (s.note || fmt(-s.amount))}`)
      .join('\n');
    const best = q.bestCoupon
      ? `\n券包里最划算的是「${q.bestCoupon.title}」，可省 ${fmt(q.bestCoupon.discount)}，结算页勾上即可。`
      : (q.usableCoupons.length ? '' : '\n这单暂时没有可用券，可以去「领券中心」领一张。');
    const next = q.nextFullCut?.gapCents
      ? `\n再凑 ${fmt(q.nextFullCut.gapCents / 100)} 就够「${q.nextFullCut.label}」。`
      : '';
    return {
      content: `帮你按 ${q.level} 算了一下：\n商品小计 ${fmt(q.subtotal)}\n${steps}\n实付 ${fmt(q.total)}，一共省 ${fmt(q.saved)}。${best}${next}`,
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'policy') {
    const kb = await call('search_kb', { query: text });
    const e = kb?.entries?.[0];
    return {
      content: e ? `${e.a}\n\n还有其他想了解的吗？` : '这个问题我暂时没有查到标准答案，建议转人工客服确认。',
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'complaint') {
    return {
      content: '非常抱歉给你带来了不好的体验 🙏\n我已经记录这个问题。为了尽快处理，请告诉我具体是哪个订单，或者直接描述发生了什么，我来跟进。',
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'recommend') {
    const products = await call('search_products', { query: text, limit: 5 });
    if (!products?.items?.length) {
      return { content: '没找到特别匹配的商品。你可以换个说法，或者说个预算范围，我再找找。', toolTrace, mode: 'local', intent };
    }
    const lines = products.items.slice(0, 3).map((p) => `· ${p.title}｜${fmt(p.price)}｜${p.reason}`);
    return {
      content: `按你的需求，我觉得这几件比较合适：\n${lines.join('\n')}\n\n想了解哪一件？我可以详细说说，或者直接帮你加购。`,
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'ops_data' || intent === 'ops_insight' || intent === 'ops_stock') {
    // 依关键词决定聚焦点：滞销 / 爆款 / 库存 / 概览
    const focus = /滞销|卖不动/.test(text) ? 'slow_moving'
      : /爆款|热卖|排行|销量冠军/.test(text) ? 'hot'
        : /库存|补货|断货|缺货|备货|进货/.test(text) ? 'low_stock'
          : 'overview';
    const ins = await call('get_sales_insight', { focus });
    if (!ins) return { content: '暂时取不到经营数据，请确认当前账号是否有商家权限。', toolTrace, mode: 'local', intent };

    const open = vary([
      `刚拉了一遍经营数据：成交 ${ins.paidOrders} 单，GMV ${fmt(ins.gmv)}。`,
      `目前盘面：累计成交 ${ins.paidOrders} 单，GMV ${fmt(ins.gmv)}。`,
      `先说结论——店铺累计 ${ins.paidOrders} 单、GMV ${fmt(ins.gmv)}，具体如下：`,
    ], text);

    if (focus === 'low_stock') {
      const low = ins.lowStock.slice(0, 4).map((p) => `· ${p.title}：仅剩 ${p.stock} 件`).join('\n');
      const hot = ins.hot[0] ? `\n另外，卖得最好的「${ins.hot[0].title}」库存还有 ${ins.hot[0].stock} 件，建议优先给爆款补货。` : '';
      return {
        content: `${open}\n\n库存预警：\n${low || '暂无低库存商品，备货健康。'}${hot}\n\n需要我按销量排个补货优先级吗？`,
        toolTrace, mode: 'local', intent,
      };
    }
    if (focus === 'hot') {
      const hot = ins.hot.slice(0, 3).map((p) => `· ${p.title}（销量 ${p.sales}）`).join('\n');
      return {
        content: `${open}\n\n卖得最好的 TOP3：\n${hot}\n\n爆款可以试着搭配滞销品做组合价，把流量分给新客。需要我出个搭配方案吗？`,
        toolTrace, mode: 'local', intent,
      };
    }

    const slow = ins.slowMoving.slice(0, 3).map((p) => `· ${p.title}（销量 ${p.sales}，库存 ${p.stock}）`).join('\n');
    const low = ins.lowStock.slice(0, 3).map((p) => `· ${p.title}（剩 ${p.stock}）`).join('\n') || '暂无';
    const tail = vary([
      '需要我给滞销品写一版新文案试试吗？',
      '要不要我针对滞销 TOP1 出一版文案或促销思路？',
      '想先处理哪个？我可以直接给文案或活动建议。',
    ], text);
    return {
      content: `${open}\n\n滞销 TOP3：\n${slow}\n\n库存预警：\n${low}\n\n${tail}`,
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'ops_price') {
    const ins = await call('get_sales_insight', { focus: 'slow_moving' });
    if (!ins) return { content: '暂时取不到经营数据，请确认当前账号是否有商家权限。', toolTrace, mode: 'local', intent };
    const slow = ins.slowMoving[0];
    const hot = ins.hot[0];
    const lines = [];
    if (slow) lines.push(`· 「${slow.title}」销量 ${slow.sales}：建议下调 5%-10%（约 ¥${(slow.price * 0.92).toFixed(0)} 一档），或配合限时秒杀清库存`);
    if (hot) lines.push(`· 「${hot.title}」销量 ${hot.sales}：供不应求可小幅上调或缩小折扣，用满减拉客单价`);
    return {
      content: `定价建议（基于真实销量）：\n${lines.join('\n')}\n\n原则：滞销品让价换曝光，爆品守住毛利。告诉我具体商品 ID，我可以帮它生成"降价 + 文案"的组合动作。`,
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'ops_promo') {
    const ins = await call('get_sales_insight', { focus: 'slow_moving' });
    if (!ins) return { content: '暂时取不到经营数据，请确认当前账号是否有商家权限。', toolTrace, mode: 'local', intent };
    const p = ins.slowMoving[0];
    const plan = [
      `1. 特价引流：把「${p?.title || '滞销商品'}」放进秒杀/特价位，限时 48 小时，目标先走 30% 库存；`,
      '2. 满减拉客单：设一张「满 199 减 20」券，把客单价从单品抬到组合单；',
      '3. 内容种草：给主推品写 2-3 版短视频文案，投到内容页「发现」频道；',
      '4. 口碑循环：对已签收订单发起"晒图返现"评价活动，补足买家秀。',
    ].join('\n');
    return {
      content: `${vary(['给你一套可以直接执行的组合拳', '结合店里数据，建议这样打', '促销方案来了，按优先级排'] , text)}：\n${plan}\n\n想先执行哪一步？文案我可以马上生成。`,
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'ops_review') {
    const ins = await call('get_sales_insight', { focus: 'overview' });
    if (!ins) return { content: '暂时取不到经营数据，请确认当前账号是否有商家权限。', toolTrace, mode: 'local', intent };
    const p = ins.hot[0] || ins.slowMoving[0];
    return {
      content: `口碑跟进建议：\n1. 在「评价管理」按"待回复/低分"筛选，24 小时内回应差评——先致歉、再给方案（补发/退款），避免公开扯皮；\n2. 对「${p?.title || '主推品'}」这类高销量商品开启晒图返现，把好评率与买家秀做厚；\n3. 每周看一次商品页的"买家印象"标签云，负向词集中出现就是品控信号。\n\n需要我帮某件商品生成一条差评回复模板吗？`,
      toolTrace, mode: 'local', intent,
    };
  }

  if (intent === 'ops_copy') {
    const idMatch = text.match(/(\d{1,3})\s*号|商品\s*(\d{1,3})|id\s*[:：]?\s*(\d{1,3})/i);
    const pid = idMatch ? Number(idMatch[1] || idMatch[2] || idMatch[3]) : null;
    const ins = await call('get_sales_insight', { focus: 'slow_moving' });
    const targetId = pid || ins?.slowMoving?.[0]?.id;
    if (!targetId) return { content: '请告诉我要给哪个商品写文案（可以说商品 ID）。', toolTrace, mode: 'local', intent };

    const base = await call('generate_product_copy', { productId: targetId, style: '种草' });
    if (!base) return { content: '没找到这个商品，请确认 ID。', toolTrace, mode: 'local', intent };

    const tags = base.facts.tags.slice(0, 3);
    const subtitle = `${tags.slice(0, 2).join(' · ')} · 好评率 ${Math.round(base.facts.rating * 20)}%`;
    const selling = tags.map((t) => `${t}，${pickSuffix(t)}`);
    const desc = `${base.facts.title}，${base.facts.desc.split('。')[0]}。已有 ${base.facts.sales} 位用户下单，目前库存 ${base.facts.stock} 件。`;

    return {
      content: `给「${base.facts.title}」生成了一版文案：\n\n【副标题】${subtitle}\n【卖点】\n${selling.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n【详情】${desc}\n\n回复"应用"我就直接写回商品。`,
      toolTrace, mode: 'local', intent, draft: { productId: base.productId, subtitle, description: desc, selling },
    };
  }

  if (intent === 'ops_general') {
    return {
      content: vary([
        '这块我可以帮你：\n1. 经营诊断：滞销/爆款/库存（说"看下滞销品"）\n2. 商品文案：说"给 3 号商品写文案"\n3. 成交盘点：说"最近卖得怎么样"\n4. 定价与促销建议：说"怎么调价"/"出个促销方案"\n\n你想先做哪个？',
        '运营上我能干的都在这了：盘数据、写文案、定价格策略、出促销方案、盯口碑。直接说事就行，比如「卖得怎么样」或「给 1 号商品换个文案」。',
        '换个说法告诉我你的目标吧——是想知道"最近卖得怎么样"，还是想让某件商品"多卖出去"？我按目标来干活。',
      ], text),
      toolTrace, mode: 'local', intent,
    };
  }

  // support 兜底：先试知识库，再试商品检索
  if (scene === 'support') {
    const kb = await call('search_kb', { query: text });
    if (kb?.entries?.[0]) return { content: `${kb.entries[0].a}\n\n还有别的问题吗？`, toolTrace, mode: 'local', intent };
  }
  const products = await call('search_products', { query: text, limit: 3 });
  if (products?.items?.length) {
    const lines = products.items.map((p) => `· ${p.title}｜${fmt(p.price)}`).join('\n');
    return { content: `你是想找这类商品吗：\n${lines}\n\n如果是别的问题，可以说得再具体一点。`, toolTrace, mode: 'local', intent };
  }
  return { content: '这个问题我还没学会。你可以换个说法，或者点右上角转人工客服。', toolTrace, mode: 'local', intent };
}

function pickSuffix(tag) {
  const m = {
    降噪: '地铁通勤也能听清人声', 耳机: '长时间佩戴不夹耳', 通勤: '早高峰不再手忙脚乱',
    护眼: '长时间看书眼睛不酸', 台灯: '亮度随环境自动调整', 卧室: '夜里起身不刺眼',
    卫衣: '宽松有型不显胖', 秋冬: '内搭外穿都合适', 基础款: '怎么搭都不出错',
    咖啡: '在家复刻店里的味道', 手冲: '水流稳，新手也好控',
    背包: '装得下 16 寸电脑', 电脑包: '隔层独立，不硌机器',
    护肤: '敏感肌也能用', 保湿: '上脸不黏腻',
    早餐: '三分钟解决早饭', 健康: '配料表干净',
    静音: '睡觉开着也不吵', 夏天: '风感柔和不头疼',
    跑鞋: '轻到忘记穿了鞋', 运动: '跑完膝盖不酸',
    香薰: '味道淡雅不冲', 礼物: '包装体面，送人不尴尬',
    锅具: '少油也不粘锅', 厨房: '受热均匀好掌握',
  };
  return m[tag] || `${tag}表现优秀`;
}
