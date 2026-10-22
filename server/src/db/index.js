/**
 * 数据层：SQLite（node:sqlite / better-sqlite3 双适配）
 * - 优先使用 Node 22+ 内置 node:sqlite，零依赖
 * - 回退到 better-sqlite3（如已安装）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'mall.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

let raw;
let kind;

async function open() {
  try {
    const mod = await import('node:sqlite');
    raw = new mod.DatabaseSync(DB_FILE);
    kind = 'node:sqlite';
  } catch {
    const mod = await import('better-sqlite3');
    raw = new (mod.default || mod)(DB_FILE);
    kind = 'better-sqlite3';
  }
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  // 多进程（后台任务/脚本）同时写时避免直接抛 SQLITE_BUSY
  raw.exec('PRAGMA busy_timeout = 5000;');
}

await open();

export const dbKind = kind;

/** 查询多行 */
export function all(sql, params = []) {
  return raw.prepare(sql).all(...params);
}

/** 查询单行 */
export function get(sql, params = []) {
  return raw.prepare(sql).get(...params);
}

/** 执行写入，返回 { changes, lastId } */
export function run(sql, params = []) {
  const r = raw.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

/**
 * 事务包装：支持嵌套（内层用 SAVEPOINT）
 * 订单 + 库存 + 券核销需要跨服务调用，嵌套事务不处理好会直接报 "cannot start a transaction within a transaction"
 */
let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) {
    const sp = `sp_${txDepth}`;
    raw.exec(`SAVEPOINT ${sp}`);
    txDepth += 1;
    try {
      const out = fn();
      raw.exec(`RELEASE ${sp}`);
      txDepth -= 1;
      return out;
    } catch (e) {
      try { raw.exec(`ROLLBACK TO ${sp}`); raw.exec(`RELEASE ${sp}`); } catch { /* ignore */ }
      txDepth -= 1;
      throw e;
    }
  }
  raw.exec('BEGIN');
  txDepth = 1;
  try {
    const out = fn();
    txDepth = 0;
    raw.exec('COMMIT');
    return out;
  } catch (e) {
    txDepth = 0;
    try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export default { all, get, run, tx, dbKind, DATA_DIR };
