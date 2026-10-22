<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';

const toast = useToast();
const cfg = ref<any>(null);
const loading = ref(true);
const saving = ref(false);
const kb = ref<any[]>([]);

/* ── 知识库新增/编辑（弹窗 + 标签下拉多选） ─────────────── */
const showKbModal = ref(false);
const kbSaving = ref(false);
const kbForm = reactive({ id: 0, question: '', answer: '', tags: [] as string[] });
const tagDropOpen = ref(false);
const customTag = ref('');

const tagPool = computed<string[]>(() => {
  const set = new Set<string>();
  for (const e of kb.value) {
    String(e.tags || '').split(/[,，、;；]/).map((s: string) => s.trim()).filter(Boolean).forEach((t: string) => set.add(t));
  }
  return [...set];
});

const tagLabel = computed(() => kbForm.tags.length ? kbForm.tags.join('、') : '选择标签（可多选）');

function toggleTag(t: string) {
  const i = kbForm.tags.indexOf(t);
  if (i >= 0) kbForm.tags.splice(i, 1);
  else kbForm.tags.push(t);
}

function addCustomTag() {
  const t = customTag.value.trim();
  if (!t) return;
  if (!kbForm.tags.includes(t)) kbForm.tags.push(t);
  customTag.value = '';
}

function openKbAdd() {
  Object.assign(kbForm, { id: 0, question: '', answer: '', tags: [] });
  tagDropOpen.value = false;
  showKbModal.value = true;
}

function openKbEdit(e: any) {
  Object.assign(kbForm, {
    id: e.id, question: e.question, answer: e.answer,
    tags: String(e.tags || '').split(/[,，、;；]/).map((s: string) => s.trim()).filter(Boolean),
  });
  tagDropOpen.value = false;
  showKbModal.value = true;
}

async function saveKb() {
  if (!kbForm.question.trim() || !kbForm.answer.trim()) { toast.push('问题与答案必填', 'error'); return; }
  kbSaving.value = true;
  try {
    const body = { question: kbForm.question.trim(), answer: kbForm.answer.trim(), tags: kbForm.tags.join(',') };
    if (kbForm.id) await api.updateKb(kbForm.id, body);
    else await api.addKb(body);
    showKbModal.value = false;
    kb.value = await api.kb();
    toast.push(kbForm.id ? '已保存' : '已添加', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { kbSaving.value = false; }
}

async function load() {
  loading.value = true;
  try {
    [cfg.value, kb.value] = await Promise.all([api.aiConfig(), api.kb()]);
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}
onMounted(load);

async function save() {
  saving.value = true;
  try {
    await api.saveAiConfig({
      model: cfg.value.model,
      temperature: cfg.value.temperature,
      persona: cfg.value.persona,
      allow_refund: cfg.value.allow_refund,
    });
    toast.push('配置已保存', 'success');
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { saving.value = false; }
}

async function delKb(id: number) {
  try {
    await api.deleteKb(id);
    kb.value = await api.kb();
  } catch (e: any) { toast.push(e.message, 'error'); }
}
</script>

<template>
  <div class="page">
    <div v-if="loading" class="skeleton" style="height: 400px" />

    <template v-else-if="cfg">
      <div class="grid">
        <section class="card card-pad">
          <h2 class="block-title">模型连接</h2>
          <div class="status-row">
            <span class="badge" :class="cfg.keyConfigured ? 'badge-success' : 'badge-warning'">
              {{ cfg.keyConfigured ? '已连接远端模型' : '本地引擎模式' }}
            </span>
            <span class="dim" style="font-size: 12px">Base URL：{{ cfg.baseUrlHint }}</span>
          </div>
          <p class="note">
            {{ cfg.keyConfigured
              ? '通过环境变量 AI_BASE_URL / AI_API_KEY 注入，密钥不落库、不出现在前端。'
              : '未配置密钥时自动降级为本地规则引擎，工具调用与业务操作依然真实执行，可用于完整演示。' }}
          </p>
          <div class="code-block mono">AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-xxxx
AI_MODEL={{ cfg.model }}</div>
          <p class="note">填入任意 OpenAI 兼容服务（OpenAI / 通义 / DeepSeek / Moonshot 等）后重启服务即可切换。</p>
        </section>

        <section class="card card-pad">
          <h2 class="block-title">助手行为</h2>
          <div class="field">
            <label>模型名</label>
            <input v-model="cfg.model" class="input" placeholder="gpt-4o-mini" />
            <p class="note" style="margin-top: 6px">保存后立即生效，无需重启；密钥仍需通过环境变量注入。</p>
          </div>
          <div class="field" style="margin-top: 12px">
            <label>温度 {{ cfg.temperature }}</label>
            <input v-model="cfg.temperature" type="range" min="0" max="1.2" step="0.1" style="width: 100%" />
          </div>
          <div class="field" style="margin-top: 12px">
            <label>人设（System Prompt 前缀）</label>
            <textarea v-model="cfg.persona" class="textarea" rows="4" />
          </div>
          <label class="switch-row">
            <input v-model="cfg.allow_refund" type="checkbox" true-value="true" false-value="false" />
            <span>允许 AI 客服自助提交退款申请</span>
          </label>
          <button class="btn btn-primary" style="margin-top: 14px" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存配置' }}
          </button>
        </section>
      </div>

      <section class="card card-pad">
        <div class="row-between" style="margin-bottom: 14px">
          <h2 class="block-title" style="margin: 0">客服知识库</h2>
          <button class="btn btn-primary btn-sm" @click="openKbAdd">＋ 添加知识</button>
        </div>

        <table class="table">
          <thead>
            <tr><th style="width: 200px">问题</th><th>答案</th><th style="width: 100px">标签</th><th style="width: 120px">操作</th></tr>
          </thead>
          <tbody>
            <tr v-if="!kb.length"><td colspan="4" class="dim" style="text-align: center; padding: 24px">还没有知识条目，点右上角「添加知识」</td></tr>
            <tr v-for="e in kb" :key="e.id">
              <td style="font-size: 12px; font-weight: 500">{{ e.question }}</td>
              <td style="font-size: 12px" class="dim">{{ e.answer }}</td>
              <td>
                <span v-for="t in String(e.tags || '').split(/[,，、;；]/).map((s: string) => s.trim()).filter(Boolean)" :key="t" class="kb-tag">{{ t }}</span>
                <span v-if="!e.tags" class="dim">—</span>
              </td>
              <td>
                <div class="kb-ops">
                  <button class="link-btn" @click="openKbEdit(e)">编辑</button>
                  <button class="del" @click="delKb(e.id)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 知识库新增/编辑弹窗 -->
      <div v-if="showKbModal" class="modal-mask" @click.self="showKbModal = false">
        <div class="modal card">
          <h3 class="modal-title">{{ kbForm.id ? '编辑知识' : '添加知识' }}</h3>
          <div class="field">
            <label>问题 <i class="req">*</i></label>
            <input v-model="kbForm.question" class="input" placeholder="如：能开专票吗" @keyup.enter="saveKb" />
          </div>
          <div class="field" style="margin-top: 12px">
            <label>标准答案 <i class="req">*</i></label>
            <textarea v-model="kbForm.answer" class="textarea" rows="4" placeholder="AI 客服回答该问题时优先使用的标准答案" />
          </div>
          <div class="field" style="margin-top: 12px; position: relative">
            <label>标签（多选，用于知识库检索匹配）</label>
            <button type="button" class="input tag-select" :class="{ open: tagDropOpen }" @click="tagDropOpen = !tagDropOpen">
              <span :class="{ placeholder: !kbForm.tags.length }">{{ tagLabel }}</span>
              <span class="caret">▾</span>
            </button>
            <div v-if="tagDropOpen" class="tag-drop">
              <label v-for="t in tagPool" :key="t" class="tag-opt">
                <input type="checkbox" :checked="kbForm.tags.includes(t)" @change="toggleTag(t)" />
                <span>{{ t }}</span>
              </label>
              <div v-if="!tagPool.length" class="dim" style="font-size: 12px; padding: 8px 10px">暂无已有标签，直接在下方输入新建</div>
              <div class="tag-new">
                <input v-model="customTag" class="input" placeholder="输入新标签后回车" @keyup.enter.prevent="addCustomTag" />
                <button type="button" class="btn btn-secondary btn-sm" @click="addCustomTag">添加</button>
              </div>
            </div>
            <div v-if="kbForm.tags.length" class="tag-chips">
              <span v-for="t in kbForm.tags" :key="t" class="kb-tag sel">
                {{ t }}
                <i class="x" @click="toggleTag(t)">×</i>
              </span>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" @click="showKbModal = false">取消</button>
            <button class="btn btn-primary" :disabled="kbSaving" @click="saveKb">{{ kbSaving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.block-title { font-size: 14px; font-weight: 600; margin: 0 0 14px; }
.status-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.note { font-size: 12px; color: var(--text-2); line-height: 1.7; margin: 6px 0 10px; }
.code-block {
  background: #1e222b;
  color: #c8d0e0;
  border-radius: var(--r-sm);
  padding: 12px 14px;
  font-size: 11px;
  line-height: 1.8;
  white-space: pre;
  overflow-x: auto;
}
.switch-row { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: 14px; cursor: pointer; }
.switch-row input { width: 15px; height: 15px; accent-color: var(--primary); }

.kb-add { display: flex; gap: 8px; }
.del { border: 0; background: transparent; color: var(--text-3); font-size: 12px; }
.del:hover { color: var(--danger); }
.link-btn { border: 0; background: transparent; color: var(--primary); font-size: 12px; cursor: pointer; padding: 0; }
.link-btn:hover { text-decoration: underline; }

.kb-tag {
  display: inline-block; font-size: 11px; border-radius: 99px;
  background: var(--surface-2); color: var(--text-2);
  padding: 2px 8px; margin: 1px 4px 1px 0;
}
.kb-tag.sel { background: var(--primary-soft); color: var(--primary); }
.kb-tag.sel .x { font-style: normal; margin-left: 4px; cursor: pointer; }
.req { color: var(--danger); font-style: normal; }

.tag-select { display: flex; align-items: center; justify-content: space-between; text-align: left; cursor: pointer; font-size: 13px; color: var(--text); }
.tag-select .placeholder { color: var(--text-3); }
.tag-select .caret { color: var(--text-3); font-size: 11px; }
.tag-drop {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-sm); box-shadow: var(--sh-3);
  z-index: 30; max-height: 220px; overflow-y: auto;
  padding: 6px;
}
.tag-opt { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.tag-opt:hover { background: var(--surface-2); }
.tag-opt input { accent-color: var(--primary); }
.tag-new { display: flex; gap: 6px; padding: 6px 8px 4px; border-top: 1px solid var(--line); margin-top: 4px; }
.tag-chips { margin-top: 8px; }

.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, .35); display: grid; place-items: center; z-index: 500; padding: 20px; }
.modal { width: 560px; max-width: 100%; padding: 22px; max-height: calc(100vh - 48px); overflow-y: auto; }
.modal-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.kb-ops { display: flex; align-items: center; gap: 10px; white-space: nowrap; }

@media (max-width: 1024px) { .grid { grid-template-columns: 1fr; } .kb-add { flex-wrap: wrap; } }
</style>
