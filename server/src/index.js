import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate, seed, demoAccounts } from './db/seed.js';
import { match } from './lib/http.js';
import { send, ok, fail } from './lib/http.js';
import './routes/index.js';
import { serveStatic } from './routes/index.js';
import { sweepOrders } from './services/orders.js';
import { settleTeams } from './services/promotions.js';
import { startLimiterCleanup } from './lib/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const DIST = path.resolve(__dirname, '../../web/dist');
const hasDist = fs.existsSync(path.join(DIST, 'index.html'));

migrate();
const seedResult = seed();

/** 允许的跨域来源：本机、局域网、以及显式配置的白名单；不再反射任意 Origin */
const EXTRA_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
function originAllowed(origin) {
  if (!origin) return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const h = u.hostname;
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(h)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    return false;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const t0 = Date.now();

  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    // 来源不在白名单：不返回 CORS 头，浏览器会拦截；服务端仍可本地直连调试
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    const hit = match(req.method, url.pathname);
    if (hit) {
      await hit.route.handler(req, hit.params, res, url);
      if (process.env.LOG_REQ) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms`);
      return;
    }
    // 非 API 走静态资源
    if (!url.pathname.startsWith('/api') && hasDist) {
      const served = await serveStatic(req, res, DIST, url);
      if (served) return;
    }
    fail(res, 'NOT_FOUND', `接口不存在: ${req.method} ${url.pathname}`, 404);
  } catch (e) {
    const status = e.status || (e.code === 'UNAUTHORIZED' ? 401 : 500);
    if (status >= 500) {
      // 内部错误只写日志，不把 SQLite/堆栈细节暴露给调用方
      console.error('[error]', req.method, url.pathname, e);
      return fail(res, 'INTERNAL', '服务器开小差了，请稍后重试；若持续失败请联系管理员', 500);
    }
    fail(res, e.code || 'BAD_REQUEST', e.message || '请求不合法', status);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ✖ 端口 ${PORT} 已被占用。先关掉占用进程，或换端口：PORT=3002 npm start\n`);
    process.exit(1);
  }
  // 少数环境没有 IPv6 栈，退回只监听 IPv4
  if (e.code === 'EADDRNOTAVAIL' && !process.env.HOST) {
    console.warn('  ! 当前环境不支持 IPv6 双栈监听，回退到 0.0.0.0（仅 IPv4）');
    server.listen(PORT, '0.0.0.0', onListen);
    return;
  }
  throw e;
});

// 不指定 host：Node 监听 :: （Windows/Linux 默认双栈，IPv4 与 IPv6 都能连）。
// 之前写死 '0.0.0.0' 只监听 IPv4，导致 localhost 解析到 ::1 的客户端（如 vite 代理）连接被拒，
// 表现为前端所有 /api 请求 500。需要限制网卡时用 HOST=0.0.0.0 显式指定。
server.listen(PORT, process.env.HOST || undefined, onListen);

function onListen() {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets)
    .flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal)?.address;
  console.log(`\n  AI Mall API  →  http://localhost:${PORT}/api/health`);
  if (lan) console.log(`  局域网访问   →  http://${lan}:${PORT}   （手机连同一 WiFi 可直接用）`);
  console.log(`  数据库       →  ${process.env.DB_FILE || 'server/../data/mall.db'}`);
  console.log(`  AI 网关      →  ${process.env.AI_API_KEY ? '已配置（远端模型）' : '未配置（本地引擎降级）'}`);
  if (seedResult.seeded) {
    console.log(`  种子数据     →  已初始化 ${seedResult.products} 个商品`);
    console.log(`  商家账号     →  ${demoAccounts.merchant.email} / ${demoAccounts.merchant.password}`);
    console.log(`  买家账号     →  ${demoAccounts.customer.email} / ${demoAccounts.customer.password}`);
  }
  if (hasDist) console.log(`  前端静态     →  http://localhost:${PORT}\n`);
  else console.log(`  前端开发     →  cd web && npm run dev\n`);

  // 订单自动流转：启动后先扫一遍，之后每分钟检查超时未支付与超期未收货
  const runSweep = () => {
    try {
      const r = sweepOrders();
      if (r.closed || r.completed) {
        console.log(`[orders] 自动关单 ${r.closed} 笔，自动确认收货 ${r.completed} 笔`);
      }
      // 拼团超时结算：成团的置为已支付，未成团的关单退款
      const g = settleTeams();
      if (g.checked) console.log(`[group] 结算 ${g.checked} 个团，成团 ${g.success}，失败 ${g.failed}`);
    } catch (e) {
      console.error('[orders] 定时任务失败', e.message);
    }
  };
  setTimeout(runSweep, 3000).unref?.();
  setInterval(runSweep, 60_000).unref?.();
  startLimiterCleanup();
}

export { server, ok, send };
