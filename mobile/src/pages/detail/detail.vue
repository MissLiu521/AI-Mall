<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { api } from '@/api';
import { useAuth, useCart, toast, requireLogin } from '@/store';
import type { ProductDetail, ChatMessage, Sku } from '@/api/types';

const auth = useAuth();
const cart = useCart();

const p = ref<ProductDetail | null>(null);
const qty = ref(1);
const loading = ref(true);
const favBusy = ref(false);

// 秒杀：只在本商品有进行中的场次时展示
const flash = ref<any>(null);
const now = ref(Date.now());

// 规格选择：按 spec 的 key 拆成若干组，选中的值组合命中某个 SKU
const specGroups = ref<{ name: string; values: string[] }[]>([]);
const picked = ref<Record<string, string>>({});
const curSku = ref<Sku | null>(null);

// 评价
const reviewTab = ref(0);
const reviewData = ref<any>(null);

const qa = ref<ChatMessage[]>([]);
const qaInput = ref('');
const qaLoading = ref(false);
const qaConvId = ref<number | undefined>();

const unitPrice = computed(() => {
  if (flash.value) return flash.value.price;
  if (curSku.value) return curSku.value.price;
  return p.value?.price ?? 0;
});
const stock = computed(() => (curSku.value ? curSku.value.stock : p.value?.totalStock ?? 0));
const totalPrice = computed(() => +(unitPrice.value * qty.value).toFixed(2));
const specText = computed(() => Object.values(picked.value).join(' / '));
const flashLeft = computed(() => Math.max(0, new Date(flash.value?.endAt || 0).getTime() - now.value));
const flashClock = computed(() => {
  const s = Math.floor(flashLeft.value / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
});

onLoad(async (opt: any) => {
  try {
    p.value = (await api.product(opt.id)) as ProductDetail;
    uni.setNavigationBarTitle({ title: p.value.title.slice(0, 12) });
    initSku(p.value.skus);
    loadFlash();
    loadReviews(0);
  } catch (e: any) {
    toast.err(e.message);
    setTimeout(() => uni.navigateBack(), 1000);
  } finally { loading.value = false; }
});

// 倒计时每秒刷新，不额外请求接口
const timer = setInterval(() => { now.value = Date.now(); }, 1000);
onUnload(() => clearInterval(timer));

function initSku(skus: Sku[]) {
  if (!skus.length) return;
  const map = new Map<string, string[]>();
  for (const s of skus) {
    for (const [k, v] of Object.entries(s.spec || {})) {
      if (!map.has(k)) map.set(k, []);
      if (!map.get(k)!.includes(String(v))) map.get(k)!.push(String(v));
    }
  }
  specGroups.value = [...map.entries()].map(([name, values]) => ({ name, values }));
  // 默认选中第一个可售规格，减少用户操作
  const first = skus.find((s) => s.buyable) || skus[0];
  picked.value = { ...(first.spec as any) };
  curSku.value = first;
}

function pickSpec(name: string, value: string) {
  picked.value = { ...picked.value, [name]: value };
}

// 任意一组规格变化后重新匹配 SKU；匹配不到时按"哪些选项有货"给出置灰
watch(picked, () => {
  if (!p.value) return;
  const hit = p.value.skus.find((s) =>
    specGroups.value.every((g) => String((s.spec as any)?.[g.name] || '') === picked.value[g.name]));
  curSku.value = hit || null;
  qty.value = 1;
}, { deep: true });

function valueAvailable(groupName: string, value: string) {
  if (!p.value) return true;
  return p.value.skus.some((s) => {
    if (!s.buyable) return false;
    if (String((s.spec as any)?.[groupName] || '') !== value) return false;
    // 其他组必须与当前选择一致，这样置灰才准确
    return specGroups.value.every((g) => {
      if (g.name === groupName) return true;
      const want = picked.value[g.name];
      return !want || String((s.spec as any)?.[g.name] || '') === want;
    });
  });
}

async function loadFlash() {
  try {
    const list: any[] = (await api.flashSales()) as any[];
    flash.value = list.find((f) => f.productId === p.value?.id) || null;
  } catch { /* 秒杀失败不影响详情 */ }
}

async function loadReviews(rating: number) {
  if (!p.value) return;
  reviewTab.value = rating;
  try {
    reviewData.value = await api.reviews(p.value.id, { rating, pageSize: 3 });
  } catch { /* ignore */ }
}

function changeQty(d: number) {
  const next = qty.value + d;
  if (next < 1 || next > stock.value) return;
  qty.value = next;
}

async function toggleFav() {
  if (!requireLogin(auth) || !p.value) return;
  favBusy.value = true;
  try {
    const r: any = await api.toggleFavorite(p.value.id);
    p.value.favorite = r.favorited;
    toast.info(r.favorited ? '已收藏，降价会提醒你' : '已取消收藏');
  } catch (e: any) { toast.err(e.message); }
  finally { favBusy.value = false; }
}

async function addToCart() {
  if (!requireLogin(auth) || !p.value) return;
  if (p.value.skus.length && !curSku.value) { toast.err('请选择规格'); return; }
  try {
    await cart.add(p.value.id, qty.value, curSku.value?.id || 0);
    toast.ok('已加入购物车');
  } catch (e: any) { toast.err(e.message); }
}

async function buyNow() {
  if (!requireLogin(auth) || !p.value) return;
  if (p.value.skus.length && !curSku.value) { toast.err('请选择规格'); return; }
  const sku = curSku.value ? `&skuId=${curSku.value.id}` : '';
  // 有秒杀场次就带上，结算页按秒杀价预览与下单
  const fl = flash.value ? `&flash=${flash.value.id}` : '';
  uni.navigateTo({ url: `/pages/checkout/checkout?productId=${p.value.id}${sku}&qty=${qty.value}${fl}` });
}

function goGroup() {
  uni.navigateTo({ url: `/pages/promo/promo?tab=group` });
}

async function markUseful(r: any) {
  if (!requireLogin(auth)) return;
  try { const x: any = await api.usefulReview(r.id); r.useful = x.useful; } catch (e: any) { toast.err(e.message); }
}

async function ask() {
  const text = qaInput.value.trim();
  if (!text || qaLoading.value || !p.value) return;
  qaInput.value = '';
  qa.value.push({ role: 'user', content: text });
  qaLoading.value = true;
  try {
    const r: any = await api.chat({
      scene: 'shopping',
      text: `关于商品「${p.value.title}」（ID ${p.value.id}）：${text}`,
      conversationId: qaConvId.value,
    });
    qaConvId.value = r.conversationId;
    qa.value.push({ role: 'assistant', content: r.content, toolTrace: r.toolTrace });
  } catch (e: any) {
    qa.value.push({ role: 'assistant', content: e.message });
  } finally { qaLoading.value = false; }
}

function stars(n: number) {
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="skel" />

    <template v-else-if="p">
      <view class="gallery">
        <text class="g-emoji">{{ p.image || '📦' }}</text>
        <text v-if="flash" class="flash-flag">秒杀 ¥{{ flash.price }}</text>
      </view>

      <!-- 价格区：秒杀价优先，其次规格价，最后标价 -->
      <view class="price-band">
        <view class="row" style="align-items: baseline; gap: 14rpx">
          <text class="price-lg">¥{{ unitPrice }}</text>
          <text v-if="p.compareAt && p.compareAt > unitPrice" class="old">¥{{ p.compareAt }}</text>
          <text v-if="flash" class="badge badge-danger">省 ¥{{ (flash.origin - flash.price).toFixed(2) }}</text>
        </view>
        <view v-if="flash" class="flash-row">
          <text class="flash-txt">限时秒杀 · 已抢 {{ flash.progress }}%</text>
          <text class="flash-clock mono">{{ flashClock }}</text>
        </view>
        <view v-else-if="p.priceRange && p.priceRange.min !== p.priceRange.max" class="range-tip">
          <text class="dim" style="font-size: 22rpx">价格区间 ¥{{ p.priceRange.min }} – ¥{{ p.priceRange.max }}</text>
        </view>
      </view>

      <view class="info card">
        <text class="title">{{ p.title }}</text>
        <text class="sub">{{ p.subtitle }}</text>

        <view class="meta">
          <text class="dim">{{ p.rating }} ★</text>
          <text class="dot" />
          <text class="dim">已售 {{ p.sales }}</text>
          <text class="dot" />
          <text class="dim">{{ stock > 0 ? `库存 ${stock}` : '缺货' }}</text>
        </view>

        <view class="tags">
          <text v-for="t in p.tags" :key="t" class="tag">{{ t }}</text>
        </view>
      </view>

      <!-- 店铺 -->
      <view v-if="p.shop" class="card shop">
        <view class="shop-logo"><text class="shop-emoji">{{ p.shop.logo || '🏬' }}</text></view>
        <view class="grow">
          <view class="row" style="gap: 10rpx">
            <text class="shop-name">{{ p.shop.name }}</text>
            <text v-if="p.shop.isSelf" class="badge badge-primary">自营</text>
          </view>
          <text class="dim" style="font-size: 22rpx">店铺评分 {{ p.shop.rating }} · {{ p.shop.description || '品质保障' }}</text>
        </view>
        <text class="shop-link" @tap="uni.navigateTo({ url: `/pages/category/category?shopId=${p.shop.id}` })">进店 ›</text>
      </view>

      <!-- 规格 -->
      <view v-if="specGroups.length" class="card block">
        <view class="row-between" style="margin-bottom: 8rpx">
          <text class="block-title" style="margin: 0">选择规格</text>
          <text class="dim" style="font-size: 22rpx">{{ specText }}</text>
        </view>
        <view v-for="g in specGroups" :key="g.name" class="spec-group">
          <text class="spec-label">{{ g.name }}</text>
          <view class="spec-values">
            <text
              v-for="v in g.values" :key="v"
              class="spec-chip"
              :class="{ on: picked[g.name] === v, off: !valueAvailable(g.name, v) }"
              @tap="pickSpec(g.name, v)"
            >{{ v }}</text>
          </view>
        </view>
      </view>

      <view class="card block">
        <view class="qty-row">
          <text class="qty-label">数量</text>
          <view class="stepper">
            <text class="s-btn" :class="{ dis: qty <= 1 }" @tap="changeQty(-1)">−</text>
            <text class="s-num mono">{{ qty }}</text>
            <text class="s-btn" :class="{ dis: qty >= stock }" @tap="changeQty(1)">＋</text>
          </view>
          <text class="dim" style="font-size: 22rpx">小计 <text class="price mono">¥{{ totalPrice }}</text></text>
        </view>
        <view class="divider" style="margin: 18rpx 0" />
        <view class="row-between">
          <text class="dim" style="font-size: 22rpx">会员价 / 满减 / 优惠券在结算页自动叠加</text>
          <text class="shop-link" @tap="goGroup">去拼团 ›</text>
        </view>
      </view>

      <!-- 评价 -->
      <view class="card block">
        <view class="row-between" style="margin-bottom: 16rpx">
          <text class="block-title" style="margin: 0">商品评价</text>
          <text class="shop-link" @tap="uni.navigateTo({ url: `/pages/reviews/reviews?id=${p.id}` })">全部 {{ reviewData?.total || 0 }} 条 ›</text>
        </view>

        <view v-if="p.reviewSummary.total" class="rate-row">
          <view class="rate-score">
            <text class="score mono">{{ p.reviewSummary.average }}</text>
            <text class="dim" style="font-size: 20rpx">好评率 {{ p.reviewSummary.goodRate }}%</text>
          </view>
          <view class="grow">
            <view v-for="b in (reviewData?.breakdown?.dist || [])" :key="b.star" class="bar-row">
              <text class="bar-label">{{ b.star }} 星</text>
              <view class="bar"><view class="bar-fill" :style="{ width: b.percent + '%' }" /></view>
              <text class="bar-num mono">{{ b.count }}</text>
            </view>
          </view>
        </view>

        <view v-if="reviewData?.summary" class="ai-sum">
          <text class="ai-sum-tag">AI 评价摘要</text>
          <text class="ai-sum-txt">{{ reviewData.summary.oneLine }}</text>
          <view class="ai-sum-cols">
            <view v-if="reviewData.summary.pros?.length" class="sum-col">
              <text class="sum-col-title good">好在哪</text>
              <text v-for="(t, i) in reviewData.summary.pros" :key="'g' + i" class="sum-li">· {{ t }}</text>
            </view>
            <view v-if="reviewData.summary.cons?.length" class="sum-col">
              <text class="sum-col-title bad">注意点</text>
              <text v-for="(t, i) in reviewData.summary.cons" :key="'b' + i" class="sum-li">· {{ t }}</text>
            </view>
          </view>
        </view>

        <view class="rate-filter">
          <text
            v-for="r in [0, 5, 4, 3, 2, 1]" :key="r"
            class="filter-chip" :class="{ on: reviewTab === r }"
            @tap="loadReviews(r)"
          >{{ r === 0 ? '全部' : r + ' 星' }}</text>
        </view>

        <view v-if="!reviewData?.items?.length" class="dim" style="font-size: 24rpx; padding: 16rpx 0">
          还没有这类评价
        </view>
        <view v-for="r in reviewData?.items || []" :key="r.id" class="review">
          <view class="row-between">
            <view class="row" style="gap: 12rpx">
              <view class="avatar-sm"><text class="avatar-sm-txt">{{ r.userName.slice(0, 1) }}</text></view>
              <text class="rv-name">{{ r.userName }}</text>
            </view>
            <text class="stars">{{ stars(r.rating) }}</text>
          </view>
          <text class="rv-content">{{ r.content }}</text>
          <view v-if="r.reply" class="rv-reply"><text class="rv-reply-txt">商家回复：{{ r.reply }}</text></view>
          <view class="row-between" style="margin-top: 10rpx">
            <text class="dim" style="font-size: 20rpx">{{ r.createdAt }}</text>
            <text class="useful" @tap="markUseful(r)">有用 {{ r.useful }}</text>
          </view>
        </view>
      </view>

      <view class="desc card">
        <text class="block-title">商品详情</text>
        <text class="desc-text">{{ p.description }}</text>
      </view>

      <!-- AI 商品问答 -->
      <view class="qa card">
        <view class="row-between" style="margin-bottom: 20rpx">
          <text class="block-title" style="margin: 0">AI 问答</text>
          <text class="badge badge-ai">针对本商品</text>
        </view>

        <view v-if="!qa.length" class="qa-tips">
          <text class="dim" style="font-size: 24rpx">有什么想了解的？AI 会读取商品真实信息回答。</text>
          <view class="qa-chips">
            <text v-for="s in ['适合送礼吗', '有现货吗', '贵在哪']" :key="s" class="qchip" @tap="qaInput = s; ask()">{{ s }}</text>
          </view>
        </view>

        <view v-for="(m, i) in qa" :key="i" class="qa-msg" :class="m.role">
          <text class="qa-bubble">{{ m.content }}</text>
        </view>
        <view v-if="qaLoading" class="qa-msg assistant">
          <text class="qa-bubble dim">正在查询商品信息…</text>
        </view>

        <view class="qa-input">
          <input v-model="qaInput" class="qa-field" placeholder="问点什么…" :disabled="qaLoading" confirm-type="send" @confirm="ask" />
          <view class="qa-send" @tap="ask"><text class="qa-send-txt">问</text></view>
        </view>
      </view>

      <view class="spacer" />

      <!-- 底部操作栏 -->
      <view class="bottom-bar safe-bottom">
        <view class="bar-left" @tap="toggleFav">
          <text class="bar-ic">{{ p.favorite ? '★' : '☆' }}</text>
          <text class="bar-txt">{{ p.favorite ? '已收藏' : '收藏' }}</text>
        </view>
        <view class="bar-left" @tap="uni.switchTab({ url: '/pages/cart/cart' })">
          <text class="bar-ic">🛒</text>
          <text class="bar-txt">购物车</text>
        </view>
        <view class="btn btn-ghost bar-btn" @tap="addToCart">加入购物车</view>
        <view class="btn btn-primary bar-btn" @tap="buyNow">立即购买</view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { padding-bottom: 160rpx; }
.skel { height: 600rpx; background: #f1f3f7; }

.gallery {
  position: relative;
  height: 620rpx;
  background: linear-gradient(160deg, #f5f7fb, #eceff6);
  display: flex; align-items: center; justify-content: center;
}
.g-emoji { font-size: 220rpx; }
.flash-flag {
  position: absolute;
  top: 24rpx; left: 24rpx;
  background: #d93b4a; color: #fff;
  font-size: 22rpx; padding: 6rpx 18rpx; border-radius: 999rpx;
}

.price-band { background: #fff; padding: 24rpx 28rpx; }
.price-lg { font-size: 60rpx; font-weight: 600; color: #d93b4a; font-family: 'SF Mono', Consolas, monospace; letter-spacing: -1rpx; }
.old { font-size: 24rpx; color: #8d94a6; text-decoration: line-through; }
.flash-row { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; }
.flash-txt { font-size: 22rpx; color: #d93b4a; }
.flash-clock { font-size: 24rpx; color: #d93b4a; background: #fdecee; padding: 4rpx 14rpx; border-radius: 8rpx; }
.range-tip { margin-top: 8rpx; }

.info { margin: 20rpx; padding: 28rpx; border-radius: 20rpx; }
.title { display: block; font-size: 34rpx; font-weight: 600; line-height: 1.4; }
.sub { display: block; font-size: 24rpx; color: #5a6072; margin-top: 8rpx; }

.meta { display: flex; align-items: center; gap: 14rpx; margin-top: 18rpx; font-size: 22rpx; }
.dot { width: 6rpx; height: 6rpx; border-radius: 50%; background: #d3d8e3; }

.tags { display: flex; flex-wrap: wrap; gap: 10rpx; margin-top: 18rpx; }
.tag { font-size: 20rpx; color: #5a6072; background: #f1f3f7; padding: 6rpx 16rpx; border-radius: 8rpx; }

.shop { display: flex; align-items: center; gap: 18rpx; margin: 0 20rpx 20rpx; padding: 22rpx 24rpx; }
.shop-logo {
  width: 76rpx; height: 76rpx; border-radius: 18rpx; background: #f1f3f7;
  display: flex; align-items: center; justify-content: center;
}
.shop-emoji { font-size: 36rpx; }
.shop-name { font-size: 26rpx; font-weight: 600; }
.shop-link { font-size: 24rpx; color: #2f5bea; }

.block { margin: 0 20rpx 20rpx; padding: 28rpx; }
.block-title { font-size: 28rpx; font-weight: 600; display: block; margin-bottom: 16rpx; }

.spec-group { display: flex; align-items: flex-start; gap: 16rpx; margin-top: 18rpx; }
.spec-label { font-size: 24rpx; color: #8d94a6; width: 96rpx; flex-shrink: 0; padding-top: 10rpx; }
.spec-values { display: flex; flex-wrap: wrap; gap: 14rpx; flex: 1; }
.spec-chip {
  font-size: 24rpx; padding: 10rpx 26rpx; border-radius: 12rpx;
  border: 1rpx solid #e4e7ee; background: #fff; color: #1a1d24;
}
.spec-chip.on { border-color: #2f5bea; background: #f3f6ff; color: #2f5bea; font-weight: 500; }
.spec-chip.off { color: #c2c8d4; background: #f7f8fa; text-decoration: line-through; }

.qty-row { display: flex; align-items: center; gap: 20rpx; }
.qty-label { font-size: 26rpx; color: #5a6072; }
.stepper { display: flex; align-items: center; border: 1rpx solid #d3d8e3; border-radius: 12rpx; overflow: hidden; }
.s-btn { width: 64rpx; height: 60rpx; display: flex; align-items: center; justify-content: center; font-size: 30rpx; color: #5a6072; }
.s-btn.dis { color: #d3d8e3; }
.s-num { width: 76rpx; text-align: center; font-size: 26rpx; }

.rate-row { display: flex; gap: 24rpx; align-items: center; padding-bottom: 16rpx; }
.rate-score { width: 150rpx; text-align: center; }
.score { display: block; font-size: 52rpx; font-weight: 600; color: #d93b4a; }
.bar-row { display: flex; align-items: center; gap: 12rpx; margin-bottom: 6rpx; }
.bar-label { font-size: 20rpx; color: #8d94a6; width: 60rpx; }
.bar { flex: 1; height: 10rpx; background: #f1f3f7; border-radius: 999rpx; overflow: hidden; }
.bar-fill { height: 100%; background: #f0b429; }
.bar-num { font-size: 20rpx; color: #8d94a6; width: 44rpx; text-align: right; }

.ai-sum { background: #fbfaff; border: 1rpx solid #e6e0fd; border-radius: 16rpx; padding: 20rpx; margin: 12rpx 0; }
.ai-sum-tag { font-size: 20rpx; color: #6b4ef5; background: #f1eefe; padding: 4rpx 12rpx; border-radius: 6rpx; }
.ai-sum-txt { display: block; font-size: 24rpx; line-height: 1.7; margin-top: 12rpx; color: #1a1d24; }
.ai-sum-cols { display: flex; gap: 20rpx; margin-top: 12rpx; }
.sum-col { flex: 1; }
.sum-col-title { font-size: 20rpx; display: block; margin-bottom: 6rpx; }
.sum-col-title.good { color: #12a05c; }
.sum-col-title.bad { color: #e08b1e; }
.sum-li { display: block; font-size: 20rpx; color: #5a6072; line-height: 1.6; }

.rate-filter { display: flex; gap: 12rpx; flex-wrap: wrap; margin: 16rpx 0; }
.filter-chip { font-size: 22rpx; padding: 6rpx 20rpx; border-radius: 999rpx; background: #f1f3f7; color: #5a6072; }
.filter-chip.on { background: #edf1fe; color: #2f5bea; }

.review { padding: 18rpx 0; border-top: 1rpx solid #f1f3f7; }
.avatar-sm {
  width: 44rpx; height: 44rpx; border-radius: 50%; background: #edf1fe;
  display: flex; align-items: center; justify-content: center;
}
.avatar-sm-txt { font-size: 20rpx; color: #2f5bea; }
.rv-name { font-size: 22rpx; color: #5a6072; }
.stars { font-size: 20rpx; color: #f0b429; }
.rv-content { display: block; font-size: 24rpx; line-height: 1.7; margin-top: 10rpx; }
.rv-reply { background: #f7f8fa; border-radius: 10rpx; padding: 12rpx; margin-top: 10rpx; }
.rv-reply-txt { font-size: 20rpx; color: #5a6072; }
.useful { font-size: 20rpx; color: #2f5bea; }

.desc { margin: 0 20rpx 20rpx; padding: 28rpx; }
.desc-text { font-size: 26rpx; line-height: 1.8; color: #5a6072; }

.qa { margin: 0 20rpx 20rpx; padding: 28rpx; }
.qa-tips { padding-bottom: 16rpx; }
.qa-chips { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 16rpx; }
.qchip { font-size: 22rpx; color: #5a6072; border: 1rpx solid #e4e7ee; border-radius: 999rpx; padding: 8rpx 20rpx; }

.qa-msg { display: flex; margin-bottom: 14rpx; }
.qa-msg.user { justify-content: flex-end; }
.qa-bubble {
  max-width: 84%;
  padding: 16rpx 22rpx;
  border-radius: 16rpx;
  font-size: 26rpx;
  line-height: 1.65;
  background: #f1eefe;
}
.qa-msg.user .qa-bubble { background: #2f5bea; color: #fff; }

.qa-input { display: flex; gap: 14rpx; margin-top: 12rpx; }
.qa-field { flex: 1; height: 72rpx; background: #f1f3f7; border-radius: 999rpx; padding: 0 24rpx; font-size: 26rpx; }
.qa-send {
  width: 72rpx; height: 72rpx;
  border-radius: 50%;
  background: #6b4ef5;
  display: flex; align-items: center; justify-content: center;
}
.qa-send-txt { color: #fff; font-size: 26rpx; }

.spacer { height: 20rpx; }

.bottom-bar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 20rpx;
  background: #fff;
  border-top: 1rpx solid #e4e7ee;
  z-index: 50;
}
.bar-left { display: flex; flex-direction: column; align-items: center; width: 86rpx; }
.bar-ic { font-size: 30rpx; }
.bar-txt { font-size: 18rpx; color: #5a6072; }
.bar-btn { flex: 1; }
</style>
