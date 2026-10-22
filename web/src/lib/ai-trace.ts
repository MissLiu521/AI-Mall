/**
 * AI 工具轨迹中文化：所有面向用户的界面只出现中文动作描述，
 * 不暴露工具名、参数等任何代码/数据库字段。
 */
export const TOOL_LABEL: Record<string, string> = {
  search_products: '查找商品',
  get_product_detail: '查看商品详情',
  compare_products: '商品对比',
  quote_order: '试算到手价',
  get_my_orders: '查询订单',
  get_order_detail: '查询订单详情',
  check_return_eligibility: '校验退款条件',
  create_refund_request: '提交退款申请',
  search_kb: '检索帮助知识',
  get_sales_insight: '读取经营数据',
  generate_product_copy: '撰写商品文案',
  update_product_copy: '更新商品文案',
};

const FOCUS_LABEL: Record<string, string> = {
  overview: '整体概览', slow_moving: '滞销商品', hot: '爆款', low_stock: '库存预警',
};

/** 把一次工具调用翻译成一句用户能看懂的中文动作 */
export function traceDesc(t: { name: string; args: any; ok: boolean; error?: string }): string {
  const a = t.args || {};
  switch (t.name) {
    case 'get_sales_insight':
      return `查看了${FOCUS_LABEL[a.focus] || '整体概览'}数据`;
    case 'generate_product_copy': {
      const style = a.style ? `，风格「${a.style}」` : '';
      return `为商品撰写了营销文案${style}`;
    }
    case 'update_product_copy':
      return '把新文案更新到了商品';
    case 'search_products':
      return `按「${a.query || '你的需求'}」查找了合适的商品`;
    case 'get_product_detail':
      return '查看了商品详细信息';
    case 'compare_products':
      return '对比了同品类商品的价格、口碑与销量';
    case 'quote_order':
      return '按会员等级与优惠券试算了到手价';
    case 'get_my_orders':
      return '查询了你的订单列表';
    case 'get_order_detail':
      return '查询了订单的物流与明细';
    case 'check_return_eligibility':
      return '校验了订单是否满足退款条件';
    case 'create_refund_request':
      return '为你提交了退款申请';
    case 'search_kb':
      return '在帮助知识库中查找了答案';
    default:
      return TOOL_LABEL[t.name] || '处理你的请求';
  }
}
