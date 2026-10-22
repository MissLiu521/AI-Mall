/**
 * dev 启动包装：
 * server 依赖 Node 22+ 内置的 node:sqlite。若当前 Node < 22，
 * 会尝试 import better-sqlite3 回退——没装就报 ERR_MODULE_NOT_FOUND。
 * 本脚本检测 Node 版本，低版本时自动切换到本机可用的 Node 22+ 再启动 scripts/dev.js，
 * 并把该 Node 所在目录前置到 PATH，保证 dev.js 派生的子进程（server/web）也用同一版本。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const major = Number(process.versions.node.split('.')[0]);

function nodeMajorOf(bin) {
  try {
    const out = spawnSync(bin, ['-v'], { encoding: 'utf8' });
    return Number(String(out.stdout || '').trim().replace(/^v/, '').split('.')[0]);
  } catch {
    return 0;
  }
}

function findNode22() {
  // 1) WorkBuddy 托管 Node（版本目录扫描，取最高版本）
  const wbDir = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions');
  try {
    const vers = fs.readdirSync(wbDir)
      .filter((d) => /^\d+\.\d+/.test(d))
      .sort((a, b) => Number(b.split('.')[0]) - Number(a.split('.')[0]));
    for (const v of vers) {
      const bin = path.join(wbDir, v, 'node.exe');
      if (fs.existsSync(bin) && nodeMajorOf(bin) >= 22) return bin;
    }
  } catch { /* 目录不存在 */ }
  // 2) 常见安装位置
  for (const bin of ['C:/Program Files/nodejs/node.exe', 'C:/Program Files (x86)/nodejs/node.exe']) {
    if (fs.existsSync(bin) && nodeMajorOf(bin) >= 22) return bin;
  }
  return null;
}

if (major >= 22) {
  const r = spawnSync(process.execPath, ['scripts/dev.js'], { stdio: 'inherit', cwd: root, env: process.env });
  process.exitCode = r.status ?? 0;
} else {
  const bin = findNode22();
  if (!bin) {
    console.error(`\n❌ 当前 Node 为 v${process.versions.node}，server 需要 Node 22+（内置 node:sqlite）。`);
    console.error('   未找到可用的 Node 22+。请安装 Node 22 LTS，或安装 better-sqlite3：npm --prefix server install better-sqlite3\n');
    process.exit(1);
  }
  const binDir = path.dirname(bin);
  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  };
  console.log(`ℹ️  当前 Node v${process.versions.node} < 22，已自动切换到 ${bin}（${String(spawnSync(bin, ['-v'], { encoding: 'utf8' }).stdout).trim()}）`);
  const r = spawnSync(bin, ['scripts/dev.js'], { stdio: 'inherit', cwd: root, env });
  process.exitCode = r.status ?? 0;
}
