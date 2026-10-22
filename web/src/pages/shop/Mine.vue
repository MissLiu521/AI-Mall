<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { useAuth, useToast } from '../../store';
import { formatTime } from '../../utils/format';

const router = useRouter();
const auth = useAuth();
const toast = useToast();

const tab = ref<'fav' | 'foot' | 'coupon' | 'team' | 'wallet'>('fav');
const points = ref<any>(null);
const wallet = ref<any>(null);
const favorites = ref<any[]>([]);
const footprints = ref<any[]>([]);
const coupons = ref<any[]>([]);
const teams = ref<any[]>([]);
const loading = ref(true);

async function loadAll() {
  loading.value = true;
  try {
    const [p, f, fp, c, t, w] = await Promise.all([
      api.points(), api.favorites(), api.footprints(), api.myCoupons(), api.myTeams(), api.wallet(),
    ]);
    points.value = p;
    favorites.value = (f as any).items;
    footprints.value = (fp as any).groups;
    coupons.value = c as any;
    teams.value = t as any;
    wallet.value = w;
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(loadAll);

const couponTabs = ref<'unused' | 'used' | 'expired'>('unused');
const shownCoupons = computed(() => coupons.value.filter((c) => c.status === couponTabs.value));

async function unfav(id: number) {
  try {
    await api.toggleFavorite(id);
    favorites.value = favorites.value.filter((x) => x.id !== id);
    toast.push('已取消收藏', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
}

async function clearFoot() {
  if (!window.confirm('清空全部浏览足迹？')) return;
  await api.clearFootprints();
  footprints.value = [];
  toast.push('足迹已清空', 'success');
}

const go = (id: number) => router.push(`/product/${id}`);
const levelText = computed(() => points.value?.level?.label || '普通会员');
</script>

<template>
  <div class="mine">
    <div class="member-card">
      <div class="mc-left">
        <div class="avatar">{{ (auth.user?.name || 'U').slice(0, 1) }}</div>
        <div>
          <div class="name">{{ auth.user?.name || '未登录' }}</div>
          <div class="level">{{ levelText }} · {{ auth.user?.email }}</div>
        </div>
      </div>
      <div class="mc-right">
        <div class="stat"><b>¥{{ wallet?.balance ?? '0.00' }}</b><span>余额（评价返现）</span></div>
        <div class="stat"><b>{{ points?.points ?? 0 }}</b><span>积分（≈¥{{ points?.cashValue ?? 0 }}）</span></div>
        <div class="stat"><b>{{ points?.totalSpent ?? 0 }}</b><span>累计消费</span></div>
        <div class="stat"><b>{{ coupons.filter(c => c.status === 'unused').length }}</b><span>可用券</span></div>
      </div>
    </div>

    <div v-if="points?.next" class="upgrade">
      再消费 <b>¥{{ (points.next.needCents / 100).toFixed(2) }}</b> 升级 {{ points.next.label }}，
      享 {{ (points.next.rate * 10).toFixed(1) }} 折 + 全场包邮
    </div>

    <div class="tabs">
      <button :class="['tab', tab === 'fav' && 'on']" @click="tab = 'fav'">我的收藏 ({{ favorites.length }})</button>
      <button :class="['tab', tab === 'foot' && 'on']" @click="tab = 'foot'">浏览足迹</button>
      <button :class="['tab', tab === 'wallet' && 'on']" @click="tab = 'wallet'">钱包 ¥{{ wallet?.balance ?? '0.00' }}</button>
      <button :class="['tab', tab === 'coupon' && 'on']" @click="tab = 'coupon'">优惠券 ({{ coupons.length }})</button>
      <button :class="['tab', tab === 'team' && 'on']" @click="tab = 'team'">我的拼团</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <!-- 收藏 -->
    <div v-else-if="tab === 'fav'">
      <div v-if="!favorites.length" class="empty">还没有收藏，去逛逛吧</div>
      <div class="grid">
        <div v-for="p in favorites" :key="p.id" class="pcard" @click="go(p.id)">
          <div class="pimg">{{ p.image }}</div>
          <div class="pname">{{ p.title }}</div>
          <div class="prow">
            <b>¥{{ p.price }}</b>
            <span v-if="p.priceDrop" class="drop">降 ¥{{ p.priceDrop }}</span>
          </div>
          <button class="btn btn-secondary btn-sm" @click.stop="unfav(p.id)">取消收藏</button>
        </div>
      </div>
    </div>

    <!-- 足迹 -->
    <div v-else-if="tab === 'foot'">
      <div class="foot-head">
        <span class="muted">共 {{ footprints.reduce((s, g) => s + g.items.length, 0) }} 条</span>
        <button v-if="footprints.length" class="link" @click="clearFoot">清空足迹</button>
      </div>
      <div v-if="!footprints.length" class="empty">还没有浏览记录</div>
      <div v-for="g in footprints" :key="g.day" class="day-group">
        <div class="day">{{ g.label }}</div>
        <div class="grid">
          <div v-for="p in g.items" :key="p.id + '-' + g.day" class="pcard" @click="go(p.id)">
            <div class="pimg">{{ p.image }}</div>
            <div class="pname">{{ p.title }}</div>
            <div class="prow"><b>¥{{ p.price }}</b><span class="muted">{{ formatTime(p.viewedAt) }}</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 券包 -->
    <div v-else-if="tab === 'coupon'">
      <div class="sub-tabs">
        <button v-for="s in (['unused', 'used', 'expired'] as const)" :key="s" :class="['sub', couponTabs === s && 'on']" @click="couponTabs = s">
          {{ s === 'unused' ? '未使用' : s === 'used' ? '已使用' : '已过期' }}
        </button>
      </div>
      <div v-if="!shownCoupons.length" class="empty">这里还没有券</div>
      <div class="coupon-list">
        <div v-for="c in shownCoupons" :key="c.id" class="ucoupon" :class="{ dim: c.status !== 'unused' }">
          <div class="u-left">
            <div class="u-val" v-if="c.type === 'reduce'"><i>¥</i>{{ c.value / 100 }}</div>
            <div class="u-val" v-else-if="c.type === 'discount'">{{ (c.value / 10).toFixed(1) }}<i>折</i></div>
            <div class="u-val small" v-else>免运费</div>
          </div>
          <div class="u-right">
            <div class="u-title">{{ c.title }}</div>
            <div class="u-rule">{{ c.rule }} · {{ c.category }}</div>
            <div class="u-exp">{{ c.expireAt ? '有效期至 ' + formatTime(c.expireAt).slice(0, 10) : '长期有效' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 钱包：评价返现余额与流水 -->
    <div v-else-if="tab === 'wallet'" class="wallet">
      <div class="wallet-card">
        <div class="wc-label">可用余额（元）</div>
        <div class="wc-amount">¥{{ wallet?.balance ?? '0.00' }}</div>
        <div class="wc-sub">
          累计返现 ¥{{ wallet?.totalIn ?? '0.00' }} · 已抵扣 ¥{{ wallet?.totalOut ?? '0.00' }}
        </div>
        <div class="wc-tip">评价晒图 / 视频即可返现，返现金额下单时可直接抵扣</div>
      </div>

      <h3 class="w-title">收支明细</h3>
      <div v-if="!wallet?.items?.length" class="empty">还没有返现记录，去评价一单试试</div>
      <div v-else class="w-list">
        <div v-for="w in wallet.items" :key="w.id" class="w-row">
          <div class="w-main">
            <div class="w-reason">{{ w.reason }}</div>
            <div class="w-time">{{ formatTime(w.createdAt) }}</div>
          </div>
          <div class="w-amount" :class="{ plus: w.deltaCents > 0 }">
            {{ w.deltaCents > 0 ? '+' : '' }}{{ w.delta }}
            <span class="w-bal">余额 ¥{{ (w.balanceCents / 100).toFixed(2) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 拼团 -->
    <div v-else>
      <div v-if="!teams.length" class="empty">还没有参与拼团</div>
      <div v-for="t in teams" :key="t.teamId" class="team">
        <div class="pimg">{{ t.image }}</div>
        <div class="t-info">
          <div class="pname">{{ t.title }}</div>
          <div class="muted">¥{{ t.price }} · {{ t.joined }}/{{ t.required }} 人</div>
        </div>
        <span class="badge" :class="t.status">{{ t.status === 'forming' ? `还差 ${t.need} 人` : t.status === 'success' ? '已成团' : '未成团' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mine { max-width: 1120px; margin: 0 auto; padding: 24px 20px 60px; }
.member-card { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap;
  background: linear-gradient(120deg, #1f2937, #374151); color: #fff; border-radius: 18px; padding: 24px 28px; }
.mc-left { display: flex; align-items: center; gap: 14px; }
.avatar { width: 52px; height: 52px; border-radius: 50%; background: #e53935; display: grid; place-items: center; font-size: 22px; font-weight: 700; }
.name { font-size: 18px; font-weight: 600; }
.level { font-size: 12px; opacity: .75; margin-top: 3px; }
.mc-right { display: flex; gap: 28px; }
.stat { text-align: center; }
.stat b { display: block; font-size: 20px; }
.stat span { font-size: 11px; opacity: .7; }
.upgrade { margin-top: 12px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
  padding: 10px 16px; border-radius: 10px; font-size: 13px; }

.tabs { display: flex; gap: 8px; margin: 20px 0 16px; flex-wrap: wrap; }
.tab { border: none; background: #f3f4f6; padding: 8px 18px; border-radius: 999px; cursor: pointer; font-size: 13px; color: #4b5563; }
.tab.on { background: #111827; color: #fff; }
.sub-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.sub { border: none; background: transparent; padding: 6px 12px; cursor: pointer; color: #6b7280; font-size: 13px; border-radius: 8px; }
.sub.on { background: #fee2e2; color: #b91c1c; }

/* 钱包 */
.wallet-card {
  background: linear-gradient(135deg, #fff7ed, #ffe4e6);
  border: 1px solid #fed7aa; border-radius: 16px; padding: 22px 24px;
}
.wc-label { font-size: 12px; color: #9a3412; }
.wc-amount { font-size: 34px; font-weight: 700; color: #9a3412; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
.wc-sub { font-size: 12px; color: #b45309; }
.wc-tip {
  margin-top: 14px; font-size: 12px; color: #9a3412;
  background: rgba(255,255,255,.6); border-radius: 8px; padding: 7px 10px;
}
.w-title { font-size: 14px; font-weight: 600; margin: 22px 0 10px; }
.w-list { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.w-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
.w-row:last-child { border-bottom: none; }
.w-main { flex: 1; }
.w-reason { font-size: 13px; color: #111827; }
.w-time { font-size: 11px; color: #9ca3af; margin-top: 2px; }
.w-amount { font-size: 15px; font-weight: 600; color: #6b7280; text-align: right; font-variant-numeric: tabular-nums; }
.w-amount.plus { color: #e53935; }
.w-bal { display: block; font-size: 10px; font-weight: 400; color: #9ca3af; margin-top: 2px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
.pcard { background: #fff; border-radius: 12px; padding: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.05); cursor: pointer; }
.pimg { height: 90px; background: #f9fafb; border-radius: 10px; display: grid; place-items: center; font-size: 34px; }
.pname { font-size: 13px; margin: 8px 0 4px; line-height: 1.4; height: 38px; overflow: hidden; }
.prow { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
.prow b { color: #e53935; }
.drop { color: #16a34a; font-size: 11px; }
.muted { color: #9ca3af; font-size: 12px; }
.foot-head { display: flex; justify-content: space-between; margin-bottom: 10px; }
.link { border: none; background: transparent; color: #e53935; cursor: pointer; font-size: 13px; }
.day-group { margin-bottom: 18px; }
.day { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
.coupon-list { display: flex; flex-direction: column; gap: 10px; }
.ucoupon { display: flex; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.ucoupon.dim { opacity: .5; }
.u-left { width: 92px; background: #e53935; color: #fff; display: grid; place-items: center; }
.u-val { font-size: 24px; font-weight: 700; }
.u-val i { font-size: 13px; font-style: normal; }
.u-val.small { font-size: 15px; }
.u-right { padding: 12px 14px; }
.u-title { font-weight: 600; font-size: 14px; }
.u-rule, .u-exp { font-size: 11px; color: #9ca3af; margin-top: 3px; }
.team { display: flex; align-items: center; gap: 14px; background: #fff; border-radius: 12px; padding: 12px;
  margin-bottom: 10px; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.t-info { flex: 1; }
.badge { font-size: 12px; padding: 3px 10px; border-radius: 99px; background: #f3f4f6; color: #4b5563; }
.badge.success { background: #dcfce7; color: #15803d; }
.badge.failed { background: #fee2e2; color: #b91c1c; }
.empty { text-align: center; padding: 50px; color: #9ca3af; }
</style>
