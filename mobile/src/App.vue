<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { useAuth, useCart } from './store';

onLaunch(async () => {
  const auth = useAuth();
  await auth.bootstrap();
  if (auth.isLoggedIn) await useCart().refresh();
});
</script>

<style>
/* ── 全局样式（多端通用，单位用 rpx 适配） ── */
page {
  background: #f7f8fa;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx;
  color: #1a1d24;
  line-height: 1.6;
}

view, text, scroll-view, input, textarea, button, image { box-sizing: border-box; }

.row { display: flex; align-items: center; }
.row-between { display: flex; align-items: center; justify-content: space-between; }
.col { display: flex; flex-direction: column; }
.grow { flex: 1; }
.mono { font-family: 'SF Mono', Consolas, monospace; font-variant-numeric: tabular-nums; }
.dim { color: #8d94a6; }
.muted { color: #5a6072; }
.price { color: #d93b4a; font-weight: 600; font-family: 'SF Mono', Consolas, monospace; }

.card {
  background: #fff;
  border-radius: 20rpx;
  border: 1rpx solid #e4e7ee;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 84rpx;
  border-radius: 16rpx;
  font-size: 30rpx;
  font-weight: 500;
  border: none;
}
.btn::after { border: none; }
.btn-primary { background: #2f5bea; color: #fff; }
.btn-ai { background: #6b4ef5; color: #fff; }
.btn-ghost { background: #fff; color: #1a1d24; border: 1rpx solid #d3d8e3; }
.btn-block { width: 100%; }
.btn-sm { height: 60rpx; font-size: 24rpx; padding: 0 24rpx; border-radius: 12rpx; }

.badge {
  display: inline-flex;
  align-items: center;
  height: 36rpx;
  padding: 0 14rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  line-height: 1;
}
.badge-primary { background: #edf1fe; color: #2f5bea; }
.badge-ai { background: #f1eefe; color: #6b4ef5; }
.badge-success { background: #e8f7ef; color: #12a05c; }
.badge-warning { background: #fdf3e4; color: #e08b1e; }
.badge-danger { background: #fdecee; color: #d93b4a; }
.badge-muted { background: #f1f3f7; color: #5a6072; }

.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
.safe-top { padding-top: env(safe-area-inset-top); }

.empty { padding: 120rpx 40rpx; text-align: center; color: #8d94a6; font-size: 26rpx; }
.empty-icon { font-size: 72rpx; margin-bottom: 20rpx; opacity: 0.5; }

.divider { height: 1rpx; background: #e4e7ee; }
</style>
