<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';
import MultiSelect from '../../components/MultiSelect.vue';

const toast = useToast();

/** 与后端 DIMENSIONS 对齐；label 只影响展示 */
const DIMS = [
  { key: 'appearance', label: '外观', icon: '✨' },
  { key: 'performance', label: '性能', icon: '⚡' },
  { key: 'color', label: '颜色', icon: '🎨' },
  { key: 'quality', label: '质量', icon: '🛡' },
  { key: 'fit', label: '尺码', icon: '📏' },
  { key: 'taste', label: '口感', icon: '😋' },
  { key: 'fresh', label: '新鲜度', icon: '🌿' },
  { key: 'effect', label: '效果', icon: '💫' },
  { key: 'texture', label: '肤感', icon: '🫧' },
  { key: 'price', label: '性价比', icon: '💰' },
  { key: 'service', label: '服务物流', icon: '🚚' },
  { key: 'custom', label: '买家自创', icon: '🏷' },
];
/** 维度 key → 显示名：官方维度用 label，自建维度直接展示 token */
const dimLabel = (k: string) => {
  if (k.includes(',')) return k.split(',').map((x) => dimLabel(x)).join(' / ');
  return DIMS.find((d) => d.key === k)?.label || k;
};
const catLabel = (c: string) => (c ? c.split(',').join(' / ') : '全类目');

const items = ref<any[]>([]);
const total = ref(0);
const counts = ref<any>({});
const loading = ref(true);
const categories = ref<string[]>([]);
const page = ref(1);
const pageSize = 20;
const totalPages = ref(1);

/* ── 下拉选项维护：官方词表 + 类目 + 用户自建（localStorage 记忆） ── */
const LS_DIMS = 'aimall_tag_extra_dims';
const LS_CATS = 'aimall_tag_extra_cats';
const lsLoad = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const lsSave = (k: string, v: string[]) => localStorage.setItem(k, JSON.stringify(v));
const extraDims = ref<string[]>(lsLoad(LS_DIMS));
const extraCats = ref<string[]>(lsLoad(LS_CATS));

const dimOptions = computed(() => [
  ...DIMS.filter((d) => d.key !== 'custom').map((d) => ({ label: `${d.icon} ${d.label}`, value: d.key })),
  ...extraDims.value
    .filter((x) => !DIMS.some((d) => d.key === x))
    .map((x) => ({ label: x, value: x })),
]);
const catOptions = computed(() => {
  const set = new Set<string>(categories.value);
  for (const i of items.value) String(i.category || '').split(',').filter(Boolean).forEach((c) => set.add(c));
  extraCats.value.forEach((c) => set.add(c));
  return [...set];
});
function addExtraDim(v: string) { if (!dimOptions.value.includes(v)) { extraDims.value = [...extraDims.value, v]; lsSave(LS_DIMS, extraDims.value); } }
function addExtraCat(v: string) { if (!catOptions.value.includes(v)) { extraCats.value = [...extraCats.value, v]; lsSave(LS_CATS, extraCats.value); } }

const filters = reactive({ q: '', status: '', dimension: '' });
const showForm = ref(false);
const saving = ref(false);
const form = reactive({
  name: '', dimensions: ['appearance'] as string[], polarity: 'good', categories: [] as string[], status: 'active', sort: 0,
});

const editing = ref<any>(null);
const merging = ref<any>(null);
const mergeTarget = ref(0);

async function load() {
  loading.value = true;
  try {
    const r = await api.adminReviewTags({
      q: filters.q || undefined,
      status: filters.status || undefined,
      dimension: filters.dimension || undefined,
      page: page.value,
      pageSize,
    });
    items.value = r.items;
    total.value = r.total;
    counts.value = r.counts || {};
    totalPages.value = Math.max(1, Math.ceil((r.total || 0) / pageSize));
    if (page.value > totalPages.value) { page.value = totalPages.value; return load(); }
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
  load();
}

function applyFilters() {
  page.value = 1;
  load();
}

async function loadMeta() {
  try {
    const m: any = await api.meta();
    categories.value = (m.categories || []).map((c: any) => c.name);
  } catch { /* 类目拉不到不影响管理 */ }
}

onMounted(() => { load(); loadMeta(); });

function resetForm() {
  form.name = '';
  form.dimensions = ['appearance'];
  form.polarity = 'good';
  form.categories = [];
  form.status = 'active';
  form.sort = 0;
}

async function create() {
  if (!form.name.trim()) return toast.push('请填写标签名', 'error');
  if (!form.dimensions.length) return toast.push('请至少选择一个归属维度', 'error');
  saving.value = true;
  try {
    await api.createReviewTag({
      name: form.name.trim(),
      dimensions: form.dimensions,
      categories: form.categories,
      polarity: form.polarity,
      status: form.status,
      sort: form.sort,
    });
    toast.push('词条已创建', 'success');
    showForm.value = false;
    resetForm();
    await load();
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

function edit(row: any) {
  editing.value = {
    id: row.id, name: row.name,
    dimensions: String(row.dimension || '').split(',').filter(Boolean),
    categories: String(row.category || '').split(',').filter(Boolean),
    polarity: row.polarity, status: row.status, sort: row.sort,
  };
}

async function saveEdit() {
  if (!editing.value) return;
  saving.value = true;
  try {
    const { id, dimensions, categories, ...rest } = editing.value;
    await api.updateReviewTag(id, { ...rest, dimensions, categories });
    toast.push('已保存', 'success');
    editing.value = null;
    await load();
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function setStatus(row: any, status: string) {
  try {
    await api.updateReviewTag(row.id, { status });
    toast.push(status === 'active' ? '已启用' : status === 'pending' ? '已转为待审核' : '已屏蔽', 'success');
    await load();
  } catch (e: any) {
    toast.push(e.message, 'error');
  }
}

async function remove(row: any) {
  if (!window.confirm(`删除「${row.name}」？已被评价引用的词条会改为屏蔽，历史评价仍保留语义。`)) return;
  try {
    const r = await api.deleteReviewTag(row.id);
    toast.push(r.deleted ? '词条已删除' : `已被 ${r.used} 条评价引用，已改为屏蔽`, 'success');
    await load();
  } catch (e: any) {
    toast.push(e.message, 'error');
  }
}

function openMerge(row: any) {
  merging.value = row;
  mergeTarget.value = 0;
}

async function confirmMerge() {
  if (!merging.value || !mergeTarget.value) return toast.push('请选择合并目标', 'error');
  try {
    const r = await api.mergeReviewTag(merging.value.id, mergeTarget.value);
    toast.push(`已合并，迁移 ${r.merged} 条评价`, 'success');
    merging.value = null;
    await load();
  } catch (e: any) {
    toast.push(e.message, 'error');
  }
}

function statusLabel(s: string) {
  return s === 'active' ? '生效中' : s === 'pending' ? '待审核' : '已屏蔽';
}
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h1>评价标签</h1>
        <p>买家印象词库：按类目与维度维护候选标签，审核买家自创词，合并同义词。商品页标签云实时跟着这里变。</p>
      </div>
      <button class="btn btn-primary" @click="showForm = !showForm">
        {{ showForm ? '取消' : '+ 新增词条' }}
      </button>
    </div>

    <div class="kpis">
      <div class="kpi"><b>{{ counts.all || 0 }}</b><span>全部词条</span></div>
      <div class="kpi"><b>{{ counts.active || 0 }}</b><span>生效中</span></div>
      <div class="kpi warn"><b>{{ counts.pending || 0 }}</b><span>待审核</span></div>
      <div class="kpi"><b>{{ counts.blocked || 0 }}</b><span>已屏蔽</span></div>
      <div class="kpi"><b>{{ counts.used || 0 }}</b><span>被使用过</span></div>
    </div>

    <div v-if="showForm" class="card card-pad form">
      <h2 class="block-title">新增词条</h2>
      <div class="grid-3">
        <div class="field">
          <label>标签名（2–8 字）</label>
          <input v-model="form.name" class="input" maxlength="8" placeholder="如：屏幕通透" @keyup.enter="create" />
        </div>
        <div class="field">
          <label>归属维度（可多选）</label>
          <MultiSelect v-model="form.dimensions" :options="dimOptions" placeholder="选择维度，可多选" @add="addExtraDim" />
        </div>
        <div class="field">
          <label>褒贬倾向</label>
          <select v-model="form.polarity" class="input">
            <option value="good">正向（夸）</option>
            <option value="bad">负向（吐槽）</option>
            <option value="neutral">中性</option>
          </select>
        </div>
        <div class="field">
          <label>适用类目（可多选，留空 = 全类目）</label>
          <MultiSelect v-model="form.categories" :options="catOptions" placeholder="全类目通用 / 选择类目" @add="addExtraCat" />
        </div>
        <div class="field">
          <label>状态</label>
          <select v-model="form.status" class="input">
            <option value="active">生效中</option>
            <option value="pending">待审核</option>
            <option value="blocked">屏蔽</option>
          </select>
        </div>
        <div class="field">
          <label>排序（越小越靠前）</label>
          <input v-model.number="form.sort" type="number" class="input" min="0" max="9999" />
        </div>
      </div>
      <p class="hint">维度与类目的下拉选项可以自行维护：在多选框底部输入新选项回车即可创建，会一直保留在选项里。</p>
      <div class="form-actions">
        <button class="btn btn-primary" :disabled="saving" @click="create">{{ saving ? '保存中…' : '创建词条' }}</button>
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <input v-model="filters.q" class="input" placeholder="搜标签名" style="width: 160px" @keyup.enter="applyFilters" />
        <select v-model="filters.status" class="input" style="width: 130px" @change="applyFilters">
          <option value="">全部状态</option>
          <option value="pending">待审核</option>
          <option value="active">生效中</option>
          <option value="blocked">已屏蔽</option>
        </select>
        <select v-model="filters.dimension" class="input" style="width: 150px" @change="applyFilters">
          <option value="">全部维度</option>
          <option v-for="d in DIMS" :key="d.key" :value="d.key">{{ d.label }}</option>
        </select>
        <button class="btn btn-secondary btn-sm" @click="applyFilters">筛选</button>
        <span class="dim" style="margin-left: auto">共 {{ total }} 条</span>
      </div>

      <div v-if="loading" class="pad dim">加载中…</div>
      <div v-else-if="!items.length" class="pad dim">没有匹配的词条</div>
      <table v-else class="tbl">
        <thead>
          <tr>
            <th>标签</th><th>维度</th><th>倾向</th><th>类目</th>
            <th>引用</th><th>来源</th><th>状态</th><th style="width: 260px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in items" :key="r.id" :class="{ pending: r.status === 'pending' }">
            <td class="strong">{{ r.name }}</td>
            <td><span class="dim-chip">{{ dimLabel(r.dimension) }}</span></td>
            <td>
              <span class="pol" :class="r.polarity">{{ r.polarity === 'good' ? '正向' : r.polarity === 'bad' ? '负向' : '中性' }}</span>
            </td>
            <td class="dim">{{ catLabel(r.category) }}</td>
            <td class="mono">{{ r.useCount }}</td>
            <td class="dim">{{ r.source === 'user' ? '买家自创' : '官方' }}</td>
            <td><span class="status" :class="r.status">{{ statusLabel(r.status) }}</span></td>
            <td class="ops">
              <button v-if="r.status === 'pending'" class="link ok" @click="setStatus(r, 'active')">通过</button>
              <button v-if="r.status === 'active'" class="link" @click="setStatus(r, 'blocked')">屏蔽</button>
              <button v-if="r.status === 'blocked'" class="link ok" @click="setStatus(r, 'active')">启用</button>
              <button class="link" @click="edit(r)">编辑</button>
              <button class="link" @click="openMerge(r)">合并</button>
              <button class="link danger" @click="remove(r)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="totalPages > 1" class="pager">
        <button class="pg-btn" :disabled="page <= 1" @click="goPage(page - 1)">‹ 上一页</button>
        <span class="pg-info">
          第
          <select v-model.number="page" class="pg-select" @change="load()">
            <option v-for="p in totalPages" :key="p" :value="p">{{ p }}</option>
          </select>
          / {{ totalPages }} 页 · 每页 {{ pageSize }} 条
        </span>
        <button class="pg-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页 ›</button>
      </div>
    </div>

    <!-- 编辑 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal card">
        <h3 class="modal-title">编辑词条</h3>
        <div class="grid-2">
          <div class="field"><label>标签名</label><input v-model="editing.name" class="input" maxlength="8" /></div>
          <div class="field">
            <label>归属维度（可多选）</label>
            <MultiSelect v-model="editing.dimensions" :options="dimOptions" placeholder="选择维度" @add="addExtraDim" />
          </div>
          <div class="field">
            <label>倾向</label>
            <select v-model="editing.polarity" class="input">
              <option value="good">正向</option><option value="bad">负向</option><option value="neutral">中性</option>
            </select>
          </div>
          <div class="field">
            <label>适用类目（可多选）</label>
            <MultiSelect v-model="editing.categories" :options="catOptions" placeholder="全类目通用 / 选择类目" @add="addExtraCat" />
          </div>
          <div class="field">
            <label>状态</label>
            <select v-model="editing.status" class="input">
              <option value="active">生效中</option><option value="pending">待审核</option><option value="blocked">已屏蔽</option>
            </select>
          </div>
          <div class="field"><label>排序</label><input v-model.number="editing.sort" type="number" class="input" min="0" max="9999" /></div>
        </div>
        <p class="hint">把买家自创标签的维度改成「外观 / 性能 / 颜色…」，它就会进入对应维度的公共标签云。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="editing = null">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="saveEdit">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 合并 -->
    <div v-if="merging" class="modal-mask" @click.self="merging = null">
      <div class="modal card">
        <h3 class="modal-title">合并「{{ merging.name }}」</h3>
        <p class="hint">合并后，来源标签下的评价会迁到目标标签，来源标签自动屏蔽。</p>
        <div class="field">
          <label>合并到</label>
          <select v-model.number="mergeTarget" class="input">
            <option :value="0">请选择目标标签</option>
            <option v-for="r in items.filter(x => x.id !== merging.id && x.status === 'active')" :key="r.id" :value="r.id">
              {{ dimLabel(r.dimension) }} · {{ r.name }}（{{ r.useCount }}）
            </option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="merging = null">取消</button>
          <button class="btn btn-primary" :disabled="!mergeTarget" @click="confirmMerge">确认合并</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
.head h1 { font-size: 20px; margin: 0 0 6px; }
.head p { margin: 0; font-size: 13px; color: var(--text-3); max-width: 720px; }
.kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 16px; }
.kpi { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 10px rgba(0, 0, 0, .04); }
.kpi b { display: block; font-size: 22px; }
.kpi span { font-size: 12px; color: var(--text-3); }
.kpi.warn b { color: #b45309; }
.form { margin-bottom: 16px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.pad { padding: 20px; }
.dim { color: var(--text-3); font-size: 12px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { text-align: left; padding: 10px 14px; background: var(--surface-2); font-weight: 500; color: var(--text-3); font-size: 12px; }
.tbl td { padding: 10px 14px; border-top: 1px solid var(--line); vertical-align: middle; }
.tbl tr.pending { background: #fffbeb; }
.strong { font-weight: 600; }
.mono { font-variant-numeric: tabular-nums; }
.dim-chip { font-size: 11px; background: var(--surface-2); color: var(--text-2); border-radius: 6px; padding: 2px 8px; }
.pol { font-size: 11px; border-radius: 99px; padding: 2px 8px; background: #eef2ff; color: #4338ca; }
.pol.bad { background: #fef2f2; color: #b91c1c; }
.pol.neutral { background: #f3f4f6; color: #4b5563; }
.status { font-size: 11px; border-radius: 99px; padding: 2px 8px; background: var(--surface-2); color: var(--text-2); }
.status.active { background: #ecfdf5; color: #047857; }
.status.pending { background: #fef3c7; color: #b45309; }
.status.blocked { background: #f3f4f6; color: #9ca3af; }
.ops { display: flex; gap: 10px; flex-wrap: wrap; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line); }
.pg-btn { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 4px 10px; font-size: 12px; color: var(--text-2); cursor: pointer; }
.pg-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.pg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pg-info { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 4px; }
.pg-select { border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px; font-size: 12px; }
.link { border: 0; background: transparent; color: var(--primary); font-size: 12px; cursor: pointer; padding: 0; }
.link.ok { color: var(--success); }
.link.danger { color: #e53935; }
.link:hover { text-decoration: underline; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, .35); display: grid; place-items: center; z-index: 500; padding: 20px; }
.modal { width: 560px; max-width: 100%; padding: 22px; }
.modal-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.hint { font-size: 12px; color: var(--text-3); line-height: 1.6; margin: 10px 0 0; }
@media (max-width: 1000px) { .kpis { grid-template-columns: repeat(2, 1fr); } .grid-3, .grid-2 { grid-template-columns: 1fr; } }
</style>
