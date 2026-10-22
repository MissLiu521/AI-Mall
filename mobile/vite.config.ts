import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import os from 'node:os';

/**
 * 选一个"真实"的局域网 IPv4：
 * 跳过回环与虚拟网卡（VMware / VirtualBox / Hyper-V 等），优先 192.168.x，其次 10.x、172.16-31.x。
 * 换 WiFi / 换 IP 后重新编译即可自动跟随，无需改代码。
 */
function lanIPv4(): string {
  const candidates: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      if (/vmware|virtualbox|vethernet|hyper-v|loopback|bluetooth|tap|tun/i.test(name)) continue;
      candidates.push({ name, address: ni.address });
    }
  }
  const score = (ip: string) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  candidates.sort((a, b) => score(a.address) - score(b.address));
  return candidates[0]?.address || '127.0.0.1';
}

const API_PORT = process.env.API_PORT || '3001';
// 后端不在本机时用环境变量覆盖：VITE_API_BASE_URL=http://x.x.x.x:3001/api
const API_BASE = process.env.VITE_API_BASE_URL || `http://${lanIPv4()}:${API_PORT}/api`;

console.log(`[api] 小程序端接口地址 → ${API_BASE}`);

export default defineConfig({
  plugins: [uni()],
  // 编译期注入：小程序端读不到运行时环境变量，只能在这里固化
  define: { __API_BASE__: JSON.stringify(API_BASE) },
  server: {
    // 0.0.0.0 让手机在同一局域网内可以访问
    host: '0.0.0.0',
    port: 5180,
    strictPort: false,
    proxy: {
      // H5 端 BASE_URL 为相对路径 /api，这里转发到后端
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
    },
  },
});
