<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';

const toast = useToast();
const items = ref<any[]>([]);
const loading = ref(true);
const showForm = ref(false);
const saving = ref(false);
const products = ref<any[]>([]);

const form = reactive({
  title: '', body: '', cover: '🎁',
  media: 'linear-gradient(135deg,#f6d365,#fda085)',
  productIds: [] as number[],
});

const COVERS = ['🎁', '🎧', '💡', '☕', '🧥', '🥣', '🌬️', '📱', '👟', '🕯️'];
const GRADIENTS = [
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f6d365,#fda085)',
  'linear-gradient(135deg,#a1c4fd,#c2e9fb)',
  'linear-gradient(135deg,#84fab0,#8fd3f4)',
  'linear-gradient(135deg,#d4a373,#ccd5ae)',
  'linear-gradient(135deg,#e0c3fc,#8ec5fc)',
];

async function load() {
  loading.value = true;
  try {
    const [f, p] = await Promise.all([api.adminFeeds(), api.adminProducts()]);
    items.value = f.items;
    products.value = p.items || p;
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}
onMounted(load);

function toggleProduct(id: number) {
  const i = form.productIds.indexOf(id);
  if (i >= 0) form.productIds.splice(i, 1);
  else if (form.productIds.length < 3) form.productIds.push(id);
}

async function create() {
  saving.value = true;
  try {
    await api.createFeed({ ...form });
    toast.push('内容已发布', 'success');
    showForm.value = false;
    form.title = ''; form.body = ''; form.productIds = [];
    await load();
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { saving.value = false; }
}

async function remove(id: number) {
  if (!window.confirm('下线这条内容？')) return;
  await api.deleteFeed(id);
  toast.push('已下线', 'success');
  await load();
}
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h1>内容管理</h1>
        <p>逛逛内容即货架：一条内容最多挂 3 个商品，用户点开直接下单。</p>
      </div>
      <button class="btn btn-primary" @click="showForm = !showForm">{{ showForm ? '取消' : '+ 发布内容' }}</button>
    </div>

    <div v-if="showForm" class="card card-pad form">
      <h2 class="block-title">发布内容</h2>
      <div class="field"><label>标题</label><input v-model="form.title" class="input" placeholder="如：通勤降噪实测" maxlength="80" /></div>
      <div class="field" style="margin-top: 10px"><label>正文</label>
        <textarea v-model="form.body" class="textarea" rows="3" placeholder="写点真实的体验，别写成广告" maxlength="2000" />
      </div>
      <div class="field" style="margin-top: 10px">
        <label>封面图标</label>
        <div class="pick-row">
          <button v-for="c in COVERS" :key="c" class="pick" :class="{ on: form.cover === c }" @click="form.cover = c">{{ c }}</button>
        </div>
      </div>
      <div class="field" style="margin-top: 10px">
        <label>封面配色</label>
        <div class="pick-row">
          <button v-for="g in GRADIENTS" :key="g" class="swatch" :class="{ on: form.media === g }"
                  :style="{ background: g }" @click="form.media = g" />
        </div>
      </div>
      <div class="field" style="margin-top: 10px">
        <label>挂载商品（最多 3 个，已选 {{ form.productIds.length }}）</label>
        <div class="prod-pick">
          <button v-for="p in products" :key="p.id" class="pp" :class="{ on: form.productIds.includes(p.id) }"
                  @click="toggleProduct(p.id)">
            <span>{{ p.image }}</span>{{ p.title }}
          </button>
        </div>
      </div>
      <button class="btn btn-primary" style="margin-top: 14px" :disabled="saving || form.title.trim().length < 2" @click="create">
        {{ saving ? '发布中…' : '发布' }}
      </button>
    </div>

    <div v-if="loading" class="card card-pad">加载中…</div>
    <div v-else class="grid">
      <div v-for="f in items" :key="f.id" class="fcard">
        <div class="cover" :style="{ background: f.media }">{{ f.cover }}</div>
        <div class="body">
          <div class="title">{{ f.title }}</div>
          <div class="dim">{{ f.authorName }} · ♥ {{ f.likes }} · 浏览 {{ f.views }}</div>
          <div class="tags">
            <span v-for="p in f.products" :key="p.id" class="tag">{{ p.title }}</span>
          </div>
          <button class="btn btn-secondary btn-sm" @click="remove(f.id)">下线</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.head h1 { font-size: 20px; margin: 0 0 6px; }
.head p { margin: 0; font-size: 13px; color: var(--text-3); }
.form { margin-bottom: 16px; }
.pick-row { display: flex; gap: 8px; flex-wrap: wrap; }
.pick { width: 40px; height: 40px; border: 2px solid transparent; border-radius: 10px; background: var(--surface-2);
  font-size: 20px; cursor: pointer; }
.pick.on { border-color: #e53935; background: #fff5f5; }
.swatch { width: 40px; height: 32px; border: 2px solid transparent; border-radius: 8px; cursor: pointer; }
.swatch.on { border-color: #111827; }
.prod-pick { display: flex; flex-wrap: wrap; gap: 6px; max-height: 150px; overflow: auto; }
.pp { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 5px 10px; font-size: 12px;
  cursor: pointer; display: flex; gap: 6px; align-items: center; }
.pp.on { border-color: #e53935; background: #fff5f5; color: #b91c1c; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.fcard { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.04); }
.cover { height: 110px; display: grid; place-items: center; font-size: 40px; }
.body { padding: 12px; }
.title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.dim { color: var(--text-3); font-size: 12px; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
.tag { font-size: 11px; background: var(--surface-2); border-radius: 6px; padding: 2px 7px; color: var(--text-2); }
</style>
