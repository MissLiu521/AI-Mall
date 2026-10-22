<script setup lang="ts">
import type { Product } from '../api/types';

defineProps<{ product: Product; aiPick?: boolean }>();
defineEmits<{ (e: 'add', p: Product): void }>();
</script>

<template>
  <article class="pcard">
    <router-link :to="`/product/${product.id}`" class="pcard-media">
      <span class="pcard-emoji">{{ product.image || '📦' }}</span>
      <span v-if="aiPick" class="pcard-ai">AI 精选</span>
      <span v-if="product.compareAt" class="pcard-sale">
        {{ Math.round((1 - product.price / product.compareAt) * 100) }}% off
      </span>
    </router-link>
    <div class="pcard-body">
      <router-link :to="`/product/${product.id}`">
        <h3 class="pcard-title">{{ product.title }}</h3>
        <p class="pcard-sub">{{ product.subtitle }}</p>
      </router-link>
      <div class="pcard-meta">
        <span class="dim">{{ product.rating }} ★ · 已售 {{ product.sales }}</span>
      </div>
      <!-- 匹配理由：回答"为什么这件商品排在这里"，把排序从黑箱变成可解释 -->
      <div v-if="product.matchReasons && product.matchReasons.length" class="pcard-reasons">
        <span v-for="(r, i) in product.matchReasons.slice(0, 2)" :key="i" class="reason-tag" :class="`r-${r.field}`">
          {{ r.text }}
        </span>
      </div>
      <div class="pcard-foot">
        <div class="pcard-price">
          <span class="price">¥{{ product.price }}</span>
          <s v-if="product.compareAt" class="dim mono">¥{{ product.compareAt }}</s>
        </div>
        <button class="add-btn" :disabled="product.stock === 0" :aria-label="`将 ${product.title} 加入购物车`" @click="$emit('add', product)">
          {{ product.stock === 0 ? '缺货' : '＋' }}
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.pcard {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  transition: transform 0.2s var(--ease), box-shadow 0.2s, border-color 0.2s;
  display: flex;
  flex-direction: column;
}
.pcard:hover { transform: translateY(-2px); box-shadow: var(--sh-2); border-color: var(--line-strong); }

/* 匹配理由标签 */
.pcard-reasons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.reason-tag {
  font-size: 11px;
  line-height: 1.6;
  padding: 1px 7px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.reason-tag.r-title { background: var(--primary-soft); color: var(--primary); }
.reason-tag.r-tags { background: var(--ai-soft); color: var(--ai); }
.reason-tag.r-price { background: var(--success-soft); color: var(--success); }

.pcard-media {
  position: relative;
  display: block;
  aspect-ratio: 1 / 1;
  background: linear-gradient(160deg, #f5f7fb 0%, #eef1f7 100%);
  display: grid;
  place-items: center;
}
.pcard-emoji { font-size: 46px; filter: saturate(1.05); transition: transform 0.28s var(--ease); }
.pcard:hover .pcard-emoji { transform: scale(1.06); }

.pcard-ai {
  position: absolute;
  top: 10px; left: 10px;
  background: var(--ai-soft);
  color: var(--ai);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  letter-spacing: 0.02em;
}
.pcard-sale {
  position: absolute;
  top: 10px; right: 10px;
  background: var(--price);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  font-family: var(--mono);
}

.pcard-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
.pcard-title { font-size: 14px; font-weight: 500; line-height: 1.4; margin: 0; }
.pcard-sub {
  font-size: 12px;
  color: var(--text-3);
  margin: 2px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pcard-meta { font-size: 11px; margin-top: 2px; }
.pcard-foot { display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 8px; }
.pcard-price { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
.pcard-price .price { font-size: 16px; }

.add-btn {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text);
  font-size: 15px;
  line-height: 1;
  display: grid; place-items: center;
  transition: all 0.16s;
}
.add-btn:hover:not(:disabled) { background: var(--primary); border-color: var(--primary); color: #fff; }
.add-btn:disabled { opacity: 0.4; cursor: not-allowed; font-size: 10px; }
</style>
