/** 极简 HTTP 路由框架：零依赖，够用即可 */
import http from 'node:http';

const routes = [];

function add(method, path, handler, opts = {}) {
  // /api/products/:id → 正则
  const keys = [];
  const pattern = path.replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  routes.push({ method, re: new RegExp(`^${pattern}/?$`), keys, handler, opts });
}

export const app = {
  get: (p, h, o) => add('GET', p, h, o),
  post: (p, h, o) => add('POST', p, h, o),
  put: (p, h, o) => add('PUT', p, h, o),
  patch: (p, h, o) => add('PATCH', p, h, o),
  delete: (p, h, o) => add('DELETE', p, h, o),
};

export function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) {
        const e = new Error('请求体过大（上限 1MB）');
        e.status = 413;
        e.code = 'PAYLOAD_TOO_LARGE';
        reject(e);
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch {
        const e = new Error('请求体不是合法 JSON');
        e.status = 400;
        e.code = 'INVALID_JSON';
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export const ok = (res, data, status = 200) => send(res, status, { ok: true, data });
export const fail = (res, code, message, status = 400) => send(res, status, { ok: false, error: { code, message } });

export { http };
