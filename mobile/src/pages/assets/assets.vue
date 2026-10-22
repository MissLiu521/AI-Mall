<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, toast, requireLogin } from '@/store';

const auth = useAuth();
const tab = ref<'coupon' | 'fav' | 'foot' | 'team'>('coupon');
const loading = ref(true);

const points = ref<any>(null);
const coupons = ref<any[]>([]);
const favs = ref<any[]>([]);
const footGroups = ref<any[]>([]);
const teams = ref<any[]>([]);
const couponStatus = ref<'unused' | 'used' | 'expired'>('unused');

const unusedCount = computed(() => coupons.value.filter((c) => c.status === 'unused').length);

onLoad(async () => {
  if (!requireLogin(auth)) { loading.value = false; return; }
  await loadAll();
  loading.value = false;
});
onShow(() => { if (auth.isLoggedIn && !loading.value) loadAll(); });

async function loadAll() {
  await Promise.all([loadPoints(), loadCoupons(), loadFavs(), loadFoot(), loadTeams()]);
}

async function loadPoints() { try { points.value = await api.points(); } catch { /* ignore */ } }
async function loadCoupons() { try { coupons.value = (await api.myCoupons()) as any[]; } catch { /* ignore */ } }
async function loadFavs() { try { favs.value = ((await api.favorites()) as any).items; } catch { /* ignore */ } }
async function loadFoot() { try { footGroups.value = ((await api.footprints()) as any).groups; } catch { /* ignore */ } }
async function loadTeams() { try { teams.value = (await api.myTeams()) as any[]; } catch { /* ignore */ } }

const shownCoupons = computed(() => coupons.value.filter((c) => c.status === couponStatus.value));

const COUPON_TABS = [
  { k: 'unused', t: '可用' },
  { k: 'used', t: '已用' },
  { k: 'expired', t: '已过期' },
];
function setCouponStatus(k: string) { couponStatus.value = k as any; }

function goProduct(id: number) { uni.navigateTo({ url: `/pages/detail/detail?id=${id}` }); }

async function unfav(p: any) {
  try { await api.toggleFavorite(p.id); toast.info('已取消收藏'); await loadFavs(); } catch (e: any) { toast.err(e.message); }
}

function clearFoot() {
  uni.showModal({
    title: '清空足迹',
    content: '清空后不可恢复，确定吗？',
    success: async (r) => {
      if (!r.confirm) return;
      try { await api.clearFootprints(); footGroups.value = []; toast.ok('已清空'); } catch (e: any) { toast.err(e.message); }
    },
  });
}

const teamStatus = (s: string) =>
  s === 'success' ? '已成团' : s === 'failed' ? '未成团（已退款）' : '凑人中';
</script>

<template>
  <view class="page">
    <!-- 会员资产卡 -->
    <view class="member">
      <view class="m-head">
        <view class="grow">
          <view class="row" style="gap: 12rpx">
            <text class="m-level">{{ points?.level?.label || '普通会员' }}</text>
            <text v-if="points?.level?.freeShip" class="badge badge-warning">全场包邮</text>
          </view>
          <text class="m-spent">累计消费 ¥{{ points?.totalSpent?.toFixed(2) || '0.00' }}</text>
        </view>
        <view class="m-points">
          <text class="m-points-num mono">{{ points?.points || 0 }}</text>
          <text class="m-points-lbl">积分 ≈ ¥{{ points?.cashValue?.toFixed(2) || '0.00' }}</text>
        </view>
      </view>
      <view v-if="points?.next" class="m-next">
        <text class="m-next-txt">再消费 ¥{{ (points.next.needCents / 100).toFixed(0) }} 升级 {{ points.next.label }}（{{ (points.next.rate * 10).toFixed(1) }} 折）</text>
      </view>
      <view class="m-tip">100 积分 = 1 元，单笔最多抵 30%</view>
    </view>

    <view class="tabs">
      <text class="tab" :class="{ on: tab === 'coupon' }" @tap="tab = 'coupon'">券包{{ unusedCount ? '(' + unusedCount + ')' : '' }}</text>
      <text class="tab" :class="{ on: tab === 'fav' }" @tap="tab = 'fav'">收藏 {{ favs.length }}</text>
      <text class="tab" :class="{ on: tab === 'foot' }" @tap="tab = 'foot'">足迹</text>
      <text class="tab" :class="{ on: tab === 'team' }" @tap="tab = 'team'">拼团</text>
    </view>

    <!-- 券包 -->
    <template v-if="tab === 'coupon'">
      <view class="sub-tabs">
        <text v-for="s in COUPON_TABS" :key="s.k"
              class="sub-tab" :class="{ on: couponStatus === s.k }" @tap="setCouponStatus(s.k)">{{ s.t }}</text>
      </view>
      <view v-for="c in shownCoupons" :key="c.id" class="cpn card" :class="{ off: c.status !== 'unused' }">
        <view class="cpn-left">
          <text class="cpn-amount">
            {{ c.type === 'free_ship' ? '免邮' : c.type === 'discount' ? (c.value / 10).toFixed(1) + '折' : '¥' + (c.value / 100).toFixed(0) }}
          </text>
          <text class="cpn-cond">{{ c.threshold ? '满 ' + c.threshold : '无门槛' }}</text>
        </view>
        <view class="grow">
          <text class="cpn-title">{{ c.title }}</text>
          <text class="dim" style="font-size: 20rpx">{{ c.category }} · {{ c.rule }}</text>
          <text class="dim" style="font-size: 18rpx; display: block; margin-top: 4rpx">有效期至 {{ c.expireAt || '长期' }}</text>
        </view>
        <view class="cpn-act" @tap="uni.navigateTo({ url: '/pages/promo/promo' })">{{ c.status === 'unused' ? '去使用' : '已失效' }}</view>
      </view>
      <view v-if="!shownCoupons.length" class="empty"><text>这里还没有券</text></view>
    </template>

    <!-- 收藏 -->
    <template v-if="tab === 'fav'">
      <view v-for="p in favs" :key="p.id" class="row-card card" @tap="goProduct(p.id)">
        <view class="thumb"><text class="thumb-emoji">{{ p.image || '📦' }}</text></view>
        <view class="grow">
          <text class="r-title">{{ p.title }}</text>
          <text v-if="p.priceDrop" class="drop">比收藏时降了 ¥{{ p.priceDrop }}</text>
          <view class="row" style="gap: 10rpx; align-items: baseline; margin-top: 6rpx">
            <text class="price">¥{{ p.price }}</text>
            <text v-if="p.compareAt" class="old">¥{{ p.compareAt }}</text>
          </view>
        </view>
        <text class="r-act" @tap.stop="unfav(p)">取消收藏</text>
      </view>
      <view v-if="!favs.length" class="empty"><text>还没有收藏商品</text></view>
    </template>

    <!-- 足迹 -->
    <template v-if="tab === 'foot'">
      <view class="row-between" style="padding: 0 6rpx 14rpx">
        <text class="dim" style="font-size: 22rpx">按浏览时间分组</text>
        <text v-if="footGroups.length" class="clear" @tap="clearFoot">清空足迹</text>
      </view>
      <view v-for="g in footGroups" :key="g.day" class="foot-group">
        <text class="day">{{ g.label }}</text>
        <view class="foot-items">
          <view v-for="p in g.items" :key="p.id" class="foot-item" @tap="goProduct(p.id)">
            <view class="foot-thumb"><text class="thumb-emoji">{{ p.image || '📦' }}</text></view>
            <text class="foot-price mono">¥{{ p.price }}</text>
          </view>
        </view>
      </view>
      <view v-if="!footGroups.length" class="empty"><text>还没有浏览记录</text></view>
    </template>

    <!-- 拼团 -->
    <template v-if="tab === 'team'">
      <view v-for="t in teams" :key="t.teamId" class="row-card card" @tap="goProduct(t.productId)">
        <view class="thumb"><text class="thumb-emoji">{{ t.image || '📦' }}</text></view>
        <view class="grow">
          <text class="r-title">{{ t.title }}</text>
          <text class="dim" style="font-size: 20rpx">{{ t.joined }}/{{ t.required }} 人 · {{ t.need > 0 ? '还差 ' + t.need + ' 人' : '人数已满' }}</text>
          <view class="row" style="gap: 10rpx; align-items: baseline; margin-top: 6rpx">
            <text class="price">¥{{ t.price }}</text>
            <text class="badge" :class="t.status === 'success' ? 'badge-success' : t.status === 'failed' ? 'badge-muted' : 'badge-warning'">
              {{ teamStatus(t.status) }}
            </text>
          </view>
        </view>
        <text class="dim" style="font-size: 18rpx">{{ t.expireAt }}</text>
      </view>
      <view v-if="!teams.length" class="empty">
        <text>还没有参与拼团</text>
        <view class="btn btn-primary btn-sm" style="display:inline-flex; margin-top: 20rpx" @tap="uni.navigateTo({ url: '/pages/promo/promo?tab=group' })">去拼团</view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { padding: 20rpx 20rpx 60rpx; }

.member {
  background: linear-gradient(135deg, #2f5bea, #6b4ef5);
  border-radius: 24rpx;
  padding: 30rpx 28rpx;
  color: #fff;
  margin-bottom: 20rpx;
}
.m-head { display: flex; align-items: center; }
.m-level { font-size: 30rpx; font-weight: 600; }
.m-spent { display: block; font-size: 20rpx; opacity: 0.85; margin-top: 6rpx; }
.m-points { text-align: right; }
.m-points-num { display: block; font-size: 46rpx; font-weight: 600; }
.m-points-lbl { font-size: 18rpx; opacity: 0.85; }
.m-next { background: rgba(255, 255, 255, 0.16); border-radius: 12rpx; padding: 12rpx 16rpx; margin-top: 18rpx; }
.m-next-txt { font-size: 20rpx; }
.m-tip { font-size: 18rpx; opacity: 0.75; margin-top: 12rpx; }

.tabs { display: flex; gap: 10rpx; margin-bottom: 16rpx; }
.tab {
  flex: 1; text-align: center; font-size: 24rpx; color: #5a6072;
  background: #fff; border: 1rpx solid #e4e7ee; border-radius: 14rpx; padding: 14rpx 0;
}
.tab.on { color: #fff; background: #2f5bea; border-color: #2f5bea; font-weight: 500; }

.sub-tabs { display: flex; gap: 12rpx; margin-bottom: 14rpx; }
.sub-tab { font-size: 22rpx; color: #5a6072; padding: 6rpx 22rpx; border-radius: 999rpx; background: #f1f3f7; }
.sub-tab.on { background: #edf1fe; color: #2f5bea; }

.cpn { display: flex; align-items: center; gap: 16rpx; padding: 22rpx; margin-bottom: 14rpx; }
.cpn.off { opacity: 0.55; }
.cpn-left { width: 140rpx; text-align: center; border-right: 1rpx dashed #e4e7ee; }
.cpn-amount { display: block; font-size: 36rpx; font-weight: 600; color: #d93b4a; }
.cpn-cond { font-size: 18rpx; color: #8d94a6; }
.cpn-title { display: block; font-size: 26rpx; font-weight: 500; }
.cpn-act { font-size: 20rpx; color: #2f5bea; border: 1rpx solid #2f5bea; border-radius: 999rpx; padding: 6rpx 16rpx; }

.row-card { display: flex; align-items: center; gap: 16rpx; padding: 20rpx; margin-bottom: 14rpx; }
.thumb {
  width: 120rpx; height: 120rpx; border-radius: 14rpx; background: #f1f3f7;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.thumb-emoji { font-size: 54rpx; }
.r-title {
  font-size: 26rpx; font-weight: 500;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.r-act { font-size: 20rpx; color: #8d94a6; }
.old { font-size: 20rpx; color: #8d94a6; text-decoration: line-through; }
.drop { font-size: 20rpx; color: #d93b4a; }

.clear { font-size: 22rpx; color: #2f5bea; }
.foot-group { margin-bottom: 22rpx; }
.day { font-size: 22rpx; color: #8d94a6; }
.foot-items { display: flex; flex-wrap: wrap; gap: 14rpx; margin-top: 12rpx; }
.foot-item { width: 150rpx; }
.foot-thumb {
  width: 150rpx; height: 150rpx; border-radius: 14rpx; background: #f1f3f7;
  display: flex; align-items: center; justify-content: center;
}
.foot-price { display: block; font-size: 22rpx; color: #1a1d24; margin-top: 6rpx; text-align: center; }
</style>
