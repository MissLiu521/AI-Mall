/**
 * AI 网关：OpenAI 兼容 /v1/chat/completions
 * - 有 baseUrl + apiKey 走真模型（支持 tool calling）
 * - 否则 / 失败 → 抛出 AIUnavailable，由上层降级到本地引擎
 */
import { get } from '../db/index.js';
export class AIUnavailable extends Error {
  constructor(msg) { super(msg); this.name = 'AIUnavailable'; }
}

/** 模型名优先取后台配置（保存即生效），其次环境变量，最后默认值 */
export function currentModel() {
  try {
    const row = get("SELECT value FROM ai_config WHERE key = 'model'");
    const fromDb = (row?.value || '').trim();
    if (fromDb) return fromDb;
  } catch { /* 表尚未创建时忽略 */ }
  return (process.env.AI_MODEL || '').trim() || 'gpt-4o-mini';
}

export function gatewayConfig() {
  return {
    baseUrl: (process.env.AI_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.AI_API_KEY || '',
    model: currentModel(),
    enabled: !!(process.env.AI_BASE_URL && process.env.AI_API_KEY),
  };
}

/**
 * @param {object} p
 * @param {{role:string,content:string,tool_call_id?:string,tool_calls?:any[]}[]} p.messages
 * @param {any[]} [p.tools]
 * @param {number} [p.temperature]
 * @param {AbortSignal} [p.signal]
 */
export async function chat({ messages, tools, temperature = 0.6, model, signal }) {
  const cfg = gatewayConfig();
  if (!cfg.enabled) throw new AIUnavailable('未配置 AI_BASE_URL / AI_API_KEY');

  const body = { model: model || cfg.model, messages, temperature, stream: false };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }

  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new AIUnavailable(`模型请求失败: ${e.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AIUnavailable(`模型返回 ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new AIUnavailable('模型返回结构异常');
  return {
    content: msg.content || '',
    toolCalls: (msg.tool_calls || []).map((t) => ({
      id: t.id,
      name: t.function?.name,
      args: safeParse(t.function?.arguments),
    })),
    usage: json.usage,
  };
}

function safeParse(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}

export function toToolSchema(tool) {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}
