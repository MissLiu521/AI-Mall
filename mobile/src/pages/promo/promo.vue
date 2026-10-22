<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, toast, requireLogin } from '@/store';
import type { Coupon, FlashSale, GroupBuy } from '@/api/types';

const auth = useAuth();
const tab = ref<'coupon' | 'flash' | 'group'>('coupon');
const coupons = ref<Coupon[]>([]);
const flashSales = ref<FlashSale[]>([]);
const groupBuys = ref<GroupBuy[]>([]);
const loading = ref(true);
const claiming = ref<number | null>(null);

// 用服务端时间做基准，避免手机时钟不准导致倒计时错乱
const skew = ref(0);
const now = ref(Date.now());

// 拼团弹层
const detail = ref<any>(null);
const address = ref('');
const submitting = ref(false);
const teamId = ref<number | null>(null);

const remainOf = (endAt: string) => Math.max(0, new Date(endAt).getTime() - (now.value + skew.value));
const clockOf = (endAt: string) => {
  const s = Math.floor(remainOf(endAt) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const myCouponCount = computed(() => coupons.value.filter((c) => c.claimedByMe > 0).length);

onLoad(async (opt: any) => {
  if (opt.tab === 'flash' || opt.tab === 'group') tab.value = opt.tab;
  await Promise.all([loadCoupons(), loadFlash(), loadGroup()]);
  loading.value = false;
});

const timer = setInterval(() => { now.value = Date.now(); }, 1000);
onUnload(() => clearInterval(timer));

async function loadCoupons() {
  try { coupons.value = (await api.coupons()) as Coupon[]; } catch (e: any) { toast.err(e.message); }
}
async function loadFlash() {
  try {
    const list = (await api.flashSales()) as FlashSale[];
    if (list[0]) skew.value = list[0].serverNow - Date.now();
    flashSales.value = list;
  } catch (e: any) { toast.err(e.message); }
}
async function loadGroup() {
  try { groupBuys.value = (await api.groupBuys()) as GroupBuy[]; } catch (e: any) { toast.err(e.message); }
}

async function claim(c: Coupon) {
  if (!requireLogin(auth)) return;
  if (!c.canClaim) { toast.info(c.soldOut ? '已被领完' : `每人限领 ${c.perUser} 张`); return; }
  claiming.value = c.id;
  try {
    await api.claimCoupon(c.id);
    toast.ok('已领取');
    await loadCoupons();
  } catch (e: any) { toast.err(e.message); }
  finally { claiming.value = null; }
}

async function openGroup(g: GroupBuy) {
  teamId.value = null;
  try {
    detail.value = await api.groupBuy(g.id);
    if (auth.isLoggedIn) {
      const list: any[] = (await api.addresses()) as any[];
      const def = list.find((a) => a.isDefault) || list[0];
      address.value = def ? `${def.region} ${def.detail}（${def.name} ${def.phone}）` : '';
    }
  } catch (e: any) { toast.err(e.message); }
}

async function joinGroup() {
  if (!requireLogin(auth) || !detail.value) return;
  if (address.value.trim().length < 5) { toast.err('请填写完整收货地址'); return; }
  submitting.value = true;
  try {
    const idem = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const order: any = await api.createGroupOrder({
      groupBuyId: detail.value.id,
      // 有 teamId 就是参团，没有就是自己开团
      ...(teamId.value ? { teamId: teamId.value } : {}),
      address: address.value.trim(),
    }, idem);
    detail.value = null;
    toast.ok(teamId.value ? '已加入该团，支付后等待成团' : '拼团订单已创建，支付后开始凑人');
    setTimeout(() => uni.navigateTo({ url: `/pages/order-detail/order-detail?id=${order.id}` }), 500);
  } catch (e: any) { toast.err(e.message); }
  finally { submitting.value = false; }
}

/** 直接参团：省掉"先开团再凑人"这一步 */
function joinTeam(t: any) {
  if (!requireLogin(auth)) return;
  if (t.joinedByMe) { toast.info('你已经在这个团里了'); return; }
  teamId.value = t.id;
  joinGroup();
}

function goProduct(id: number) { uni.navigateTo({ url: `/pages/detail/detail?id=${id}` }); }
</script>

<template>
  <view class="page">
    <view class="tabs">
      <text class="tab" :class="{ on: tab === 'coupon' }" @tap="tab = 'coupon'">领券中心</text>
      <text class="tab" :class="{ on: tab === 'flash' }" @tap="tab = 'flash'">限时秒杀</text>
      <text class="tab" :class="{ on: tab === 'group' }" @tap="tab = 'group'">拼团</text>
    </view>

    <!-- 领券中心 -->
    <template v-if="tab === 'coupon'">
      <view class="head-tip">已领 {{ myCouponCount }} 张 · 结算时自动提示可用券</view>
      <view v-for="c in coupons" :key="c.id" class="cpn card">
        <view class="cpn-left">
          <text class="cpn-amount">
            {{ c.type === 'free_ship' ? '免邮' : c.type === 'discount' ? (c.value / 10).toFixed(1) + '折' : '¥' + (c.value / 100).toFixed(0) }}
          </text>
          <text class="cpn-cond">{{ c.threshold ? '满 ' + c.threshold + ' 可用' : '无门槛' }}</text>
        </view>
        <view class="cpn-mid">
          <text class="cpn-title">{{ c.title }}</text>
          <text class="dim" style="font-size: 20rpx">{{ c.category }} · {{ c.rule }}</text>
          <view class="cpn-bar">
            <view class="cpn-bar-fill" :style="{ width: Math.min(100, Math.round((c.claimed / (c.total || 1)) * 100)) + '%' }" />
          </view>
          <text class="dim" style="font-size: 18rpx">已领 {{ c.claimed }}/{{ c.total || '不限' }}</text>
        </view>
        <view
          class="cpn-btn"
          :class="{ dis: !c.canClaim }"
          @tap="claim(c)"
        >{{ claiming === c.id ? '领取中' : c.soldOut ? '已抢光' : c.canClaim ? (c.claimedByMe ? '再领一张' : '领取') : '已领满' }}</view>
      </view>
      <view v-if="!loading && !coupons.length" class="empty"><text>暂无可领的券</text></view>
    </template>

    <!-- 秒杀 -->
    <template v-if="tab === 'flash'">
      <view v-for="f in flashSales" :key="f.id" class="fs card" @tap="goProduct(f.productId)">
        <view class="fs-thumb"><text class="fs-emoji">{{ f.image || '📦' }}</text></view>
        <view class="grow">
          <text class="fs-name">{{ f.productName }}</text>
          <text class="dim" style="font-size: 20rpx">{{ f.campaign }} · 限购 {{ f.limitPerUser }} 件</text>
          <view class="fs-bar"><view class="fs-bar-fill" :style="{ width: f.progress + '%' }" /></view>
          <text class="dim" style="font-size: 18rpx">已抢 {{ f.progress }}%，剩 {{ f.remain }} 件</text>
          <view class="row" style="gap: 12rpx; align-items: baseline; margin-top: 8rpx">
            <text class="price" style="font-size: 34rpx">¥{{ f.price }}</text>
            <text class="old">¥{{ f.origin }}</text>
            <text class="badge badge-danger">{{ f.off }}% OFF</text>
          </view>
        </view>
        <view class="fs-right">
          <text class="fs-clock mono">{{ clockOf(f.endAt) }}</text>
          <text class="dim" style="font-size: 18rpx">后结束</text>
          <view class="fs-go">去抢</view>
        </view>
      </view>
      <view v-if="!loading && !flashSales.length" class="empty"><text>当前没有进行中的秒杀</text></view>
    </template>

    <!-- 拼团 -->
    <template v-if="tab === 'group'">
      <view v-for="g in groupBuys" :key="g.id" class="gp card">
        <view class="fs-thumb"><text class="fs-emoji">{{ g.image || '📦' }}</text></view>
        <view class="grow">
          <text class="fs-name">{{ g.productTitle }}</text>
          <view class="row" style="gap: 12rpx; align-items: baseline; margin-top: 6rpx">
            <text class="price" style="font-size: 34rpx">¥{{ g.price }}</text>
            <text class="old">¥{{ g.origin }}</text>
          </view>
          <text class="dim" style="font-size: 20rpx">{{ g.required }} 人成团 · {{ g.expireHours }} 小时内 · 省 ¥{{ g.save }}</text>
        </view>
        <view class="gp-right">
          <text class="dim" style="font-size: 18rpx">{{ g.teams }} 个团在凑</text>
          <view class="gp-go" @tap="openGroup(g)">去拼团</view>
        </view>
      </view>
      <view v-if="!loading && !groupBuys.length" class="empty"><text>暂无拼团活动</text></view>
    </template>

    <view class="foot-tip">促销价与库存实时校验，成团失败自动退款</view>

    <!-- 拼团弹层 -->
    <view v-if="detail" class="mask" @tap="detail = null">
      <view class="sheet" @tap.stop>
        <text class="sheet-title">{{ detail.productTitle }}</text>
        <view class="row" style="gap: 14rpx; align-items: baseline; margin: 12rpx 0">
          <text class="price" style="font-size: 44rpx">¥{{ detail.price }}</text>
          <text class="old">原价 ¥{{ detail.origin }}</text>
          <text class="badge badge-danger">省 ¥{{ detail.save }}</text>
        </view>
        <text class="dim" style="font-size: 22rpx; display: block; line-height: 1.7">
          {{ detail.required }} 人成团，{{ detail.expireHours }} 小时内未成团自动原路退款。
        </text>
        <view v-if="detail.teams?.length" class="teams">
          <text class="teams-title">正在凑的团</text>
          <view v-for="t in detail.teams.slice(0, 3)" :key="t.id" class="team">
            <view class="grow">
              <text class="team-txt">还差 {{ t.need }} 人 · {{ t.members.length }} 人已加入</text>
              <text class="dim" style="font-size: 20rpx; display: block">{{ t.expireAt }}</text>
            </view>
            <view class="team-btn" :class="{ dis: t.joinedByMe }" @tap="joinTeam(t)">
              {{ t.joinedByMe ? '已参与' : '参团' }}
            </view>
          </view>
        </view>
        <text class="field-label">收货地址</text>
        <textarea v-model="address" class="textarea" placeholder="省 市 区 详细地址（姓名 手机号）" maxlength="300" />
        <view class="sheet-actions">
          <view class="btn btn-ghost grow" @tap="detail = null">取消</view>
          <view class="btn btn-primary grow" :class="{ dis: submitting }" @tap="joinGroup">
            {{ submitting ? '提交中…' : (teamId ? '加入该团' : '自己开团') }}
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 20rpx 20rpx 60rpx; }

.tabs { display: flex; gap: 12rpx; margin-bottom: 20rpx; }
.tab {
  flex: 1; text-align: center;
  font-size: 26rpx; color: #5a6072;
  background: #fff; border: 1rpx solid #e4e7ee;
  border-radius: 14rpx; padding: 16rpx 0;
}
.tab.on { color: #fff; background: #2f5bea; border-color: #2f5bea; font-weight: 500; }

.head-tip { font-size: 22rpx; color: #8d94a6; padding: 0 8rpx 16rpx; }

.cpn { display: flex; align-items: center; gap: 18rpx; padding: 22rpx; margin-bottom: 16rpx; }
.cpn-left { width: 150rpx; text-align: center; border-right: 1rpx dashed #e4e7ee; }
.cpn-amount { display: block; font-size: 40rpx; font-weight: 600; color: #d93b4a; }
.cpn-cond { font-size: 18rpx; color: #8d94a6; }
.cpn-mid { flex: 1; }
.cpn-title { display: block; font-size: 26rpx; font-weight: 500; }
.cpn-bar { height: 8rpx; background: #f1f3f7; border-radius: 999rpx; overflow: hidden; margin: 8rpx 0 6rpx; width: 80%; }
.cpn-bar-fill { height: 100%; background: #f0b429; }
.cpn-btn {
  font-size: 22rpx; color: #fff; background: #d93b4a;
  padding: 10rpx 22rpx; border-radius: 999rpx;
}
.cpn-btn.dis { background: #f1f3f7; color: #8d94a6; }

.fs, .gp { display: flex; gap: 18rpx; padding: 20rpx; margin-bottom: 16rpx; align-items: center; }
.fs-thumb {
  width: 140rpx; height: 140rpx; border-radius: 14rpx;
  background: #f1f3f7; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.fs-emoji { font-size: 62rpx; }
.fs-name {
  font-size: 26rpx; font-weight: 500; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.old { font-size: 20rpx; color: #8d94a6; text-decoration: line-through; }
.fs-bar { height: 10rpx; background: #fdecee; border-radius: 999rpx; overflow: hidden; margin: 10rpx 0 6rpx; }
.fs-bar-fill { height: 100%; background: #d93b4a; }
.fs-right, .gp-right { display: flex; flex-direction: column; align-items: center; gap: 6rpx; width: 130rpx; }
.fs-clock { font-size: 24rpx; color: #d93b4a; background: #fdecee; padding: 4rpx 12rpx; border-radius: 8rpx; }
.fs-go, .gp-go {
  font-size: 22rpx; color: #fff; background: #d93b4a;
  padding: 10rpx 24rpx; border-radius: 999rpx; margin-top: 8rpx;
}
.gp-go { background: #2f5bea; }

.foot-tip { text-align: center; font-size: 20rpx; color: #c2c8d4; padding: 30rpx 0; }

.mask {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex; align-items: flex-end; z-index: 200;
}
.sheet {
  width: 100%;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  padding: 34rpx 30rpx calc(30rpx + env(safe-area-inset-bottom));
}
.sheet-title { font-size: 30rpx; font-weight: 600; display: block; }
.teams { margin: 18rpx 0; }
.teams-title { font-size: 22rpx; color: #8d94a6; }
.team {
  display: flex; align-items: center; justify-content: space-between; gap: 16rpx;
  background: #f7f8fa; border-radius: 12rpx; padding: 14rpx 18rpx; margin-top: 10rpx;
}
.team-txt { font-size: 22rpx; }
.team-btn {
  flex: none; font-size: 22rpx; color: #fff; background: #2f5bea;
  border-radius: 999rpx; padding: 8rpx 24rpx;
}
.team-btn.dis { background: #c3c8d4; }
.field-label { font-size: 22rpx; color: #8d94a6; display: block; margin: 12rpx 0 10rpx; }
.textarea {
  width: 100%; height: 160rpx;
  background: #f7f8fa; border: 1rpx solid #e4e7ee;
  border-radius: 14rpx; padding: 18rpx; font-size: 26rpx;
  box-sizing: border-box;
}
.sheet-actions { display: flex; gap: 16rpx; margin-top: 24rpx; }
.btn.dis { opacity: 0.5; }
</style>
