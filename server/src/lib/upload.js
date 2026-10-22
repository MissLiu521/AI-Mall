/**
 * 零依赖上传：multipart/form-data 解析 + 本地磁盘存储 + Range 播放
 *
 * 设计取舍：
 * - 不引 multer / busboy，只解析本项目需要的单层 multipart（浏览器 FormData / uni.uploadFile 都走这个格式）；
 * - 类型不信任前端 Content-Type，按文件头魔数二次校验，避免把 .html 改名成 .jpg 传上来当静态页执行；
 * - 文件名随机生成且不含路径分隔符，从根上避免目录穿越；
 * - 视频用 Range 响应，否则 <video> 无法拖动进度条。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../db/index.js';

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const LIMITS = {
  imageBytes: 8 * 1024 * 1024,
  videoBytes: 60 * 1024 * 1024,
  totalBytes: 80 * 1024 * 1024,
};

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

function bad(code, message, status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

/** 读够 maxBytes 就中断，避免攻击者用超大请求打满内存 */
function readRaw(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const abort = (err) => {
      if (done) return;
      done = true;
      req.destroy();
      reject(err);
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) return abort(bad('PAYLOAD_TOO_LARGE', '文件过大，请压缩后再上传', 413));
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => abort(e));
  });
}

/** 解析 multipart，返回 { fields: {name:value}, files: [{ field, filename, mime, buffer }] } */
export async function parseMultipart(req, { maxBytes = LIMITS.totalBytes } = {}) {
  const ctype = String(req.headers['content-type'] || '');
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
  if (!ctype.startsWith('multipart/form-data') || !m) {
    throw bad('BAD_CONTENT_TYPE', '请使用 multipart/form-data 上传文件', 415);
  }
  const boundary = Buffer.from(`--${(m[1] || m[2]).trim()}`);
  const raw = await readRaw(req, maxBytes);
  const fields = {};
  const files = [];

  let pos = raw.indexOf(boundary);
  if (pos < 0) throw bad('BAD_MULTIPART', '上传数据格式不正确');
  pos += boundary.length;

  while (pos < raw.length) {
    // 结束标记 --boundary--
    if (raw[pos] === 0x2d && raw[pos + 1] === 0x2d) break;
    if (raw[pos] === 0x0d && raw[pos + 1] === 0x0a) pos += 2;

    const headEnd = raw.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) break;
    const headerText = raw.slice(pos, headEnd).toString('utf8');
    const nextBoundary = raw.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), headEnd + 4);
    const bodyEnd = nextBoundary < 0 ? raw.length : nextBoundary;
    const body = raw.slice(headEnd + 4, bodyEnd);

    const nameM = /name="([^"]*)"/i.exec(headerText);
    const fileM = /filename="([^"]*)"/i.exec(headerText);
    const typeM = /content-type:\s*([^\s;]+)/i.exec(headerText);
    if (nameM) {
      if (fileM) {
        files.push({
          field: nameM[1],
          filename: fileM[1] || '',
          mime: (typeM?.[1] || 'application/octet-stream').toLowerCase(),
          buffer: body,
        });
      } else {
        fields[nameM[1]] = body.toString('utf8');
      }
    }
    pos = nextBoundary < 0 ? raw.length : nextBoundary + 2 + boundary.length;
  }
  return { fields, files };
}

/** 魔数校验：不认后缀，只认文件内容真正的类型 */
function sniff(buffer) {
  if (buffer.length < 12) return null;
  const hex = buffer.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 8).toString() === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString();
    if (brand.startsWith('qt')) return 'video/quicktime';
    return 'video/mp4';
  }
  if (hex.startsWith('1a45dfa3')) return 'video/webm';
  return null;
}

const extOf = (name = '') => path.extname(String(name)).toLowerCase();

/**
 * 保存一个上传文件，返回可直接放进 <img src> / <video src> 的地址
 * @returns {{ url: string, type: 'image'|'video', mime: string, size: number, name: string }}
 */
export function saveUpload(file, { allow = ['image', 'video'] } = {}) {
  if (!file || !file.buffer?.length) throw bad('EMPTY_FILE', '没有收到文件');
  // 只认文件头：前端声明的 Content-Type 可以随便伪造，不能作为放行依据
  const mime = sniff(file.buffer);
  const isImage = mime && IMAGE_TYPES.has(mime);
  const isVideo = mime && VIDEO_TYPES.has(mime);
  if (!mime || (!isImage && !isVideo)) {
    throw bad('UNSUPPORTED_TYPE', '文件内容不是有效的图片或视频（仅支持 JPG / PNG / WEBP / GIF / MP4 / WEBM / MOV）', 415);
  }
  const kind = isImage ? 'image' : 'video';
  if (!allow.includes(kind)) throw bad('UNSUPPORTED_TYPE', kind === 'image' ? '这里只能传图片' : '这里只能传视频', 415);

  const max = isImage ? LIMITS.imageBytes : LIMITS.videoBytes;
  if (file.buffer.length > max) {
    throw bad('FILE_TOO_LARGE', `${isImage ? '图片' : '视频'}不能超过 ${Math.round(max / 1024 / 1024)}MB`, 413);
  }

  // 后缀以真实类型为准，避免 "a.jpg.html" 这类拼接
  let ext = EXT_BY_MIME[mime] || extOf(file.filename) || (isImage ? '.jpg' : '.mp4');
  if (!MIME_BY_EXT[ext]) ext = isImage ? '.jpg' : '.mp4';

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return { url: `/api/uploads/${name}`, type: kind, mime, size: file.buffer.length, name };
}

/** 本地磁盘上的绝对路径；非法名一律返回 null（不抛错，调用方回 404） */
export function uploadPath(name) {
  const base = path.basename(String(name || ''));
  if (!base || base !== String(name) || base.includes('\0')) return null;
  if (!MIME_BY_EXT[extOf(base)]) return null;
  const p = path.join(UPLOAD_DIR, base);
  if (!p.startsWith(UPLOAD_DIR + path.sep)) return null;
  return fs.existsSync(p) ? p : null;
}

/** 静态响应上传文件；支持 Range，视频才能拖动 */
export function serveUpload(req, res, name) {
  const p = uploadPath(name);
  if (!p) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: '文件不存在' } }));
    return;
  }
  const stat = fs.statSync(p);
  const mime = MIME_BY_EXT[extOf(p)] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  };

  const range = String(req.headers.range || '');
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null && end !== null) { start = Math.max(0, stat.size - end); end = stat.size - 1; }
    else {
      start = start ?? 0;
      end = end === null ? stat.size - 1 : Math.min(end, stat.size - 1);
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(p, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(p).pipe(res);
}
