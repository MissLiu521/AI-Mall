/**
 * 一键启动开发环境：后端 + 前端
 * 用法：npm run dev
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ensureDeps = (dir, label) => {
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    console.log(`\n⚠️  ${label} 依赖未安装，先执行 npm install ...\n`);
    const r = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], {
      cwd: dir, stdio: 'inherit', shell: process.platform === 'win32',
    });
    return new Promise((res, rej) => r.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${label} 安装失败`)))));
  }
  return Promise.resolve();
};

const run = (name, cmd, args, cwd, color) => {
  const p = spawn(cmd, args, { cwd, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = (stream, isErr) => stream.on('data', (d) => {
    const text = d.toString().trimEnd();
    if (text) console.log(text.split('\n').map((l) => `${tag} ${l}`).join('\n'));
    void isErr;
  });
  pipe(p.stdout);
  pipe(p.stderr, true);
  p.on('exit', (code) => console.log(`${tag} 进程退出，code=${code}`));
  return p;
};

(async () => {
  console.log('\n\x1b[1m  AI Mall 启动中…\x1b[0m\n');
  await ensureDeps(path.join(ROOT, 'server'), '后端');
  await ensureDeps(path.join(ROOT, 'web'), '前端');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run('API', process.execPath, ['src/index.js'], path.join(ROOT, 'server'), '36');
  await new Promise((r) => setTimeout(r, 1200));
  run('WEB', npm, ['run', 'dev'], path.join(ROOT, 'web'), '35');

  console.log('\n  C 端商城   →  http://localhost:5173/shop');
  console.log('  B 端后台   →  http://localhost:5173/admin');
  console.log('  商家账号   →  admin@mall.dev / admin123');
  console.log('  买家账号   →  demo@mall.dev / demo123\n');
})();
