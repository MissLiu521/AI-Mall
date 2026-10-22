<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../../api';
import { useToast } from '../../store';
import { formatTime } from '../../utils/format';

const toast = useToast();
const items = ref<any[]>([]);
const total = ref(0);
const rating = ref(0);
const keyword = ref('');
const tagId = ref(0);
const category = ref('');
const tagOptions = ref<any[]>([]);
const categories = ref<string[]>([]);
const loading = ref(true);
const page = ref(1);
const totalPages = ref(1);
const PAGE_SIZE = 10;

async function load() {
  loading.value = true;
  try {
    const r = await api.adminReviews({
      rating: rating.value || undefined,
      q: keyword.value || undefined,
      tagId: tagId.value || undefined,
      category: category.value || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    });
    items.value = r.items;
    total.value = r.total;
    totalPages.value = Math.max(1, Math.ceil((r.total || 0) / PAGE_SIZE));
    if (page.value > totalPages.value) { page.value = totalPages.value; return load(); }
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}

function applyFilters() { page.value = 1; load(); }

function goPage(p: number) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
  load();
}

async function loadMeta() {
  try {
    const m: any = await api.meta();
    categories.value = (m.categories || []).map((c: any) => c.name);
  } catch { /* 分类拉不到不影响列表 */ }
}

async function loadTagOptions() {
  try {
    const r = await api.adminReviewTags({ status: 'active', pageSize: 100 });
    tagOptions.value = r.items;
  } catch { /* 词库拉不到不影响看评价 */ }
}

onMounted(() => { load(); loadMeta(); loadTagOptions(); });

function dimText(d: any) {
  const labels: Record<string, string> = {
    appearance: '外观', performance: '性能', color: '颜色', quality: '质量', fit: '尺码',
    taste: '口感', fresh: '新鲜度', effect: '效果', texture: '肤感', price: '性价比', service: '物流',
  };
  return Object.entries(d || {}).map(([k, v]) => `${labels[k] || k} ${v}`).join(' · ');
}

async function reply(r: any) {
  const text = window.prompt(`回复「${r.productTitle}」的评价：`, r.reply || '');
  if (!text?.trim()) return;
  try {
    await api.replyReview(r.id, text.trim());
    r.reply = text.trim();
    toast.push('已回复', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
}
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h1>评价管理</h1>
        <p>共 {{ total }} 条评价。标签与分项评分会直接出现在商品页「买家印象」里。</p>
      </div>
      <div class="filters">
        <input v-model="keyword" class="input" placeholder="搜商品名" style="width: 170px" @keyup.enter="applyFilters" />
        <select v-model="category" class="input" style="width: 130px" @change="applyFilters">
          <option value="">全部分类</option>
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
        <select v-model.number="rating" class="input" style="width: 110px" @change="applyFilters">
          <option :value="0">全部星级</option>
          <option v-for="s in [5, 4, 3, 2, 1]" :key="s" :value="s">{{ s }} 星</option>
        </select>
        <select v-model.number="tagId" class="input" style="width: 160px" @change="applyFilters">
          <option :value="0">全部标签</option>
          <option v-for="t in tagOptions" :key="t.id" :value="t.id">{{ t.dimensionLabel }} · {{ t.name }}</option>
        </select>
        <button class="f-btn primary" @click="applyFilters">筛选</button>
        <RouterLink to="/admin/review-tags" class="f-btn ghost">标签词库 →</RouterLink>
      </div>
    </div>

    <div v-if="loading" class="card card-pad">加载中…</div>
    <div v-else-if="!items.length" class="card card-pad dim">暂无评价</div>

    <div v-else class="list">
      <div v-for="r in items" :key="r.id" class="rev card">
        <div class="rev-head">
          <span class="prod">{{ r.productTitle }}</span>
          <span class="stars">{{ '★'.repeat(r.rating) }}<span class="off">{{ '★'.repeat(5 - r.rating) }}</span></span>
          <span class="dim">{{ r.userName }}</span>
          <span v-if="r.rewardCents" class="reward">返 ¥{{ (r.rewardCents / 100).toFixed(2) }}</span>
          <span class="dim time">{{ formatTime(r.createdAt) }}</span>
        </div>
        <p class="content">{{ r.content || '（无文字评价）' }}</p>
        <div v-if="r.tags?.length" class="rev-tags">
          <span
            v-for="t in r.tags" :key="t.id" class="rt-tag"
            :class="{ bad: t.polarity === 'bad', custom: t.dimension === 'custom' }"
          >{{ t.name }}</span>
        </div>
        <p v-if="dimText(r.dimensions)" class="rev-dims">分项：{{ dimText(r.dimensions) }}</p>
        <div v-if="r.video || r.images?.length" class="rev-media">
          <video v-if="r.video" :src="r.video" controls playsinline class="rm-video" />
          <a v-for="(img, i) in (r.images || [])" :key="i" :href="img" target="_blank" class="rm-thumb">
            <img :src="img" :alt="`晒图 ${i + 1}`" loading="lazy" />
          </a>
        </div>
        <div v-if="r.reply" class="reply"><b>已回复：</b>{{ r.reply }}</div>
        <div class="foot">
          <span class="dim">有用 {{ r.useful }}</span>
          <button class="btn btn-secondary btn-sm" @click="reply(r)">{{ r.reply ? '修改回复' : '回复' }}</button>
        </div>
      </div>

      <div v-if="totalPages > 1" class="card pager">
        <span class="dim">共 {{ total }} 条评价</span>
        <div class="pg-group">
          <button class="pg-btn" :disabled="page <= 1" @click="goPage(page - 1)">‹ 上一页</button>
          <span class="pg-info">
            第
            <select v-model.number="page" class="pg-select" @change="load()">
              <option v-for="p in totalPages" :key="p" :value="p">{{ p }}</option>
            </select>
            / {{ totalPages }} 页
          </span>
          <button class="pg-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页 ›</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
.head h1 { font-size: 20px; margin: 0 0 6px; }
.head p { margin: 0; font-size: 13px; color: var(--text-3); }
.filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
/* 筛选按钮：统一高度与配色，主操作实心、跳转次操作描边 */
.f-btn {
  height: 34px; padding: 0 16px;
  border-radius: 8px; font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center;
  transition: all 0.15s;
}
.f-btn.primary { background: var(--primary); color: #fff; border: 1px solid var(--primary); }
.f-btn.primary:hover { opacity: 0.9; }
.f-btn.ghost { background: var(--surface); color: var(--primary); border: 1px solid #c7d2fe; }
.f-btn.ghost:hover { background: var(--primary-soft); }
.filters .input { height: 34px; }
.pager { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.pg-group { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.pg-btn { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 4px 10px; font-size: 12px; color: var(--text-2); cursor: pointer; }
.pg-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.pg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pg-info { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 4px; }
.pg-select { border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px; font-size: 12px; }
.list { display: flex; flex-direction: column; gap: 12px; }
.rev { padding: 16px; }
.rev-head { display: flex; align-items: center; gap: 10px; font-size: 13px; flex-wrap: wrap; }
.prod { font-weight: 600; }
.stars { color: #fbbf24; letter-spacing: 1px; }
.off { color: #e5e7eb; }
.time { margin-left: auto; }
.content { margin: 8px 0 0; font-size: 13px; line-height: 1.65; }
.rev-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.rt-tag { font-size: 11px; background: #eef2ff; color: #4338ca; border-radius: 99px; padding: 2px 9px; }
.rt-tag.bad { background: #fef2f2; color: #b91c1c; }
.rt-tag.custom { background: #ecfdf5; color: #047857; }
.rev-dims { margin: 6px 0 0; font-size: 11px; color: var(--text-3); }
.reply { margin-top: 10px; background: var(--surface-2); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
.dim { color: var(--text-3); font-size: 12px; }
.reward {
  font-size: 11px; color: #b45309; background: #fef3c7;
  padding: 1px 7px; border-radius: var(--r-full);
}
.rev-media { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: flex-start; }
.rm-thumb { width: 72px; height: 72px; border-radius: 8px; overflow: hidden; background: var(--surface-2); }
.rm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rm-video { width: 150px; max-height: 150px; border-radius: 8px; background: #000; }
</style>
