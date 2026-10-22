import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 代理目标必须用 127.0.0.1 而不是 localhost：
// Node 18+ 解析 localhost 会优先返回 IPv6 的 ::1，若后端只监听了 IPv4，
// 代理连接会被拒绝（ECONNREFUSED），表现为前端所有 /api 请求 500。
const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
});
