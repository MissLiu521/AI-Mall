<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, uploadMedia } from '../../api';
import { useToast } from '../../store';
import type { Product } from '../../api/types';

const toast = useToast();
const list = ref<Product[]>([]);
const loading = ref(true);
const q = ref('');
const editing = ref<Partial<Product> | null>(null);
const saving = ref(false);
const categories = ref<string[]>([]);

async function loadMeta() {
  try {
    const m: any = await api.meta();
    categories.value = (m.categories || []).map((c: any) => c.name);
  } catch { /* 类目拉不到时回退手输 */ }
}
onMounted(() => { load(); loadMeta(); });

/* ── AI 智能填充：一句话/图片 → 草稿 → 可重新生成 → 确认回填 ── */
const aiHint = ref('');
const aiSeed = ref(0);
const aiDraft = ref<any>(null);
const aiGenerating = ref(false);
const aiImageName = ref('');
const aiFileInput = ref<HTMLInputElement>();
// 图片处理方式：choice=刚传完图待选择 / guide=AI 逐步解析引导 / manual=自己描述
const aiMode = ref<'' | 'choice' | 'guide' | 'manual'>('');

/** 图片解析引导步骤；选项支持点选，AI 会按文件名先给出猜测 */
const GUIDE_STEPS = [
  { key: 'category', title: '图片里的商品属于哪个品类？', options: ['数码', '家居', '服饰', '美妆', '个护', '食品', '其他'] },
  { key: 'crowd', title: '主要面向什么人群 / 场景？', options: ['学生党', '上班族', '送人', '居家日用', '户外运动', '通用'] },
  { key: 'price', title: '大概定价在哪个区间？', options: ['50 元内', '50-100 元', '100-300 元', '300-800 元', '800 元以上'] },
];
const guideStep = ref(0);
const guideAnswers = ref<Record<string, string>>({});

const CAT_GUESS: [RegExp, string][] = [
  [/耳机|手机|pad|电脑|键盘|鼠标|音箱|充电|camera|相机/i, '数码'],
  [/lamp|灯|cup|杯|chair|椅|desk|桌|home/i, '家居'],
  [/shirt|wear|shoe|鞋|coat|衣/i, '服饰'],
  [/lip|mask|cream|妆/i, '美妆'],
  [/soap|洗|wash/i, '个护'],
  [/tea|coffee|snack|food|茶|咖啡/i, '食品'],
];

function guessCategory(name: string) {
  for (const [re, cat] of CAT_GUESS) if (re.test(name)) return cat;
  return '其他';
}

async function onAiImage(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (!files?.length) return;
  const f = files[0];
  aiImageName.value = f.name;
  try { await uploadMedia(f); } catch { /* 上传失败不阻塞，仅用文件名做线索 */ }
  aiMode.value = 'choice';
}

/** AI 智能解析：按图片线索逐步引导确认，最后生成草稿 */
function startGuide() {
  aiMode.value = 'guide';
  guideStep.value = 0;
  guideAnswers.value = { category: guessCategory(aiImageName.value) };
}

function pickGuide(step: number, opt: string) {
  guideAnswers.value = { ...guideAnswers.value, [GUIDE_STEPS[step].key]: opt };
  if (step < GUIDE_STEPS.length - 1) {
    guideStep.value = step + 1;
  } else {
    const a = guideAnswers.value;
    aiHint.value = [aiImageName.value.replace(/\.[a-z0-9]+$/i, ''), a.category, a.crowd, a.price].filter(Boolean).join('，');
    aiMode.value = '';
    generateDraft();
  }
}

function chooseManual() {
  aiMode.value = 'manual';
}

async function generateDraft(regen = false) {
  if (!aiHint.value.trim()) { toast.push('先给一句商品描述，或上传图片让 AI 解析', 'error'); return; }
  if (regen) aiSeed.value += 1;
  aiGenerating.value = true;
  try {
    const d = editing.value || {};
    aiDraft.value = await api.aiProductDraft({
      hint: aiHint.value.trim(),
      seed: aiSeed.value,
      imageName: aiImageName.value || undefined,
      partial: {
        ...(d.category ? { category: d.category } : {}),
        ...(d.price ? { price: d.price } : {}),
        ...(d.stock ? { stock: d.stock } : {}),
      },
    });
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { aiGenerating.value = false; }
}

function applyAiDraft() {
  const d = aiDraft.value;
  if (!d || !editing.value) return;
  editing.value = {
    ...editing.value,
    title: d.title, subtitle: d.subtitle, description: d.description,
    price: d.price, compareAt: d.compareAt, stock: d.stock,
    category: d.category, tags: [...(d.tags || [])], image: d.image,
  };
  toast.push('已回填表单，检查后保存即可', 'success');
}

/** 列表「AI 文案」：打开抽屉并生成草稿预览，用户确认后才应用 */
function aiCopy(p: Product) {
  editing.value = { ...p, tags: [...p.tags] };
  aiHint.value = `${p.title}，${p.category}，当前售价 ¥${p.price}${p.subtitle ? '，' + p.subtitle : ''}`;
  aiDraft.value = null;
  aiSeed.value = 0;
  aiMode.value = '';
  generateDraft();
}

async function load() {
  loading.value = true;
  try {
    const r = await api.adminProducts({ q: q.value });
    list.value = r.items;
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}

function blank() {
  editing.value = { title: '', subtitle: '', description: '', price: 0, stock: 0, category: '其他', tags: [], image: '📦', status: 'active', compareAt: null };
}

function edit(p: Product) {
  editing.value = { ...p, tags: [...p.tags] };
}

async function save() {
  if (!editing.value) return;
  const d = editing.value;
  if (!d.title) { toast.push('请填写商品标题', 'error'); return; }
  saving.value = true;
  try {
    const payload = {
      title: d.title, subtitle: d.subtitle, description: d.description,
      price: d.price, compareAt: d.compareAt || null, stock: d.stock,
      category: d.category, tags: d.tags, image: d.image, status: d.status,
    };
    if (d.id) await api.updateProduct(d.id, payload);
    else await api.createProduct(payload);
    toast.push(d.id ? '已保存' : '已创建', 'success');
    editing.value = null;
    await load();
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { saving.value = false; }
}

async function toggleStatus(p: Product) {
  try {
    await api.updateProduct(p.id, { status: p.status === 'active' ? 'inactive' : 'active' });
    await load();
    toast.push(p.status === 'active' ? '已下架' : '已上架', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
}

async function remove(p: Product) {
  if (!confirm(`确认删除「${p.title}」？此操作不可撤销。`)) return;
  try {
    await api.deleteProduct(p.id);
    await load();
    toast.push('已删除', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="row gap-8">
        <input v-model="q" class="input" style="width: 240px" placeholder="搜索商品名称" @keyup.enter="load" />
        <button class="btn btn-secondary btn-sm" @click="load">搜索</button>
      </div>
      <button class="btn btn-primary btn-sm" @click="blank">＋ 新增商品</button>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 56px">ID</th>
            <th>商品</th>
            <th style="width: 90px">分类</th>
            <th style="width: 100px">价格</th>
            <th style="width: 80px">库存</th>
            <th style="width: 80px">销量</th>
            <th style="width: 80px">状态</th>
            <th style="width: 210px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="8" style="text-align: center; padding: 40px" class="dim">加载中…</td></tr>
          <tr v-else-if="!list.length"><td colspan="8" class="empty">没有商品</td></tr>
          <tr v-for="p in list" v-else :key="p.id">
            <td class="mono dim">{{ p.id }}</td>
            <td>
              <div class="row gap-8">
                <span class="thumb">{{ p.image }}</span>
                <div style="min-width: 0">
                  <div class="p-title">{{ p.title }}</div>
                  <div class="p-sub dim">{{ p.subtitle }}</div>
                </div>
              </div>
            </td>
            <td><span class="badge badge-muted">{{ p.category }}</span></td>
            <td class="mono">¥{{ p.price }}</td>
            <td class="mono" :class="{ 'low': p.stock < 20 }">{{ p.stock }}</td>
            <td class="mono dim">{{ p.sales }}</td>
            <td>
              <span class="badge" :class="p.status === 'active' ? 'badge-success' : 'badge-muted'">
                {{ p.status === 'active' ? '在售' : '已下架' }}
              </span>
            </td>
            <td>
              <div class="row gap-4">
                <button class="link-btn" @click="edit(p)">编辑</button>
                <button class="link-btn ai" @click="aiCopy(p)">AI 文案</button>
                <button class="link-btn" @click="toggleStatus(p)">{{ p.status === 'active' ? '下架' : '上架' }}</button>
                <button class="link-btn danger" @click="remove(p)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 编辑抽屉 -->
    <transition name="fade">
      <div v-if="editing" class="mask" @click.self="editing = null">
        <div class="drawer">
          <header class="drawer-head">
            <h3>{{ editing.id ? '编辑商品' : '新增商品' }}</h3>
            <button class="close" @click="editing = null">×</button>
          </header>
          <div class="drawer-body">
            <!-- AI 智能填充 -->
            <div class="ai-panel">
              <div class="ai-head">
                <span class="ai-badge">✦ AI 智能填充</span>
                <span class="dim" style="font-size: 11px">给一句话描述或图片，AI 生成全部字段，确认后回填</span>
              </div>
              <div class="ai-row">
                <button class="ai-img-btn" title="上传图片供 AI 参考" @click="aiFileInput?.click()">
                  {{ aiImageName ? '🖼 ' + aiImageName.slice(0, 8) : '＋ 图片' }}
                  <input ref="aiFileInput" type="file" accept="image/*" hidden @change="onAiImage" />
                </button>
                <span v-if="aiImageName" class="dim" style="font-size: 11px">图片已就绪</span>
              </div>

              <!-- 传图后：两种解析方式 -->
              <div v-if="aiMode === 'choice'" class="ai-choice">
                <p class="ai-choice-title">图片已上传，想怎么用？</p>
                <div class="ai-choice-btns">
                  <button class="ai-option" @click="startGuide">
                    <b>🤖 AI 智能解析</b>
                    <span>AI 识别图片内容，一步步引导你确认信息</span>
                  </button>
                  <button class="ai-option" @click="chooseManual">
                    <b>✍️ 我自己描述</b>
                    <span>你来描述图片里的商品，AI 按描述生成</span>
                  </button>
                </div>
              </div>

              <!-- AI 逐步引导 -->
              <div v-if="aiMode === 'guide'" class="ai-guide">
                <div class="ai-guide-head">
                  <span>AI 解析 · 第 {{ guideStep + 1 }} / {{ GUIDE_STEPS.length }} 步</span>
                  <button class="link-btn" @click="aiMode = 'choice'">返回</button>
                </div>
                <p class="ai-guide-q">{{ GUIDE_STEPS[guideStep].title }}</p>
                <div class="ai-guide-opts">
                  <button
                    v-for="opt in GUIDE_STEPS[guideStep].options" :key="opt"
                    class="g-chip" :class="{ sel: guideAnswers[GUIDE_STEPS[guideStep].key] === opt }"
                    @click="pickGuide(guideStep, opt)"
                  >{{ opt }}</button>
                </div>
              </div>

              <!-- 自己描述模式 -->
              <div v-if="aiMode === 'manual'" class="ai-guide">
                <div class="ai-guide-head">
                  <span>描述图片里的商品</span>
                  <button class="link-btn" @click="aiMode = 'choice'">返回</button>
                </div>
              </div>

              <div class="ai-row">
                <input
                  v-model="aiHint" class="input grow"
                  :placeholder="aiMode === 'manual' ? '如：白色陶瓷马克杯，带木柄，适合送人' : '如：无线蓝牙降噪耳机，199 元，主打通勤'"
                  @keyup.enter="generateDraft()"
                />
              </div>
              <div class="ai-row">
                <button class="btn btn-ai btn-sm" :disabled="aiGenerating" @click="generateDraft()">
                  {{ aiGenerating ? '生成中…' : aiDraft ? '重新生成' : '生成商品信息' }}
                </button>
                <span v-if="aiDraft" class="dim" style="font-size: 11px">
                  {{ aiDraft.source === 'model' ? '由远端模型生成' : '由本地引擎生成 · 配置模型 Key 后效果更佳' }}
                </span>
              </div>
              <div v-if="aiDraft" class="ai-draft">
                <div class="d-title">{{ aiDraft.image }} {{ aiDraft.title }}</div>
                <div class="d-sub">{{ aiDraft.subtitle }}</div>
                <div class="d-meta">
                  <span>¥{{ aiDraft.price }}（划线价 ¥{{ aiDraft.compareAt }}）</span>
                  <span>库存 {{ aiDraft.stock }}</span>
                  <span>分类 {{ aiDraft.category }}</span>
                </div>
                <div class="d-tags"><span v-for="t in aiDraft.tags" :key="t" class="d-tag">{{ t }}</span></div>
                <p class="d-desc">{{ aiDraft.description }}</p>
                <div class="d-actions">
                  <button class="btn btn-primary btn-sm" @click="applyAiDraft">✓ 确认并回填</button>
                  <button class="btn btn-secondary btn-sm" :disabled="aiGenerating" @click="generateDraft(true)">↻ 不满意，换一版</button>
                </div>
              </div>
            </div>

            <div class="field">
              <label>标题</label>
              <input v-model="editing.title" class="input" placeholder="商品主标题" />
            </div>
            <div class="field">
              <label>副标题</label>
              <input v-model="editing.subtitle" class="input" placeholder="一句话卖点" />
            </div>
            <div class="row gap-12">
              <div class="field grow">
                <label>价格（元）</label>
                <input v-model.number="editing.price" class="input" type="number" min="0" step="0.01" />
              </div>
              <div class="field grow">
                <label>划线价（元）</label>
                <input v-model.number="editing.compareAt" class="input" type="number" min="0" step="0.01" />
              </div>
            </div>
            <div class="row gap-12">
              <div class="field grow">
                <label>库存</label>
                <input v-model.number="editing.stock" class="input" type="number" min="0" />
              </div>
              <div class="field grow">
                <label>分类</label>
                <select v-if="categories.length" v-model="editing.category" class="select">
                  <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
                  <option v-if="editing.category && !categories.includes(editing.category)" :value="editing.category">{{ editing.category }}</option>
                </select>
                <input v-else v-model="editing.category" class="input" placeholder="数码 / 家居 …" />
              </div>
            </div>
            <div class="row gap-12">
              <div class="field grow">
                <label>图标（emoji）</label>
                <input v-model="editing.image" class="input" maxlength="4" />
              </div>
              <div class="field grow">
                <label>状态</label>
                <select v-model="editing.status" class="select">
                  <option value="active">在售</option>
                  <option value="inactive">下架</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>标签（逗号分隔）</label>
              <input
                :value="(editing.tags || []).join(',')"
                class="input"
                placeholder="降噪,耳机,通勤"
                @input="editing.tags = ($event.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean)"
              />
            </div>
            <div class="field">
              <label>详情描述</label>
              <textarea v-model="editing.description" class="textarea" rows="5" placeholder="商品详细描述" />
            </div>
          </div>
          <footer class="drawer-foot">
            <button class="btn btn-secondary" @click="editing = null">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
          </footer>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; }
.table td { font-size: 13px; }
.thumb {
  width: 36px; height: 36px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  display: grid; place-items: center;
  font-size: 18px;
  flex-shrink: 0;
}
.p-title { font-size: 13px; font-weight: 500; }
.p-sub { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
.low { color: var(--danger); font-weight: 600; }
.link-btn {
  border: 0; background: transparent;
  color: var(--text-2);
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
}
.link-btn:hover { color: var(--primary); background: var(--primary-soft); }
.link-btn.ai { color: var(--ai); }
.link-btn.ai:hover { background: var(--ai-soft); }
.link-btn.danger:hover { color: var(--danger); background: var(--danger-soft); }
.link-btn:disabled { opacity: 0.5; }

.mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.32); z-index: 500; display: flex; justify-content: flex-end; }
.drawer {
  width: 460px;
  max-width: 100%;
  background: var(--surface);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: var(--sh-3);
}
.drawer-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}
.drawer-head h3 { font-size: 15px; font-weight: 600; margin: 0; }
.close { border: 0; background: transparent; font-size: 20px; line-height: 1; color: var(--text-3); }
.close:hover { color: var(--text); }
.drawer-body { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }

/* AI 智能填充面板 */
.ai-panel { border: 1px solid #ddd6fb; background: linear-gradient(180deg, #fbfaff 0%, #fff 100%); border-radius: var(--r-md); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.ai-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ai-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: var(--ai); background: var(--ai-soft); border-radius: 99px; padding: 3px 10px; }
.ai-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ai-choice { border: 1px dashed #ddd6fb; border-radius: var(--r-sm); padding: 12px; background: var(--surface); }
.ai-choice-title { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.ai-choice-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ai-option {
  display: flex; flex-direction: column; gap: 4px; text-align: left;
  border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--surface); padding: 10px 12px; cursor: pointer;
  transition: all 0.15s;
}
.ai-option:hover { border-color: var(--ai); background: var(--ai-soft); }
.ai-option b { font-size: 13px; color: var(--ai); }
.ai-option span { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.ai-guide { border: 1px solid #ddd6fb; border-radius: var(--r-sm); padding: 12px; background: var(--surface); }
.ai-guide-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--ai); font-weight: 600; }
.ai-guide-q { margin: 8px 0; font-size: 13px; }
.ai-guide-opts { display: flex; gap: 6px; flex-wrap: wrap; }
.g-chip {
  border: 1px solid var(--line); background: var(--surface);
  border-radius: 99px; padding: 5px 14px; font-size: 12px;
  color: var(--text-2); cursor: pointer; transition: all 0.14s;
}
.g-chip:hover { border-color: var(--ai); color: var(--ai); }
.g-chip.sel { background: var(--ai-soft); border-color: var(--ai); color: var(--ai); font-weight: 600; }
.ai-img-btn {
  border: 1px dashed var(--line); background: var(--surface);
  border-radius: var(--r-sm); padding: 7px 12px;
  font-size: 12px; color: var(--text-2); cursor: pointer; white-space: nowrap;
}
.ai-img-btn:hover { border-color: var(--ai); color: var(--ai); }
.ai-draft { border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px; background: var(--surface); display: flex; flex-direction: column; gap: 6px; }
.d-title { font-size: 14px; font-weight: 600; }
.d-sub { font-size: 12px; color: var(--text-2); }
.d-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.d-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.d-tag { font-size: 11px; background: var(--surface-2); color: var(--text-2); border-radius: 6px; padding: 2px 8px; }
.d-desc { font-size: 12px; color: var(--text-3); line-height: 1.7; margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.d-actions { display: flex; gap: 8px; margin-top: 4px; }

.drawer-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}
</style>
