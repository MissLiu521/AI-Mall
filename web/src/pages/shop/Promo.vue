<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { useAuth, useToast } from '../../store';
import type { Coupon, FlashSale, GroupBuy } from '../../api/types';

const router = useRouter();
const auth = useAuth();
const toast = useToast();

const tab = ref<'coupon' | 'flash' | 'group'>('coupon');
const coupons = ref<Coupon[]>([]);
const flash = ref<FlashSale[]>([]);
const groups = ref<GroupBuy[]>([]);
const loading = ref(true);
const now = ref(Date.now());
let timer: number | undefined;

onMounted(async () => {
  try {
    const [c, f, g] = await Promise.all([api.coupons(), api.flashSales(), api.groupBuys()]);
    coupons.value = c as any;
    flash.value = f as any;
    groups.value = g as any;
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    loading.value = false;
  }
  timer = window.setInterval(() => { now.value = Date.now(); }, 1000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });

const pad = (n: number) => String(n).padStart(2, '0');
function countdown(endAt: string) {
  const ms = new Date(endAt).getTime() - now.value;
  if (ms <= 0) return '已结束';
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

async function claim(c: Coupon) {
  if (!auth.isLoggedIn) { router.push({ name: 'login', query: { redirect: '/promo' } }); return; }
  try {
    await api.claimCoupon(c.id);
    toast.push('已放入你的券包', 'success');
    coupons.value = (await api.coupons()) as any;
  } catch (e: any) { toast.push(e.message, 'error'); }
}

function goFlash(f: FlashSale) {
  router.push({ path: `/product/${f.productId}`, query: { flash: String(f.id) } });
}
function goGroup(g: GroupBuy) {
  router.push({ path: `/product/${g.productId}`, query: { group: String(g.id) } });
}

const usableCount = computed(() => coupons.value.filter((c) => c.canClaim).length);
</script>

<template>
  <div class="promo">
    <div class="hero">
      <div class="hero-text">
        <h1>省钱的方式，一次讲清楚</h1>
        <p>领券、抢秒杀、找人拼团。每一项优惠都写明门槛与到手价，不玩套路。</p>
      </div>
      <div class="hero-badges">
        <div class="hb"><b>{{ usableCount }}</b><span>可领券</span></div>
        <div class="hb"><b>{{ flash.length }}</b><span>秒杀场</span></div>
        <div class="hb"><b>{{ groups.length }}</b><span>拼团品</span></div>
      </div>
    </div>

    <div class="tabs">
      <button :class="['tab', tab === 'coupon' && 'on']" @click="tab = 'coupon'">优惠券</button>
      <button :class="['tab', tab === 'flash' && 'on']" @click="tab = 'flash'">限时秒杀</button>
      <button :class="['tab', tab === 'group' && 'on']" @click="tab = 'group'">拼团</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <!-- 券 -->
    <div v-else-if="tab === 'coupon'" class="coupon-grid">
      <div v-for="c in coupons" :key="c.id" class="coupon" :class="{ dead: !c.canClaim }">
        <div class="c-left">
          <div class="c-value">
            <template v-if="c.type === 'free_ship'">免运费</template>
            <template v-else-if="c.type === 'discount'">¥{{ c.maxDiscount || '—' }}</template>
            <template v-else><i>¥</i>{{ c.value / 100 }}</template>
          </div>
          <div class="c-threshold">{{ c.threshold ? `满 ${c.threshold} 可用` : '无门槛' }}</div>
        </div>
        <div class="c-right">
          <div class="c-title">{{ c.title }}</div>
          <div class="c-rule">{{ c.rule }} · {{ c.category }}</div>
          <div class="c-meta">剩余 {{ c.remain }} 张 · 每人限 {{ c.perUser }}</div>
          <button class="btn btn-sm" :class="c.canClaim ? 'btn-primary' : 'btn-secondary'" :disabled="!c.canClaim" @click="claim(c)">
            {{ c.soldOut ? '已抢光' : c.claimedByMe >= c.perUser ? '已领取' : '立即领取' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 秒杀 -->
    <div v-else-if="tab === 'flash'" class="flash-list">
      <div v-for="f in flash" :key="f.id" class="flash-card" @click="goFlash(f)">
        <div class="f-img">{{ f.image }}</div>
        <div class="f-body">
          <div class="f-tag">{{ f.campaign }}</div>
          <div class="f-name">{{ f.productName }}</div>
          <div class="f-price">
            <b>¥{{ f.price }}</b><s>¥{{ f.origin }}</s><span class="off">{{ f.off }}% OFF</span>
          </div>
          <div class="bar"><i :style="{ width: f.progress + '%' }" /></div>
          <div class="f-meta">已抢 {{ f.sold }}/{{ f.stock }} · 每人限 {{ f.limitPerUser }} 件</div>
        </div>
        <div class="f-side">
          <div class="cd">{{ countdown(f.endAt) }}</div>
          <div class="cd-label">距结束</div>
          <button class="btn btn-primary btn-sm">去抢购</button>
        </div>
      </div>
    </div>

    <!-- 拼团 -->
    <div v-else class="group-grid">
      <div v-for="g in groups" :key="g.id" class="group-card">
        <div class="g-img">{{ g.image }}</div>
        <div class="g-body">
          <div class="g-name">{{ g.productTitle }}</div>
          <div class="g-price"><b>¥{{ g.price }}</b><s>¥{{ g.origin }}</s><span class="save">省 ¥{{ g.save }}</span></div>
          <div class="g-meta">{{ g.required }} 人成团 · {{ g.expireHours }} 小时内有效 · {{ g.teams }} 个团在拼</div>
        </div>
        <button class="btn btn-primary btn-sm" @click="goGroup(g)">去拼团</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.promo { max-width: 1120px; margin: 0 auto; padding: 24px 20px 60px; }
.hero { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 28px 32px; border-radius: 18px;
  background: linear-gradient(135deg, #fff1f0 0%, #fff7e6 55%, #f6ffed 100%); margin-bottom: 20px; }
.hero h1 { font-size: 26px; margin: 0 0 8px; }
.hero p { margin: 0; color: #6b7280; font-size: 14px; }
.hero-badges { display: flex; gap: 14px; }
.hb { text-align: center; background: #fff; border-radius: 12px; padding: 12px 20px; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.hb b { display: block; font-size: 22px; color: #e53935; }
.hb span { font-size: 12px; color: #6b7280; }

.tabs { display: flex; gap: 8px; margin-bottom: 18px; }
.tab { border: none; background: #f3f4f6; padding: 9px 20px; border-radius: 999px; cursor: pointer; font-size: 14px; color: #4b5563; }
.tab.on { background: #e53935; color: #fff; }

.coupon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.coupon { display: flex; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
.coupon.dead { opacity: .55; }
.c-left { width: 116px; background: linear-gradient(160deg, #ff6b6b, #e53935); color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 14px 8px; }
.c-value { font-size: 24px; font-weight: 700; }
.c-value i { font-size: 14px; font-style: normal; }
.c-threshold { font-size: 11px; opacity: .9; margin-top: 4px; }
.c-right { flex: 1; padding: 14px; display: flex; flex-direction: column; gap: 4px; }
.c-title { font-weight: 600; font-size: 15px; }
.c-rule { font-size: 12px; color: #6b7280; }
.c-meta { font-size: 11px; color: #9ca3af; margin-bottom: 6px; }
.c-right .btn { align-self: flex-start; }

.flash-list, .group-grid { display: flex; flex-direction: column; gap: 12px; }
.flash-card { display: flex; gap: 16px; background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.06); cursor: pointer; }
.f-img { width: 84px; height: 84px; border-radius: 12px; background: #f9fafb; display: grid; place-items: center; font-size: 36px; }
.f-body { flex: 1; }
.f-tag { display: inline-block; font-size: 11px; color: #fff; background: #e53935; border-radius: 4px; padding: 1px 6px; margin-bottom: 6px; }
.f-name { font-weight: 600; margin-bottom: 6px; }
.f-price { display: flex; align-items: baseline; gap: 8px; }
.f-price b { color: #e53935; font-size: 20px; }
.f-price s { color: #9ca3af; font-size: 12px; }
.off { font-size: 11px; color: #e53935; }
.bar { height: 6px; background: #fee2e2; border-radius: 99px; margin: 8px 0 4px; overflow: hidden; }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, #ff8a65, #e53935); }
.f-meta { font-size: 11px; color: #9ca3af; }
.f-side { text-align: center; min-width: 96px; display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.cd { font-family: ui-monospace, monospace; font-size: 16px; color: #e53935; font-weight: 700; }
.cd-label { font-size: 11px; color: #9ca3af; margin-bottom: 6px; }

.group-card { display: flex; align-items: center; gap: 16px; background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
.g-img { width: 72px; height: 72px; border-radius: 12px; background: #f9fafb; display: grid; place-items: center; font-size: 30px; }
.g-body { flex: 1; }
.g-name { font-weight: 600; }
.g-price { display: flex; align-items: baseline; gap: 8px; margin: 4px 0; }
.g-price b { color: #e53935; font-size: 19px; }
.g-price s { color: #9ca3af; font-size: 12px; }
.save { font-size: 11px; color: #16a34a; }
.g-meta { font-size: 12px; color: #9ca3af; }
.empty { text-align: center; padding: 60px; color: #9ca3af; }
</style>
