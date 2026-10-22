<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { useAuth, useToast } from '../../store';
import type { Feed } from '../../api/types';

const router = useRouter();
const auth = useAuth();
const toast = useToast();

const feeds = ref<Feed[]>([]);
const loading = ref(true);
const active = ref<Feed | null>(null);

onMounted(async () => {
  try {
    const r = await api.feed({ pageSize: 20 });
    feeds.value = r.items as Feed[];
  } catch (e: any) {
    toast.push(e.message, 'error');
  } finally {
    loading.value = false;
  }
});

async function open(f: Feed) {
  active.value = f;
  try {
    active.value = await api.feedDetail(f.id);
  } catch { /* 详情失败保留列表数据 */ }
}

async function like(f: Feed, ev: Event) {
  ev.stopPropagation();
  if (!auth.isLoggedIn) { router.push({ name: 'login', query: { redirect: '/feed' } }); return; }
  try {
    const r = await api.likeFeed(f.id);
    f.liked = r.liked;
    f.likes = r.likes;
    if (active.value?.id === f.id) { active.value.liked = r.liked; active.value.likes = r.likes; }
  } catch (e: any) { toast.push(e.message, 'error'); }
}

const goProduct = (id: number) => router.push(`/product/${id}`);
</script>

<template>
  <div class="feed-page">
    <div class="head">
      <div>
        <h1>逛逛</h1>
        <p>看到什么就能买什么。每条内容都挂了真实在售商品，点开直接下单。</p>
      </div>
      <div class="head-note">共 {{ feeds.length }} 条</div>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else class="masonry">
      <div v-for="f in feeds" :key="f.id" class="card" @click="open(f)">
        <div class="cover" :style="{ background: f.media || 'linear-gradient(135deg,#e5e7eb,#f3f4f6)' }">
          <span class="emoji">{{ f.cover }}</span>
          <span v-if="f.products.length" class="badge">{{ f.products.length }} 件商品</span>
        </div>
        <div class="body">
          <div class="title">{{ f.title }}</div>
          <div class="excerpt">{{ f.body }}</div>
          <div class="foot">
            <span class="author">{{ f.authorName }}</span>
            <button class="like" :class="{ on: f.liked }" @click="like(f, $event)">♥ {{ f.likes }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情弹层 -->
    <div v-if="active" class="mask" @click.self="active = null">
      <div class="sheet">
        <button class="close" @click="active = null">✕</button>
        <div class="sheet-cover" :style="{ background: active.media }">
          <span class="emoji big">{{ active.cover }}</span>
        </div>
        <h2>{{ active.title }}</h2>
        <div class="byline">{{ active.authorName }} · {{ active.views }} 次浏览</div>
        <p class="text">{{ active.body }}</p>

        <div class="products" v-if="active.products.length">
          <div class="p-title">内容同款</div>
          <div v-for="p in active.products" :key="p.id" class="p-row" @click="goProduct(p.id)">
            <div class="p-img">{{ p.image }}</div>
            <div class="p-info">
              <div class="p-name">{{ p.title }}</div>
              <div class="p-meta">★ {{ p.rating }} · 已售 {{ p.sales }}</div>
            </div>
            <div class="p-price">
              <b>¥{{ p.price }}</b>
              <s v-if="p.compareAt">¥{{ p.compareAt }}</s>
            </div>
            <button class="btn btn-primary btn-sm">去看看</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.feed-page { max-width: 1120px; margin: 0 auto; padding: 24px 20px 60px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; }
.head h1 { margin: 0 0 6px; font-size: 26px; }
.head p { margin: 0; color: #6b7280; font-size: 14px; }
.head-note { font-size: 13px; color: #9ca3af; }

.masonry { columns: 3; column-gap: 14px; }
@media (max-width: 900px) { .masonry { columns: 2; } }
@media (max-width: 600px) { .masonry { columns: 1; } }
.card { break-inside: avoid; background: #fff; border-radius: 14px; overflow: hidden; margin-bottom: 14px;
  box-shadow: 0 2px 12px rgba(0,0,0,.06); cursor: pointer; transition: transform .15s; }
.card:hover { transform: translateY(-3px); }
.cover { height: 170px; display: grid; place-items: center; position: relative; }
.emoji { font-size: 54px; }
.badge { position: absolute; right: 10px; bottom: 10px; background: rgba(0,0,0,.55); color: #fff;
  font-size: 11px; padding: 2px 8px; border-radius: 99px; }
.body { padding: 12px 14px 14px; }
.title { font-weight: 600; font-size: 15px; line-height: 1.4; margin-bottom: 6px; }
.excerpt { font-size: 12px; color: #6b7280; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
.author { font-size: 12px; color: #9ca3af; }
.like { border: none; background: transparent; color: #9ca3af; cursor: pointer; font-size: 13px; }
.like.on { color: #e53935; }

.mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: grid; place-items: center; z-index: 50; padding: 20px; }
.sheet { background: #fff; border-radius: 18px; width: min(560px, 100%); max-height: 88vh; overflow: auto; padding: 22px; position: relative; }
.close { position: absolute; right: 14px; top: 14px; border: none; background: #f3f4f6; width: 30px; height: 30px;
  border-radius: 50%; cursor: pointer; }
.sheet-cover { height: 160px; border-radius: 14px; display: grid; place-items: center; margin-bottom: 16px; }
.emoji.big { font-size: 64px; }
.sheet h2 { font-size: 20px; margin: 0 0 6px; }
.byline { font-size: 12px; color: #9ca3af; margin-bottom: 12px; }
.text { font-size: 14px; line-height: 1.75; color: #374151; }
.products { border-top: 1px solid #f1f5f9; margin-top: 16px; padding-top: 14px; }
.p-title { font-size: 13px; color: #6b7280; margin-bottom: 10px; }
.p-row { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 12px; cursor: pointer; }
.p-row:hover { background: #f9fafb; }
.p-img { width: 48px; height: 48px; background: #f3f4f6; border-radius: 10px; display: grid; place-items: center; font-size: 22px; }
.p-info { flex: 1; }
.p-name { font-size: 14px; font-weight: 500; }
.p-meta { font-size: 11px; color: #9ca3af; margin-top: 2px; }
.p-price { text-align: right; }
.p-price b { color: #e53935; }
.p-price s { display: block; font-size: 11px; color: #9ca3af; }
.empty { text-align: center; padding: 60px; color: #9ca3af; }
</style>
