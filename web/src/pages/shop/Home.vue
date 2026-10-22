<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { useAuth, useCart, useToast } from '../../store';
import ProductCard from '../../components/ProductCard.vue';
import type { Product, FlashSale, Feed } from '../../api/types';

const router = useRouter();
const auth = useAuth();
const cart = useCart();
const toast = useToast();

const products = ref<Product[]>([]);
const categories = ref<{ name: string; count: number }[]>([]);
const loading = ref(true);
const keyword = ref('');

const flash = ref<FlashSale[]>([]);
const rankTab = ref<'hot' | 'rated' | 'deals'>('hot');
const rankings = ref<{ hot: any[]; rated: any[]; deals: any[] }>({ hot: [], rated: [], deals: [] });
const feeds = ref<Feed[]>([]);
const now = ref(Date.now());
let timer: number | undefined;

onMounted(async () => {
  try {
    const [list, meta, f, r, fd] = await Promise.all([
      api.products({ pageSize: 8 }), api.meta(), api.flashSales(), api.rankings(), api.feed({ pageSize: 3 }),
    ]);
    products.value = list.items;
    categories.value = meta.categories;
    flash.value = f as any;
    rankings.value = r;
    feeds.value = (fd as any).items;
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    loading.value = false;
  }
  timer = window.setInterval(() => { now.value = Date.now(); }, 1000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });

function countdown(endAt: string) {
  const ms = new Date(endAt).getTime() - now.value;
  if (ms <= 0) return '已结束';
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const rankList = () => (rankings.value as any)[rankTab.value] || [];

async function add(p: Product) {
  if (!auth.isLoggedIn) { router.push('/login'); return; }
  try {
    await cart.add(p.id, 1);
    toast.push(`已加入购物车：${p.title}`, 'success');
  } catch (e: any) {
    toast.push(e.message, 'error');
  }
}

function goSearch() {
  router.push({ name: 'category', query: keyword.value ? { q: keyword.value } : {} });
}
</script>

<template>
  <div class="home">
    <!-- Hero -->
    <section class="hero">
      <div class="hero-inner">
        <span class="hero-tag">✦ AI 驱动的选品助手</span>
        <h1 class="hero-title">说需求，不说关键词</h1>
        <p class="hero-sub">
          「300 以内送女朋友的礼物」——用日常语言告诉我们，AI 帮你从 16 件在售商品里挑出真正合适的。
        </p>
        <div class="hero-search">
          <input
            v-model="keyword"
            class="hero-input"
            placeholder="试试：想买个不那么吵的风扇"
            @keyup.enter="goSearch"
          />
          <button class="btn btn-primary" @click="goSearch">搜索</button>
        </div>
        <div class="hero-chips">
          <button v-for="s in ['通勤降噪耳机', '送女友礼物', '早餐燕麦', '露营投影']" :key="s" class="hero-chip"
                  @click="keyword = s; goSearch()">
            {{ s }}
          </button>
        </div>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="hv-card hv-1">🎧</div>
        <div class="hv-card hv-2">☕</div>
        <div class="hv-card hv-3">💡</div>
        <div class="hv-glow" />
      </div>
    </section>

    <!-- 快捷入口 -->
    <section class="quick-row">
      <button class="quick" @click="router.push('/promo')"><span class="q-icon">🎟️</span><b>领券中心</b><i>最高减 200</i></button>
      <button class="quick" @click="router.push('/promo')"><span class="q-icon">⚡</span><b>限时秒杀</b><i>每日 3 场</i></button>
      <button class="quick" @click="router.push('/promo')"><span class="q-icon">👥</span><b>拼团更省</b><i>2 人成团</i></button>
      <button class="quick" @click="router.push('/feed')"><span class="q-icon">📱</span><b>逛逛</b><i>边看边买</i></button>
    </section>

    <!-- 限时秒杀 -->
    <section v-if="flash.length" class="section">
      <div class="section-head">
        <h2>⚡ 限时秒杀</h2>
        <router-link to="/promo" class="more-link">全部场次 →</router-link>
      </div>
      <div class="flash-strip">
        <div v-for="f in flash.slice(0, 3)" :key="f.id" class="fs-card" @click="router.push({ path: `/product/${f.productId}`, query: { flash: String(f.id) } })">
          <div class="fs-img">{{ f.image }}</div>
          <div class="fs-info">
            <div class="fs-name">{{ f.productName }}</div>
            <div class="fs-price"><b>¥{{ f.price }}</b><s>¥{{ f.origin }}</s></div>
            <div class="fs-bar"><i :style="{ width: f.progress + '%' }" /></div>
            <div class="fs-meta">已抢 {{ f.progress }}%</div>
          </div>
          <div class="fs-cd">{{ countdown(f.endAt) }}</div>
        </div>
      </div>
    </section>

    <!-- 分类 -->
    <section class="section">
      <div class="section-head">
        <h2>分类</h2>
        <router-link to="/shop/category" class="more-link">查看全部 →</router-link>
      </div>
      <div class="cat-row">
        <button class="cat-pill" @click="router.push('/shop/category')">全部</button>
        <button v-for="c in categories" :key="c.name" class="cat-pill"
                @click="router.push({ name: 'category', query: { category: c.name } })">
          {{ c.name }}<span class="cat-count">{{ c.count }}</span>
        </button>
      </div>
    </section>

    <!-- 榜单 -->
    <section class="section">
      <div class="section-head">
        <h2>榜单</h2>
        <div class="rank-tabs">
          <button :class="['rt', rankTab === 'hot' && 'on']" @click="rankTab = 'hot'">热销榜</button>
          <button :class="['rt', rankTab === 'rated' && 'on']" @click="rankTab = 'rated'">好评榜</button>
          <button :class="['rt', rankTab === 'deals' && 'on']" @click="rankTab = 'deals'">降价榜</button>
        </div>
      </div>
      <div class="rank-list">
        <div v-for="(p, i) in rankList()" :key="p.id" class="rank-item" @click="router.push(`/product/${p.id}`)">
          <span class="rk" :class="{ top: i < 3 }">{{ i + 1 }}</span>
          <span class="ri-img">{{ p.image }}</span>
          <span class="ri-name">{{ p.title }}</span>
          <span class="ri-meta">★ {{ p.rating }} · 售 {{ p.sales }}</span>
          <span class="ri-price">¥{{ p.price }}</span>
          <span v-if="p.dropPercent" class="ri-drop">↓{{ p.dropPercent }}%</span>
        </div>
      </div>
    </section>

    <!-- 商品 -->
    <section class="section">
      <div class="section-head">
        <h2>热门商品</h2>
        <span class="dim" style="font-size: 12px">AI 精选基于评分与销量综合排序</span>
      </div>

      <div v-if="loading" class="grid">
        <div v-for="i in 4" :key="i" class="skeleton" style="aspect-ratio: 3/4" />
      </div>
      <div v-else-if="!products.length" class="empty">
        <div class="empty-icon">📦</div>
        暂无商品
      </div>
      <div v-else class="grid">
        <ProductCard
          v-for="(p, i) in products"
          :key="p.id"
          :product="p"
          :ai-pick="i === 0"
          @add="add"
        />
      </div>
    </section>

    <!-- 逛逛预览 -->
    <section v-if="feeds.length" class="section">
      <div class="section-head">
        <h2>逛逛</h2>
        <router-link to="/feed" class="more-link">更多内容 →</router-link>
      </div>
      <div class="feed-row">
        <div v-for="f in feeds" :key="f.id" class="feed-card" @click="router.push('/feed')">
          <div class="fc-cover" :style="{ background: f.media }">{{ f.cover }}</div>
          <div class="fc-title">{{ f.title }}</div>
          <div class="fc-meta">{{ f.authorName }} · ♥ {{ f.likes }}</div>
        </div>
      </div>
    </section>

    <!-- AI 能力介绍 -->
    <section class="section">
      <div class="ai-band">
        <div class="ai-band-item">
          <div class="ai-band-icon">✨</div>
          <div>
            <div class="ai-band-title">AI 导购</div>
            <div class="ai-band-desc">描述需求即可选品，支持预算与场景约束</div>
          </div>
        </div>
        <div class="ai-band-item">
          <div class="ai-band-icon">🎧</div>
          <div>
            <div class="ai-band-title">AI 客服</div>
            <div class="ai-band-desc">查订单、看物流、直接提交退款，不只是聊天</div>
          </div>
        </div>
        <div class="ai-band-item">
          <div class="ai-band-icon">⚙️</div>
          <div>
            <div class="ai-band-title">运营智能体</div>
            <div class="ai-band-desc">商家侧分析滞销、一键生成商品文案</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home { max-width: 1200px; margin: 0 auto; padding: 0 24px 64px; }

.hero {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 40px;
  align-items: center;
  padding: 56px 0 48px;
}
.hero-inner { max-width: 560px; }
.hero-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--ai);
  background: var(--ai-soft);
  padding: 4px 10px;
  border-radius: var(--r-full);
  margin-bottom: 16px;
}
.hero-title {
  font-size: 38px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.18;
  margin: 0 0 12px;
}
.hero-sub { font-size: 14px; color: var(--text-2); line-height: 1.7; margin: 0 0 24px; }
.hero-search { display: flex; gap: 8px; margin-bottom: 14px; }
.hero-input {
  flex: 1;
  height: 44px;
  padding: 0 16px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--surface);
  outline: none;
  font-size: 14px;
  transition: all 0.16s;
}
.hero-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(47, 91, 234, 0.1); }
.hero-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.hero-chip {
  border: 1px solid var(--line);
  background: transparent;
  border-radius: var(--r-full);
  padding: 4px 12px;
  font-size: 12px;
  color: var(--text-2);
  transition: all 0.16s;
}
.hero-chip:hover { border-color: var(--line-strong); background: var(--surface); color: var(--text); }

.hero-visual { position: relative; height: 260px; }
.hv-card {
  position: absolute;
  width: 96px; height: 96px;
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--sh-2);
  display: grid; place-items: center;
  font-size: 36px;
}
.hv-1 { top: 24px; left: 40px; transform: rotate(-6deg); }
.hv-2 { top: 100px; left: 150px; transform: rotate(4deg); }
.hv-3 { top: 10px; left: 178px; transform: rotate(10deg); }
.hv-glow {
  position: absolute;
  inset: 20px 0 0 20px;
  background: radial-gradient(circle at 50% 50%, rgba(107, 78, 245, 0.12), transparent 65%);
  filter: blur(20px);
}

.section { margin-bottom: 44px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
.section-head h2 { font-size: 18px; font-weight: 600; margin: 0; }
.more-link { font-size: 13px; color: var(--text-2); }
.more-link:hover { color: var(--primary); }

.cat-row { display: flex; flex-wrap: wrap; gap: 8px; }
.cat-pill {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  background: var(--surface);
  font-size: 13px;
  color: var(--text-2);
  display: inline-flex; align-items: center; gap: 6px;
  transition: all 0.16s;
}
.cat-pill:hover { border-color: var(--primary); color: var(--primary); }
.cat-count { font-size: 11px; color: var(--text-3); font-family: var(--mono); }

.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

.ai-band {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.ai-band-item {
  display: flex;
  gap: 12px;
  padding: 20px;
  background: var(--surface);
}
.ai-band-icon {
  width: 34px; height: 34px;
  flex-shrink: 0;
  border-radius: 10px;
  background: var(--ai-soft);
  display: grid; place-items: center;
  font-size: 15px;
}
.ai-band-title { font-size: 13px; font-weight: 600; }
.ai-band-desc { font-size: 12px; color: var(--text-2); line-height: 1.5; margin-top: 2px; }

@media (max-width: 1024px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
  .hero { grid-template-columns: 1fr; }
  .hero-visual { display: none; }
  .ai-band { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .home { padding: 0 16px 40px; }
  .grid { grid-template-columns: repeat(2, 1fr); }
  .hero-title { font-size: 28px; }
  .hero { padding: 32px 0; }
}

/* ── 商城 2.0 首页模块 ── */
.quick-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 8px 0 4px; }
.quick { border: none; background: #fff; border-radius: 14px; padding: 14px 16px; text-align: left; cursor: pointer;
  box-shadow: 0 2px 10px rgba(0,0,0,.05); display: flex; flex-direction: column; gap: 2px; transition: transform .15s; }
.quick:hover { transform: translateY(-2px); }
.q-icon { font-size: 20px; }
.quick b { font-size: 14px; color: #111827; }
.quick i { font-size: 11px; color: #9ca3af; font-style: normal; }

.flash-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.fs-card { display: flex; gap: 12px; align-items: center; background: #fff5f5; border: 1px solid #fecaca;
  border-radius: 14px; padding: 12px; cursor: pointer; position: relative; }
.fs-img { width: 56px; height: 56px; background: #fff; border-radius: 10px; display: grid; place-items: center; font-size: 26px; }
.fs-info { flex: 1; min-width: 0; }
.fs-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fs-price { display: flex; align-items: baseline; gap: 6px; margin: 3px 0; }
.fs-price b { color: #e53935; font-size: 17px; }
.fs-price s { color: #9ca3af; font-size: 11px; }
.fs-bar { height: 5px; background: #fee2e2; border-radius: 99px; overflow: hidden; }
.fs-bar i { display: block; height: 100%; background: #e53935; }
.fs-meta { font-size: 10px; color: #9ca3af; margin-top: 2px; }
.fs-cd { font-family: ui-monospace, monospace; font-size: 12px; color: #e53935; font-weight: 700; }

.rank-tabs { display: flex; gap: 6px; }
.rt { border: none; background: #f3f4f6; padding: 5px 12px; border-radius: 99px; font-size: 12px; color: #6b7280; cursor: pointer; }
.rt.on { background: #111827; color: #fff; }
.rank-list { background: #fff; border-radius: 14px; padding: 6px 16px; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.rank-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f8fafc; cursor: pointer; }
.rank-item:last-child { border-bottom: none; }
.rk { width: 20px; font-size: 13px; color: #9ca3af; text-align: center; }
.rk.top { color: #e53935; font-weight: 700; }
.ri-img { font-size: 20px; }
.ri-name { flex: 1; font-size: 13px; }
.ri-meta { font-size: 11px; color: #9ca3af; }
.ri-price { color: #e53935; font-weight: 600; font-size: 14px; }
.ri-drop { font-size: 11px; color: #16a34a; }

.feed-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.feed-card { background: #fff; border-radius: 14px; overflow: hidden; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.fc-cover { height: 120px; display: grid; place-items: center; font-size: 40px; }
.fc-title { padding: 10px 12px 4px; font-size: 13px; font-weight: 500; line-height: 1.4; }
.fc-meta { padding: 0 12px 12px; font-size: 11px; color: #9ca3af; }

@media (max-width: 900px) {
  .quick-row { grid-template-columns: repeat(2, 1fr); }
  .flash-strip, .feed-row { grid-template-columns: 1fr; }
}
</style>
