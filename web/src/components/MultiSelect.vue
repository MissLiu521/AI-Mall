<script setup lang="ts">
import { ref, computed } from 'vue';

/**
 * 多选下拉：勾选已有选项 / 输入新选项回车添加（选项可由用户自行维护）。
 * 选项支持 string 或 { label, value }（显示名与存储值分离，如「✨ 外观」↔ appearance）。
 * 新增的选项通过 add 事件抛给父级持久化（localStorage 或服务端）。
 */
interface Opt { label: string; value: string }

const props = withDefaults(defineProps<{
  modelValue: string[];
  options: (string | Opt)[];
  placeholder?: string;
}>(), { placeholder: '选择（可多选）' });

const emit = defineEmits<{
  (e: 'update:modelValue', v: string[]): void;
  (e: 'add', v: string): void;
}>();

const open = ref(false);
const custom = ref('');

const norm = computed<Opt[]>(() => props.options.map((o) => typeof o === 'string' ? { label: o, value: o } : o));
const label = computed(() => {
  if (!props.modelValue.length) return props.placeholder;
  return props.modelValue
    .map((v) => norm.value.find((o) => o.value === v)?.label ?? v)
    .join('、');
});

function toggle(v: string) {
  const next = props.modelValue.includes(v)
    ? props.modelValue.filter((x) => x !== v)
    : [...props.modelValue, v];
  emit('update:modelValue', next);
}

function addCustom() {
  const t = custom.value.trim().slice(0, 12);
  if (!t) return;
  if (!norm.value.some((o) => o.value === t || o.label === t)) emit('add', t);
  if (!props.modelValue.includes(t)) emit('update:modelValue', [...props.modelValue, t]);
  custom.value = '';
}
</script>

<template>
  <div class="ms" @keydown.esc="open = false">
    <button type="button" class="ms-trigger" :class="{ open }" @click="open = !open">
      <span :class="{ placeholder: !modelValue.length }">{{ label }}</span>
      <span class="caret">▾</span>
    </button>
    <div v-if="open" class="ms-drop">
      <label v-for="opt in norm" :key="opt.value" class="ms-opt">
        <input type="checkbox" :checked="modelValue.includes(opt.value)" @change="toggle(opt.value)" />
        <span>{{ opt.label }}</span>
      </label>
      <div v-if="!norm.length" class="ms-empty">暂无选项，在下方输入创建</div>
      <div class="ms-new">
        <input v-model="custom" placeholder="输入新选项后回车" @keyup.enter.prevent="addCustom" />
        <button type="button" @click="addCustom">添加</button>
      </div>
    </div>
    <div v-if="modelValue.length" class="ms-chips">
      <span v-for="t in modelValue" :key="t" class="ms-chip">
        {{ norm.find((o) => o.value === t)?.label ?? t }}
        <i class="x" @click="toggle(t)">×</i>
      </span>
    </div>
  </div>
</template>

<style scoped>
.ms { position: relative; }
.ms-trigger {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  min-height: 36px; padding: 4px 10px;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); font-size: 13px; color: var(--text);
  cursor: pointer; text-align: left;
}
.ms-trigger .placeholder { color: var(--text-3); }
.ms-trigger .caret { color: var(--text-3); font-size: 11px; margin-left: 8px; }
.ms-drop {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12);
  z-index: 40; max-height: 200px; overflow-y: auto; padding: 6px;
}
.ms-opt { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.ms-opt:hover { background: var(--surface-2); }
.ms-opt input { accent-color: var(--primary); }
.ms-empty { font-size: 12px; color: var(--text-3); padding: 8px 10px; }
.ms-new { display: flex; gap: 6px; padding: 6px 6px 2px; border-top: 1px solid var(--line); margin-top: 4px; }
.ms-new input { flex: 1; height: 30px; border: 1px solid var(--line); border-radius: 6px; padding: 0 8px; font-size: 12px; }
.ms-new button { height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); font-size: 12px; cursor: pointer; }
.ms-new button:hover { border-color: var(--primary); color: var(--primary); }
.ms-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.ms-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; background: var(--primary-soft); color: var(--primary);
  border-radius: 99px; padding: 2px 9px;
}
.ms-chip .x { font-style: normal; cursor: pointer; }
</style>
