/**
 * Agent Runtime：统一对话入口
 * 真模型（tool calling 循环）优先，失败自动降级本地引擎（同样执行真实工具）
 */
import { all, get, run } from '../db/index.js';
import { chat, gatewayConfig, toToolSchema, AIUnavailable } from './gateway.js';
import { toolsForScene, executeTool } from './tools.js';
import { SYSTEM_PROMPTS, SCENE_META, temperature } from './prompts.js';
import { localAgent } from './local-engine.js';
import { AppError } from '../services/users.js';
import { toIso } from '../lib/time.js';

const MAX_TURNS = 4;

function historyMessages(conversationId, limit = 12) {
  const rows = all(
    'SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?',
    [conversationId, limit],
  ).reverse();
  return rows.map((r) => ({ role: r.role === 'assistant' ? 'assistant' : r.role, content: r.content }));
}

export function ensureConversation({ userId, scene, conversationId, title }) {
  if (conversationId) {
    const c = get('SELECT * FROM ai_conversations WHERE id = ?', [+conversationId]);
    if (c) {
      // 会话有归属时，当前用户必须匹配；游客（userId 为空）不能续写他人会话
      if (c.user_id !== null && c.user_id !== userId) throw new AppError('FORBIDDEN', '无权访问该会话', 403);
      return c;
    }
  }
  const meta = SCENE_META[scene];
  if (!meta) throw new AppError('INVALID_SCENE', '场景不合法');
  const { lastId } = run(
    'INSERT INTO ai_conversations (user_id, scene, title, mode) VALUES (?,?,?,?)',
    [userId ?? null, scene, title || meta.label, gatewayConfig().enabled ? 'remote' : 'local'],
  );
  return get('SELECT * FROM ai_conversations WHERE id = ?', [lastId]);
}

async function runRemote({ scene, ctx, msgs, exec, toolTrace }) {
  const tools = toolsForScene(scene, ctx.role || 'guest').map(toToolSchema);
  const messages = [{ role: 'system', content: SYSTEM_PROMPTS[scene]() }, ...msgs];
  let finalText = '';

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const resp = await chat({ messages, tools, temperature: temperature() });

    if (!resp.toolCalls?.length) {
      finalText = resp.content;
      break;
    }

    messages.push({ role: 'assistant', content: resp.content || '', tool_calls: resp.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) });

    for (const call of resp.toolCalls) {
      const r = await exec(call.name, call.args, ctx);
      toolTrace.push({ name: call.name, args: call.args, ok: !r.error, ms: r.ms || 0, error: r.error });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(r.error ? { error: r.error } : r.result).slice(0, 4000),
      });
    }
    if (turn === MAX_TURNS - 1) finalText = resp.content || '信息较多，我先整理到这里。还需要我继续吗？';
  }

  return { content: finalText || '我现在没能给出有效回答，换个说法试试？', toolTrace, mode: 'remote' };
}

export async function runAgent({ userId, role = 'guest', scene, conversationId, text }) {
  if (!text || !String(text).trim()) throw new AppError('INVALID', '内容不能为空');
  const conv = ensureConversation({ userId, scene, conversationId });
  const ctx = { userId: userId ?? null, role, scene };

  const started = Date.now();
  const msgs = [...historyMessages(conv.id), { role: 'user', content: String(text).trim() }];
  const exec = (name, args, c) => executeTool(name, args, c);

  let out;
  const cfg = gatewayConfig();
  if (cfg.enabled) {
    try {
      out = await runRemote({ scene, ctx, msgs, exec, toolTrace: [] });
    } catch (e) {
      if (!(e instanceof AIUnavailable)) throw e;
      out = await localAgent({ scene, text: String(text), ctx, exec });
    }
  } else {
    out = await localAgent({ scene, text: String(text), ctx, exec });
  }

  const latency = Date.now() - started;
  run('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?,?,?)', [conv.id, 'user', String(text).trim()]);
  const { lastId } = run(
    'INSERT INTO ai_messages (conversation_id, role, content, tool_calls, latency_ms) VALUES (?,?,?,?,?)',
    [conv.id, 'assistant', out.content, JSON.stringify(out.toolTrace || []), latency],
  );
  if (conv.mode !== out.mode) run('UPDATE ai_conversations SET mode = ? WHERE id = ?', [out.mode, conv.id]);

  return {
    conversationId: conv.id,
    messageId: lastId,
    content: out.content,
    mode: out.mode,
    latency,
    toolTrace: out.toolTrace || [],
    draft: out.draft || null,
    aiEnabled: cfg.enabled,
  };
}

export function applyDraft({ userId, role, productId, subtitle, description }) {
  if (role !== 'merchant') throw new AppError('FORBIDDEN', '仅商家可操作', 403);
  const r = executeTool('update_product_copy', { productId, subtitle, description }, { userId, role, scene: 'ops' });
  return r;
}

export function conversations(userId, scene) {
  const where = ['1=1'];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (scene) { where.push('scene = ?'); params.push(scene); }
  return all(`SELECT * FROM ai_conversations WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 100`, params)
    .map((c) => ({
      id: c.id, scene: c.scene, title: c.title, mode: c.mode,
      handoff: !!c.handoff, createdAt: toIso(c.created_at),
      messageCount: get('SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id = ?', [c.id]).n,
    }));
}

export function messages(conversationId, userId, role) {
  const c = get('SELECT * FROM ai_conversations WHERE id = ?', [+conversationId]);
  if (!c) throw new AppError('NOT_FOUND', '会话不存在', 404);
  if (role !== 'merchant' && c.user_id !== userId) throw new AppError('FORBIDDEN', '无权访问', 403);
  return all('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id', [c.id]).map((m) => ({
    id: m.id, role: m.role, content: m.content,
    toolTrace: JSON.parse(m.tool_calls || '[]'), latency: m.latency_ms, rating: m.rating ?? null,
    createdAt: toIso(m.created_at),
  }));
}

export function aiStats() {
  const total = get('SELECT COUNT(*) AS n FROM ai_conversations').n || 0;
  const msgs = get("SELECT COUNT(*) AS n FROM ai_messages WHERE role='assistant'").n || 0;
  const withTools = get("SELECT COUNT(*) AS n FROM ai_messages WHERE role='assistant' AND tool_calls != '[]'").n || 0;
  const recent = all('SELECT scene, mode, created_at FROM ai_conversations ORDER BY id DESC LIMIT 50');
  const byScene = {};
  for (const r of recent) byScene[r.scene] = (byScene[r.scene] || 0) + 1;
  return {
    conversations: total,
    aiMessages: msgs,
    toolCallRate: msgs ? +(withTools / msgs * 100).toFixed(1) : 0,
    byScene,
    mode: gatewayConfig().enabled ? 'remote' : 'local',
  };
}
