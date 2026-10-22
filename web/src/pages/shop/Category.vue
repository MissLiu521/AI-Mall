<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';
import { useAuth, useCart, useToast } from '../../store';
import ProductCard from '../../components/ProductCard.vue';
import type { Product } from '../../api/types';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const cart = useCart();
const toast = useToast();

const items = ref<Product[]>([]);
const total = ref(0);
const loading = ref(true);
const categories = ref<{ name: string; count: number }[]>([]);
const page = ref(1);

const q = ref((route.query.q as string) || '');
const category = ref((route.query.category as string) || '');
const shopId = ref(Number(route.query.shopId) || 0);
const sort = ref((route.query.sort as string) || 'default');
const suggestions = ref<string[]>([]);

async function load() {
  loading.value = true;
  try {
    // explain=1：带 q 时返回每条命中理由，解决"搜出来的结果凭什么排前面"
    const r = await api.products({ q: q.value, category: category.value, shopId: shopId.value || undefined, sort: sort.value, page: page.value, pageSize: 12, explain: 1 });
    items.value = r.items;
    total.value = r.total;
    suggestions.value = r.suggestions || [];
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

/** 零结果兜底：把"没有商品"变成"下一步能做什么" */
function applySuggestion(s: string) {
  if (s.startsWith('把「')) {
    // 取更短的关键词重试
    const shorter = q.value.slice(0, Math.max(2, Math.ceil(q.value.length / 2)));
    router.push({ name: 'category', query: { q: shorter } });
    return;
  }
  if (s.includes('价格')) {
    const m = q.value.match(/(\d{2,6})\s*(元|块)/);
    const stripped = m ? q.value.replace(m[0], '').trim() : q.value;
    router.push({ name: 'category', query: stripped ? { q: stripped } : {} });
    return;
  }
  router.push({ name: 'category' });
}

onMounted(async () => {
  const meta = await api.meta();
  categories.value = meta.categories;
  load();
});

watch(() => route.query, (nv) => {
  q.value = (nv.q as string) || '';
  category.value = (nv.category as string) || '';
  page.value = 1;
  load();
});

function setCategory(c: string) {
  router.push({ name: 'category', query: { ...(q.value ? { q: q.value } : {}), ...(c ? { category: c } : {}) } });
}

async function add(p: Product) {
  if (!auth.isLoggedIn) { router.push('/login'); return; }
  try {
    await cart.add(p.id, 1);
    toast.push(`已加入购物车：${p.title}`, 'success');
  } catch (e: any) {
    toast.push(e.message, 'error');
  }
}
</script>

<template>
  <div class="page">
    <div class="crumb">
      <router-link to="/shop">首页</router-link>
      <span>/</span>
      <span>{{ q ? `搜索「${q}」` : category || '全部商品' }}</span>
    </div>

    <div class="layout">
      <aside class="filters">
        <h3 class="filter-title">分类</h3>
        <button class="filter-item" :class="{ active: !category }" @click="setCategory('')">全部商品</button>
        <button v-for="c in categories" :key="c.name" class="filter-item"
                :class="{ active: category === c.name }" @click="setCategory(c.name)">
          {{ c.name }}<span class="dim mono">{{ c.count }}</span>
        </button>
      </aside>

      <div class="content">
        <div class="toolbar">
          <span class="dim">共 <b class="mono">{{ total }}</b> 件商品</span>
          <span v-if="q" class="query-tag">
            「{{ q }}」
            <button class="query-clear" @click="router.push({ name: 'category', query: category ? { category } : {} })">×</button>
          </span>
        </div>

        <div v-if="loading" class="grid">
          <div v-for="i in 6" :key="i" class="skeleton" style="aspect-ratio: 3/4" />
        </div>
        <div v-else-if="!items.length" class="empty">
          <div class="empty-icon">🔍</div>
          <p>没有找到「{{ q || category }}」的匹配商品</p>
          <p class="dim" style="font-size: 12px; margin-top: 6px">
            不是你的问题，是这类筛选条件下确实没有货。试试下面这几个：
          </p>
          <div class="suggestions">
            <button v-for="s in suggestions" :key="s" class="sugg" @click="applySuggestion(s)">
              {{ s }}
            </button>
            <button class="sugg sugg-ai" @click="router.push({ name: 'category' })">直接问 AI 导购，让它帮你挑</button>
          </div>
          <button class="btn btn-secondary" style="margin-top: 16px" @click="router.push({ name: 'category' })">
            浏览全部商品
          </button>
        </div>
        <div v-else class="grid">
          <ProductCard v-for="p in items" :key="p.id" :product="p" @add="add" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 1200px; margin: 0 auto; padding: 20px 24px 64px; }
.crumb { display: flex; gap: 6px; font-size: 12px; color: var(--text-3); margin-bottom: 20px; }
.crumb a:hover { color: var(--primary); }

.layout { display: grid; grid-template-columns: 180px 1fr; gap: 28px; align-items: start; }

.filters {
  position: sticky;
  top: 80px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 14px;
}
.filter-title { font-size: 12px; color: var(--text-3); font-weight: 500; margin: 0 0 8px 6px; }
.filter-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-2);
  text-align: left;
  transition: all 0.14s;
}
.filter-item:hover { background: var(--surface-2); color: var(--text); }
.filter-item.active { background: var(--primary-soft); color: var(--primary); font-weight: 500; }

.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; font-size: 13px; }
.query-tag {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--surface-2);
  padding: 2px 6px 2px 10px;
  border-radius: var(--r-full);
  font-size: 12px;
  color: var(--text-2);
}
.query-clear { border: 0; background: transparent; color: var(--text-3); font-size: 14px; line-height: 1; padding: 0 2px; }
.query-clear:hover { color: var(--danger); }

.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }

/* 零结果兜底：给出可点击的下一步，而不是死路 */
.suggestions { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; max-width: 360px; margin-left: auto; margin-right: auto; }
.sugg {
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  text-align: left;
  transition: all 0.14s;
}
.sugg:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.sugg-ai { border-style: dashed; color: var(--ai); border-color: color-mix(in srgb, var(--ai) 35%, transparent); }
.sugg-ai:hover { background: var(--ai-soft); color: var(--ai); border-color: var(--ai); }

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .filters { position: static; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .filter-title { width: 100%; margin-bottom: 0; }
  .filter-item { width: auto; }
  .grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
