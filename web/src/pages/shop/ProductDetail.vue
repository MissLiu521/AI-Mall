<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';
import { useAuth, useCart, useToast } from '../../store';
import type { Product, ChatMessage } from '../../api/types';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const cart = useCart();
const toast = useToast();

const p = ref<Product | null>(null);
const qty = ref(1);
const loading = ref(true);
const qa = ref<ChatMessage[]>([]);
const qaInput = ref('');
const qaLoading = ref(false);
const qaConvId = ref<number | undefined>();

// ── SKU / 活动 / 评价 / 收藏 ──
const skuId = ref<number | null>(null);
const reviews = ref<any>(null);
const reviewRating = ref(0);
const mediaOnly = ref(false);
const reviewTagId = ref(0);
const reviewTagName = ref('');
const lightbox = ref('');
const favorited = ref(false);
const flashInfo = ref<any>(null);
const groupInfo = ref<any>(null);

const skus = computed<any[]>(() => (p.value as any)?.skus || []);
const currentSku = computed(() => skus.value.find((s) => s.id === skuId.value) || null);
/** 活动价优先于 SKU 价，SKU 价优先于商品标价 */
const unitPrice = computed(() =>
  flashInfo.value?.price ?? groupInfo.value?.price ?? currentSku.value?.price ?? p.value?.price ?? 0);
const unitStock = computed(() => currentSku.value?.stock ?? (p.value as any)?.totalStock ?? p.value?.stock ?? 0);
const campaign = computed(() => flashInfo.value || groupInfo.value || null);
const totalPrice = computed(() => +(unitPrice.value * qty.value).toFixed(2));

// 买家印象：标签云 + 分项评分
const tagStats = computed<any>(() => reviews.value?.tagStats || null);
const tagGroups = computed<any[]>(() => (tagStats.value?.groups || []).filter((g: any) => g.tags?.length));
const scoredDims = computed<any[]>(() => (tagStats.value?.dimensions || []).filter((d: any) => d.count > 0));

function dimEntries(d: Record<string, any>) {
  const labels: Record<string, string> = {
    appearance: '外观', performance: '性能', color: '颜色', quality: '质量', fit: '尺码',
    taste: '口感', fresh: '新鲜度', effect: '效果', texture: '肤感', price: '性价比', service: '物流',
  };
  return Object.entries(d || {})
    .filter(([, v]) => Number(v) >= 1 && Number(v) <= 5)
    .map(([k, v]) => ({ key: k, label: labels[k] || '其他', score: v }));
}

async function load() {
  loading.value = true;
  qa.value = [];
  qaConvId.value = undefined;
  flashInfo.value = null;
  groupInfo.value = null;
  try {
    const id = route.params.id as string;
    p.value = await api.product(id);
    qty.value = 1;
    skuId.value = (p.value as any).skus?.[0]?.id ?? null;
    favorited.value = !!(p.value as any).favorite;
    reviews.value = await api.reviews(id, { pageSize: 5 });

    if (route.query.flash) {
      const list: any[] = await api.flashSales();
      flashInfo.value = list.find((f) => f.id === +String(route.query.flash)) || null;
    }
    if (route.query.group) {
      groupInfo.value = await api.groupBuy(+String(route.query.group));
    }
  } catch (e: any) {
    toast.push(e.message, 'error');
    router.push('/shop');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => route.params.id, load);

async function loadReviews(rating = 0, media = mediaOnly.value, tagId = 0, tagName = '') {
  reviewRating.value = rating;
  mediaOnly.value = media;
  reviewTagId.value = tagId;
  reviewTagName.value = tagName;
  reviews.value = await api.reviews(route.params.id as string, {
    pageSize: 20, rating, withMedia: media ? 1 : 0, tagId: tagId || undefined,
  });
}

/** 点标签=按标签筛选；再点一次取消 */
async function toggleTagFilter(t: any) {
  if (reviewTagId.value === t.id) await loadReviews(reviewRating.value, mediaOnly.value);
  else await loadReviews(reviewRating.value, mediaOnly.value, t.id, t.name);
}

function clearTagFilter() {
  loadReviews(reviewRating.value, mediaOnly.value);
}

async function toggleFav() {
  if (!auth.isLoggedIn) { router.push({ path: '/login', query: { redirect: route.fullPath } }); return; }
  const r = await api.toggleFavorite(p.value!.id);
  favorited.value = r.favorited;
  toast.push(r.favorited ? '已收藏，降价会提醒你' : '已取消收藏', 'success');
}

async function addToCart(goCart = false) {
  if (!auth.isLoggedIn) { router.push({ path: '/login', query: { redirect: route.fullPath } }); return; }
  if (!p.value) return;
  if (skus.value.length && !skuId.value) { toast.push('请先选择规格', 'error'); return; }
  try {
    await cart.add(p.value.id, qty.value, skuId.value || 0);
    toast.push('已加入购物车', 'success');
    if (goCart) router.push('/cart');
  } catch (e: any) {
    toast.push(e.message, 'error');
  }
}

async function buyNow() {
  if (!auth.isLoggedIn) { router.push({ path: '/login', query: { redirect: route.fullPath } }); return; }
  if (skus.value.length && !skuId.value) { toast.push('请先选择规格', 'error'); return; }
  const q: Record<string, string> = {
    productId: String(p.value?.id), qty: String(qty.value),
  };
  if (skuId.value) q.skuId = String(skuId.value);
  if (flashInfo.value) q.flash = String(flashInfo.value.id);
  if (groupInfo.value) q.group = String(groupInfo.value.id);
  router.push({ name: 'checkout', query: q });
}

/** 参团：带上团号进结算，下单时直接加入这个团而不是新开一个 */
function joinTeam(team: any) {
  if (!auth.isLoggedIn) { router.push({ path: '/login', query: { redirect: route.fullPath } }); return; }
  if (team.joinedByMe) return;
  if (skus.value.length && !skuId.value) { toast.push('请先选择规格', 'error'); return; }
  const q: Record<string, string> = {
    productId: String(p.value?.id),
    qty: '1',
    group: String(groupInfo.value.id),
    team: String(team.id),
  };
  if (skuId.value) q.skuId = String(skuId.value);
  router.push({ name: 'checkout', query: q });
}

async function ask() {
  const text = qaInput.value.trim();
  if (!text || qaLoading.value || !p.value) return;
  qaInput.value = '';
  qa.value.push({ role: 'user', content: text });
  qaLoading.value = true;
  try {
    const r = await api.chat({ scene: 'shopping', text: `关于商品「${p.value.title}」（ID ${p.value.id}）：${text}`, conversationId: qaConvId.value });
    qaConvId.value = r.conversationId;
    qa.value.push({ role: 'assistant', content: r.content, toolTrace: r.toolTrace });
  } catch (e: any) {
    qa.value.push({ role: 'assistant', content: e.message });
  } finally {
    qaLoading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div v-if="loading" class="skeleton" style="height: 420px; border-radius: 12px" />

    <template v-else-if="p">
      <div class="crumb">
        <router-link to="/shop">首页</router-link><span>/</span>
        <router-link :to="{ name: 'category', query: { category: p.category } }">{{ p.category }}</router-link>
        <span>/</span><span>{{ p.title }}</span>
      </div>

      <div class="detail">
        <div class="gallery">
          <div class="gallery-main">{{ p.image || '📦' }}</div>
        </div>

        <div class="info">
          <div v-if="(p as any).shop" class="shop-row">
            <span class="shop-logo">{{ (p as any).shop.logo }}</span>
            <span class="shop-name">{{ (p as any).shop.name }}</span>
            <span v-if="(p as any).shop.isSelf" class="badge badge-danger">自营</span>
            <span class="dim">★ {{ (p as any).shop.rating }}</span>
            <router-link v-if="(p as any).shop.id" :to="{ name: 'category', query: { shopId: String((p as any).shop.id) } }" class="shop-link">
              进店看看 →
            </router-link>
          </div>

          <h1 class="title">{{ p.title }}</h1>
          <p class="subtitle">{{ p.subtitle }}</p>

          <div class="rating-row">
            <span class="stars">{{ '★'.repeat(Math.round((p as any).reviewSummary?.average || p.rating)) }}<span class="dim">{{ '★'.repeat(5 - Math.round((p as any).reviewSummary?.average || p.rating)) }}</span></span>
            <span class="dim mono">{{ (p as any).reviewSummary?.average || p.rating }}</span>
            <span class="divider" />
            <a class="dim review-jump" href="#reviews">
              {{ (p as any).reviewSummary?.total || 0 }} 条评价
              <template v-if="(p as any).reviewSummary?.total">· 好评 {{ (p as any).reviewSummary.goodRate }}%</template>
            </a>
            <span class="divider" />
            <span class="dim">已售 {{ p.sales }}</span>
          </div>

          <!-- 库存语义化：把数字换成能判断的结论，而不是让用户猜 -->
          <div v-if="p.stockStatus" class="stock-strip" :class="`stock-${p.stockStatus.level}`">
            <span class="stock-dot" />
            <b>{{ p.stockStatus.label }}</b>
            <span class="stock-hint">{{ p.stockStatus.hint }}</span>
          </div>

          <!-- 活动价：秒杀/拼团与商品价分开讲清楚 -->
          <div v-if="campaign" class="campaign-strip">
            <span class="cp-tag">{{ flashInfo ? '⚡ 秒杀价' : '👥 拼团价' }}</span>
            <span class="cp-price">¥{{ unitPrice }}</span>
            <s class="dim">¥{{ p.price }}</s>
            <span class="cp-note">{{ flashInfo ? '限时抢购，售完即止' : `还差 ${groupInfo?.required - 1} 人成团` }}</span>
          </div>

          <!-- 正在凑的团：直接参团，比"自己开团再等"少一步 -->
          <div v-if="groupInfo?.teams?.length" class="team-block">
            <div class="team-head">
              <span class="label">正在凑的团</span>
              <span class="dim">{{ groupInfo.teams.length }} 个团等人</span>
            </div>
            <div v-for="t in groupInfo.teams.slice(0, 3)" :key="t.id" class="team-row">
              <div class="grow">
                <div class="team-name">
                  {{ t.leaderName }} 的团
                  <span v-if="t.joinedByMe" class="badge badge-primary">已参与</span>
                </div>
                <div class="dim team-meta">还差 {{ t.need }} 人 · {{ t.expireAt ? t.expireAt.slice(5, 16).replace('T', ' ') : '' }} 结束</div>
              </div>
              <button class="btn btn-secondary btn-sm" :disabled="t.joinedByMe" @click="joinTeam(t)">参团</button>
            </div>
          </div>

          <div class="price-box">
            <span class="price-lg">¥{{ unitPrice }}</span>
            <s v-if="p.compareAt" class="dim mono price-old">¥{{ p.compareAt }}</s>
            <span v-if="p.compareAt" class="badge badge-danger">
              省 ¥{{ Math.max(0, +(p.compareAt - unitPrice).toFixed(2)) }}
            </span>
          </div>

          <!-- 规格选择：有 SKU 必须选，缺货组合置灰 -->
          <div v-if="skus.length" class="sku-block">
            <div class="sku-head">
              <span class="label">选择规格</span>
              <span class="dim sku-picked">{{ currentSku ? Object.entries(currentSku.spec).map(([k, v]) => k + '：' + v).join(' / ') : '未选择' }}</span>
            </div>
            <div class="sku-list">
              <button
                v-for="s in skus" :key="s.id"
                class="sku-chip" :class="{ on: skuId === s.id, off: !s.buyable }"
                :disabled="!s.buyable"
                @click="skuId = s.id"
              >
                {{ Object.values(s.spec).join(' / ') }}
                <span class="sku-price">¥{{ s.price }}</span>
              </button>
            </div>
            <div v-if="currentSku" class="sku-stock dim">
              {{ currentSku.stock > 0 ? `该规格库存 ${currentSku.stock} 件` : '该规格暂时缺货，换个规格看看' }}
            </div>
          </div>

          <!-- 价格构成：标价即到手价，运费规则前置，避免结算页"惊喜" -->
          <div v-if="p.priceBreakdown" class="price-detail">
            <div class="pd-row">
              <span class="dim">标价</span>
              <span class="mono">¥{{ p.priceBreakdown.final }}</span>
            </div>
            <template v-if="p.priceBreakdown.saving > 0">
              <div class="pd-row">
                <span class="dim">原价</span>
                <span class="mono dim" style="text-decoration: line-through">¥{{ p.priceBreakdown.origin }}</span>
              </div>
              <div class="pd-row">
                <span class="dim">{{ p.priceBreakdown.discountLabel }}</span>
                <span class="mono" style="color: var(--danger)">-¥{{ p.priceBreakdown.saving }}</span>
              </div>
            </template>
            <div class="pd-row pd-total">
              <span>到手价</span>
              <span class="price mono">¥{{ p.priceBreakdown.final }}</span>
            </div>
            <div class="pd-note">
              🚚 {{ p.priceBreakdown.shipping.text }}　·　{{ p.priceBreakdown.note }}
            </div>
          </div>

          <div class="tags">
            <span v-for="t in p.tags" :key="t" class="badge badge-muted">{{ t }}</span>
          </div>

          <div class="qty-row">
            <span class="label">数量</span>
            <div class="stepper">
              <button :disabled="qty <= 1" @click="qty--">−</button>
              <span class="mono">{{ qty }}</span>
              <button :disabled="qty >= unitStock" @click="qty++">＋</button>
            </div>
            <span class="dim" style="font-size: 12px">小计 <b class="price mono">¥{{ totalPrice }}</b></span>
          </div>

          <div class="actions">
            <button class="btn btn-secondary btn-lg" :disabled="unitStock === 0" @click="addToCart(false)">加入购物车</button>
            <button class="btn btn-primary btn-lg" :disabled="unitStock === 0" @click="buyNow">立即购买</button>
            <button class="fav-btn" :class="{ on: favorited }" @click="toggleFav">
              {{ favorited ? '♥' : '♡' }}<span>{{ favorited ? '已收藏' : '收藏' }}</span>
            </button>
          </div>

          <!-- 退换政策前置：把"能不能退"从猜变成确定 -->
          <div class="policy-strip">
            <span class="policy-item" :class="p.returnPolicy?.returnable ? 'ok' : 'warn'">
              {{ p.returnPolicy?.returnable ? '✓' : '!' }} {{ p.returnPolicy?.text || '7 天无理由退货' }}
            </span>
            <span class="divider" />
            <span class="policy-item ok">满 {{ p.priceBreakdown?.shipping.freeThreshold ?? 99 }} 元包邮</span>
          </div>
        </div>
      </div>

      <div class="lower">
        <div class="desc card card-pad">
          <h2 class="block-title">商品详情</h2>
          <p class="desc-text">{{ p.description }}</p>

          <!-- 规格实测：结构化展示，减少"尺码/容量对不对得上"的反复确认 -->
          <template v-if="p.specs && Object.keys(p.specs).length">
            <h3 class="sub-title">规格实测</h3>
            <div class="spec-table">
              <div v-for="(v, k) in p.specs" :key="k" class="spec-row">
                <span class="spec-key">{{ k }}</span>
                <span class="spec-val">{{ v }}</span>
              </div>
            </div>
          </template>

          <div class="spec-list">
            <div class="spec"><span class="dim">分类</span><span>{{ p.category }}</span></div>
            <div class="spec"><span class="dim">标签</span><span>{{ p.tags.join('、') || '—' }}</span></div>
            <div class="spec"><span class="dim">评分</span><span>{{ p.rating }} / 5.0</span></div>
            <div class="spec"><span class="dim">库存</span><span>{{ p.stock }} 件{{ p.stockStatus ? `（${p.stockStatus.label}）` : '' }}</span></div>
            <div v-if="p.returnPolicy" class="spec">
              <span class="dim">退换</span>
              <span :class="p.returnPolicy.returnable ? '' : 'dim'">{{ p.returnPolicy.text }}</span>
            </div>
          </div>
        </div>

        <div class="qa card card-pad">
          <div class="row-between" style="margin-bottom: 12px">
            <h2 class="block-title" style="margin: 0">AI 问答</h2>
            <span class="badge badge-ai">针对本商品</span>
          </div>

          <div v-if="!qa.length" class="qa-empty">
            <p class="dim">这件商品有什么想了解的？AI 会读取商品真实信息回答。</p>
            <div class="qa-chips">
              <button v-for="s in ['这款适合送礼吗', '和同类比贵在哪', '有现货吗']" :key="s" class="chip"
                      @click="qaInput = s; ask()">{{ s }}</button>
            </div>
          </div>

          <div class="qa-list">
            <div v-for="(m, i) in qa" :key="i" class="qa-msg" :class="m.role">
              <div class="qa-bubble">{{ m.content }}</div>
            </div>
            <div v-if="qaLoading" class="qa-msg assistant">
              <div class="qa-bubble dim">正在查询商品信息…</div>
            </div>
          </div>

          <div class="qa-input-row">
            <input v-model="qaInput" class="input" placeholder="问点什么…" :disabled="qaLoading" @keyup.enter="ask" />
            <button class="btn btn-ai" :disabled="qaLoading || !qaInput.trim()" @click="ask">提问</button>
          </div>
        </div>

        <!-- 评价：AI 摘要 + 评分分布 + 真实评价 -->
        <div id="reviews" class="reviews card card-pad">
          <div class="row-between" style="margin-bottom: 14px">
            <h2 class="block-title" style="margin: 0">买家评价</h2>
            <span class="dim">{{ reviews?.total || 0 }} 条</span>
          </div>

          <div v-if="reviews?.summary" class="ai-summary">
            <div class="as-head"><span class="badge badge-ai">AI 评价摘要</span><span class="dim">{{ reviews.summary.verdict }}</span></div>
            <p class="as-line">{{ reviews.summary.oneLine }}</p>
            <div v-if="reviews.summary.pros.length" class="as-row">
              <span class="as-tag good">好评点</span>
              <span v-for="(x, i) in reviews.summary.pros" :key="'p' + i" class="as-item">{{ x }}</span>
            </div>
            <div v-if="reviews.summary.cons.length" class="as-row">
              <span class="as-tag bad">被提到</span>
              <span v-for="(x, i) in reviews.summary.cons" :key="'c' + i" class="as-item">{{ x }}</span>
            </div>
          </div>

          <!-- 买家印象：淘宝/京东式标签云，点标签直接筛评价 -->
          <div v-if="tagGroups.length" class="impressions">
            <div class="imp-head">
              <span class="imp-title">买家印象</span>
              <span class="dim imp-sub">{{ tagStats?.tagged || 0 }} 人参与 · 点标签筛选评价</span>
              <button v-if="reviewTagId" class="imp-clear" @click="clearTagFilter">
                已筛「{{ reviewTagName }}」×
              </button>
            </div>
            <div v-for="g in tagGroups" :key="g.key" class="imp-group">
              <span class="imp-dim">{{ g.icon }} {{ g.label }}</span>
              <div class="imp-chips">
                <button
                  v-for="t in g.tags" :key="t.id" class="imp-chip"
                  :class="{ on: reviewTagId === t.id, bad: t.polarity === 'bad' }"
                  @click="toggleTagFilter(t)"
                >
                  {{ t.name }}<b>{{ t.count }}</b>
                </button>
              </div>
            </div>
          </div>

          <div class="rev-body">
            <div class="rev-side">
              <div class="rev-score">
                <b>{{ reviews?.breakdown?.average || 0 }}</b>
                <span class="dim">好评率 {{ reviews?.breakdown?.goodRate || 0 }}%</span>
              </div>
              <div class="dist">
                <div v-for="d in (reviews?.breakdown?.dist || [])" :key="d.star" class="d-row">
                  <span class="d-star">{{ d.star }} 星</span>
                  <span class="d-bar"><i :style="{ width: d.percent + '%' }" /></span>
                  <span class="d-num">{{ d.count }}</span>
                </div>
              </div>

              <!-- 分项评分：外观 / 性能 / 颜色… -->
              <div v-if="scoredDims.length" class="dim-bars">
                <div class="db-title">分项评分</div>
                <div v-for="d in scoredDims" :key="d.key" class="db-row">
                  <span class="db-label">{{ d.icon }} {{ d.label }}</span>
                  <span class="db-track"><i :style="{ width: (d.avg / 5 * 100) + '%' }" /></span>
                  <span class="db-num">{{ d.avg }}</span>
                </div>
              </div>
            </div>

            <div class="rev-main">
              <div class="rev-tabs">
                <button :class="['rt', reviewRating === 0 && !mediaOnly && 'on']" @click="loadReviews(0, false)">全部</button>
                <button :class="['rt', reviewRating === 5 && 'on']" @click="loadReviews(5, false)">好评</button>
                <button :class="['rt', reviewRating === 3 && 'on']" @click="loadReviews(3, false)">中差评</button>
                <button :class="['rt', mediaOnly && 'on']" @click="loadReviews(0, true)">有图 / 视频</button>
              </div>

              <div v-if="!reviews?.items?.length" class="empty-rev">
                {{ reviewTagId ? `没有带「${reviewTagName}」标签的评价，换个标签看看`
                  : mediaOnly ? '还没有带图或视频的评价，期待你的第一条晒单'
                    : '还没有评价，买过的用户可以来写第一条' }}
              </div>
              <div v-for="r in (reviews?.items || [])" :key="r.id" class="rev-item">
                <div class="ri-head">
                  <span class="ri-name">{{ r.userName }}</span>
                  <span class="ri-stars">{{ '★'.repeat(r.rating) }}</span>
                  <span v-if="r.rewardCents" class="ri-reward">返 ¥{{ (r.rewardCents / 100).toFixed(2) }}</span>
                  <span class="dim ri-time">{{ r.createdAt?.slice(0, 10) }}</span>
                </div>
                <div v-if="dimEntries(r.dimensions).length" class="ri-dims">
                  <span v-for="d in dimEntries(r.dimensions)" :key="d.key" class="ri-dim">
                    {{ d.label }} <b>{{ d.score }}</b>
                  </span>
                </div>
                <div v-if="r.tags?.length" class="ri-tags">
                  <span
                    v-for="t in r.tags" :key="t.id" class="ri-tag"
                    :class="{ bad: t.polarity === 'bad', custom: t.dimension === 'custom' }"
                  >{{ t.name }}</span>
                </div>
                <p class="ri-content">{{ r.content || '该用户没有填写文字评价' }}</p>
                <div v-if="r.video || r.images?.length" class="ri-media">
                  <video
                    v-if="r.video"
                    class="ri-video"
                    :src="r.video"
                    controls
                    playsinline
                    preload="metadata"
                  />
                  <button
                    v-for="(img, i) in (r.images || [])"
                    :key="i"
                    class="ri-thumb"
                    @click="lightbox = img"
                  >
                    <img :src="img" :alt="`买家晒图 ${i + 1}`" loading="lazy" />
                  </button>
                </div>
                <div v-if="r.reply" class="ri-reply"><b>商家回复：</b>{{ r.reply }}</div>
                <button class="ri-useful" @click="api.usefulReview(r.id); r.useful++">有用 {{ r.useful }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 买家晒图大图预览 -->
    <div v-if="lightbox" class="lightbox" @click="lightbox = ''">
      <img :src="lightbox" alt="买家晒图" />
      <button class="lb-close" @click="lightbox = ''">×</button>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 1200px; margin: 0 auto; padding: 20px 24px 64px; }
.crumb { display: flex; gap: 6px; font-size: 12px; color: var(--text-3); margin-bottom: 20px; flex-wrap: wrap; }
.crumb a:hover { color: var(--primary); }

.detail { display: grid; grid-template-columns: 440px 1fr; gap: 40px; margin-bottom: 32px; }
.gallery-main {
  aspect-ratio: 1;
  border-radius: var(--r-lg);
  background: linear-gradient(160deg, #f5f7fb 0%, #eceff6 100%);
  display: grid; place-items: center;
  font-size: 110px;
  border: 1px solid var(--line);
}

.info { display: flex; flex-direction: column; gap: 14px; }
.title { font-size: 26px; font-weight: 600; line-height: 1.3; margin: 0; letter-spacing: -0.01em; }
.subtitle { font-size: 14px; color: var(--text-2); margin: 0; }

.rating-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.stars { color: var(--warning); letter-spacing: 1px; }
.divider { width: 1px; height: 10px; background: var(--line-strong); }

.price-box {
  display: flex;
  align-items: baseline;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 16px 18px;
}
.price-lg { font-size: 32px; font-weight: 600; color: var(--price); font-family: var(--mono); letter-spacing: -0.02em; }
.price-old { font-size: 14px; }

.tags { display: flex; flex-wrap: wrap; gap: 6px; }

.qty-row { display: flex; align-items: center; gap: 12px; }
.label { font-size: 13px; color: var(--text-2); }
.stepper {
  display: flex;
  align-items: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.stepper button {
  width: 32px; height: 32px;
  border: 0;
  background: var(--surface);
  font-size: 15px;
  color: var(--text-2);
}
.stepper button:hover:not(:disabled) { background: var(--surface-2); }
.stepper button:disabled { opacity: 0.35; cursor: not-allowed; }
.stepper span { width: 44px; text-align: center; font-size: 13px; }

.actions { display: flex; gap: 12px; }
.actions .btn { flex: 1; }

.ship-note {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-3);
  padding-top: 6px;
  flex-wrap: wrap;
}

/* 库存状态条：用颜色和短句直接给结论 */
.stock-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  font-size: 12px;
  background: var(--surface-2);
  color: var(--text-2);
}
.stock-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.stock-hint { color: var(--text-3); }
.stock-enough { background: var(--success-soft); color: var(--success); }
.stock-limited { background: var(--surface-2); color: var(--text-2); }
.stock-low { background: var(--warning-soft); color: var(--warning); }
.stock-out { background: var(--danger-soft, #fdecec); color: var(--danger); }

/* 价格构成明细 */
.price-detail {
  margin-top: 12px;
  padding: 12px 14px;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  font-size: 12px;
}
.pd-row { display: flex; justify-content: space-between; padding: 3px 0; color: var(--text-2); }
.pd-total { margin-top: 6px; padding-top: 8px; border-top: 1px dashed var(--line-strong); font-weight: 500; color: var(--text); }
.pd-note { margin-top: 8px; font-size: 11px; color: var(--text-3); line-height: 1.6; }

/* 退换政策前置 */
.policy-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 10px;
  font-size: 12px;
}
.policy-item.ok { color: var(--success); }
.policy-item.warn { color: var(--warning); }

/* 规格实测表 */
.sub-title { font-size: 13px; font-weight: 600; margin: 24px 0 10px; color: var(--text-2); }
.spec-table {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
  margin-bottom: 20px;
}
.spec-row { display: flex; font-size: 13px; border-bottom: 1px solid var(--line); }
.spec-row:last-child { border-bottom: 0; }
.spec-row:nth-child(odd) { background: var(--surface-2); }
.spec-key { width: 108px; flex-shrink: 0; padding: 10px 14px; color: var(--text-3); }
.spec-val { padding: 10px 14px; color: var(--text); flex: 1; }

.lower { display: grid; grid-template-columns: 1fr 400px; gap: 20px; align-items: start; }
.block-title { font-size: 15px; font-weight: 600; margin: 0 0 12px; }
.desc-text { font-size: 14px; line-height: 1.8; color: var(--text-2); margin: 0 0 20px; }
.spec-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 24px; }
.spec { display: flex; justify-content: space-between; font-size: 13px; padding: 8px 0; border-bottom: 1px dashed var(--line); }

.qa-empty { padding: 4px 0 12px; font-size: 13px; }
.qa-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: var(--r-full);
  padding: 4px 11px;
  font-size: 12px;
  color: var(--text-2);
}
.chip:hover { border-color: var(--ai); color: var(--ai); }

.qa-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.qa-msg { display: flex; }
.qa-msg.user { justify-content: flex-end; }
.qa-bubble {
  max-width: 88%;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  background: var(--ai-soft);
  border-top-left-radius: 4px;
}
.qa-msg.user .qa-bubble { background: var(--primary); color: #fff; border-radius: 10px; border-top-right-radius: 4px; }
.qa-input-row { display: flex; gap: 8px; }

@media (max-width: 1024px) {
  .detail { grid-template-columns: 1fr; gap: 24px; }
  .lower { grid-template-columns: 1fr; }
  .gallery-main { aspect-ratio: 16/10; font-size: 72px; }
}
@media (max-width: 640px) {
  .page { padding: 16px 16px 48px; }
  .title { font-size: 20px; }
  .price-lg { font-size: 26px; }
  .spec-list { grid-template-columns: 1fr; }
}

/* ── 商城 2.0：店铺 / 活动价 / SKU / 收藏 / 评价 ── */
.shop-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; padding: 8px 12px;
  background: var(--bg-2, #f8fafc); border-radius: 10px; }
.shop-logo { font-size: 16px; }
.shop-name { font-weight: 600; }
.shop-link { margin-left: auto; color: var(--primary); font-size: 12px; }
.review-jump { text-decoration: none; color: var(--text-3); cursor: pointer; }
.review-jump:hover { color: var(--primary); }

.campaign-strip { display: flex; align-items: center; gap: 10px; margin: 10px 0;
  background: linear-gradient(90deg, #fff1f0, #fff7e6); border: 1px solid #fecaca; border-radius: 10px; padding: 10px 14px; }
.cp-tag { font-size: 12px; color: #fff; background: #e53935; border-radius: 6px; padding: 2px 8px; }
.cp-price { color: #e53935; font-size: 20px; font-weight: 700; }
.cp-note { font-size: 12px; color: #b45309; }

.team-block { margin: 10px 0 4px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.team-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; margin-bottom: 6px; }
.team-head .label { font-weight: 600; font-size: 13px; }
.team-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px dashed var(--line); }
.team-row:first-of-type { border-top: none; }
.team-name { font-size: 13px; }
.team-meta { font-size: 11px; margin-top: 2px; }

.sku-block { margin: 14px 0; }
.sku-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.sku-picked { font-size: 12px; }
.sku-list { display: flex; flex-wrap: wrap; gap: 8px; }
.sku-chip { border: 1px solid var(--line, #e5e7eb); background: #fff; border-radius: 10px; padding: 8px 14px;
  cursor: pointer; font-size: 13px; display: flex; flex-direction: column; gap: 2px; min-width: 92px; }
.sku-chip.on { border-color: #e53935; background: #fff5f5; color: #b91c1c; }
.sku-chip.off { opacity: .4; cursor: not-allowed; text-decoration: line-through; }
.sku-price { font-size: 11px; color: #9ca3af; }
.sku-stock { font-size: 12px; margin-top: 6px; }

.fav-btn { border: 1px solid var(--line, #e5e7eb); background: #fff; border-radius: 10px; padding: 0 16px;
  cursor: pointer; font-size: 13px; color: #6b7280; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 2px; min-width: 64px; }
.fav-btn span { font-size: 11px; }
.fav-btn.on { color: #e53935; border-color: #fecaca; background: #fff5f5; }

.reviews { margin-top: 16px; }
.ai-summary { background: linear-gradient(135deg, #f5f3ff, #eff6ff); border: 1px solid #e0e7ff;
  border-radius: 12px; padding: 14px 16px; margin-bottom: 18px; }
.as-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.as-line { margin: 0 0 10px; font-size: 14px; line-height: 1.65; }
.as-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; margin-top: 6px; }
.as-tag { font-size: 11px; padding: 1px 8px; border-radius: 99px; }
.as-tag.good { background: #dcfce7; color: #15803d; }
.as-tag.bad { background: #fee2e2; color: #b91c1c; }
.as-item { font-size: 12px; color: #4b5563; background: #fff; border-radius: 8px; padding: 3px 10px; }

.rev-body { display: grid; grid-template-columns: 220px 1fr; gap: 24px; }
.rev-score { text-align: center; padding: 10px 0 16px; }
.rev-score b { display: block; font-size: 34px; color: #e53935; line-height: 1; }
.rev-score span { font-size: 12px; }
.d-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 11px; }
.d-star { width: 34px; color: #9ca3af; }
.d-bar { flex: 1; height: 6px; background: #f3f4f6; border-radius: 99px; overflow: hidden; }
.d-bar i { display: block; height: 100%; background: #fbbf24; }
.d-num { width: 26px; text-align: right; color: #9ca3af; }

/* 买家印象标签云 */
.impressions {
  background: #f8fafc; border: 1px solid #eef2f7; border-radius: 12px;
  padding: 12px 14px; margin-bottom: 16px;
}
.imp-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.imp-title { font-size: 13px; font-weight: 600; }
.imp-sub { font-size: 11px; }
.imp-clear {
  margin-left: auto; border: 1px solid #fecaca; background: #fff5f5; color: #b91c1c;
  border-radius: 99px; padding: 2px 10px; font-size: 11px; cursor: pointer;
}
.imp-group { display: flex; gap: 8px; align-items: flex-start; margin-top: 6px; }
.imp-dim { width: 64px; flex-shrink: 0; padding-top: 4px; font-size: 11px; color: #9ca3af; }
.imp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.imp-chip {
  border: 1px solid #e5e7eb; background: #fff; color: #4b5563;
  border-radius: 99px; padding: 3px 10px; font-size: 12px; cursor: pointer; transition: all .15s;
}
.imp-chip b { margin-left: 5px; color: #9ca3af; font-weight: 500; font-size: 11px; }
.imp-chip:hover { border-color: #fca5a5; color: #b91c1c; }
.imp-chip.on { background: #111827; border-color: #111827; color: #fff; }
.imp-chip.on b { color: #e5e7eb; }
.imp-chip.bad { border-style: dashed; }
.imp-chip.bad.on { background: #b91c1c; border-color: #b91c1c; color: #fff; }

/* 分项评分条 */
.dim-bars { margin-top: 16px; border-top: 1px dashed #eef2f7; padding-top: 12px; }
.db-title { font-size: 11px; color: #9ca3af; margin-bottom: 8px; }
.db-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 11px; }
.db-label { width: 58px; flex-shrink: 0; color: #6b7280; }
.db-track { flex: 1; height: 5px; background: #f3f4f6; border-radius: 99px; overflow: hidden; }
.db-track i { display: block; height: 100%; background: linear-gradient(90deg, #fbbf24, #f59e0b); }
.db-num { width: 22px; text-align: right; color: #6b7280; }

.rev-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.rev-tabs .rt { border: none; background: #f3f4f6; padding: 5px 14px; border-radius: 99px; font-size: 12px;
  color: #6b7280; cursor: pointer; }
.rev-tabs .rt.on { background: #111827; color: #fff; }
.rev-item { padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
.ri-head { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.ri-name { font-weight: 600; }
.ri-stars { color: #fbbf24; letter-spacing: 1px; }
.ri-time { margin-left: auto; }
.ri-dims { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.ri-dim { font-size: 11px; color: #6b7280; background: #f3f4f6; border-radius: 6px; padding: 2px 8px; }
.ri-dim b { color: #374151; margin-left: 2px; }
.ri-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.ri-tag { font-size: 11px; background: #eef2ff; color: #4338ca; border-radius: 99px; padding: 2px 9px; }
.ri-tag.bad { background: #fef2f2; color: #b91c1c; }
.ri-tag.custom { background: #ecfdf5; color: #047857; }
.ri-content { margin: 6px 0 0; font-size: 13px; line-height: 1.65; color: #374151; }
.ri-reply { margin-top: 8px; background: #f8fafc; border-radius: 8px; padding: 8px 10px; font-size: 12px; color: #4b5563; }
.ri-useful { margin-top: 8px; border: 1px solid #e5e7eb; background: #fff; border-radius: 99px;
  padding: 2px 12px; font-size: 11px; color: #6b7280; cursor: pointer; }
.empty-rev { padding: 30px 0; text-align: center; color: #9ca3af; font-size: 13px; }

/* 买家晒图 / 视频 */
.ri-reward {
  font-size: 10px; color: #b45309; background: #fef3c7;
  padding: 1px 6px; border-radius: 99px;
}
.ri-media { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; align-items: flex-start; }
.ri-thumb {
  width: 84px; height: 84px; padding: 0; border: 0; border-radius: 8px;
  overflow: hidden; cursor: zoom-in; background: #f3f4f6;
}
.ri-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
.ri-thumb:hover img { transform: scale(1.06); }
.ri-video { width: 180px; max-height: 180px; border-radius: 8px; background: #000; display: block; }

.lightbox {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(9, 13, 22, 0.86);
  display: grid; place-items: center; padding: 40px; cursor: zoom-out;
}
.lightbox img { max-width: 92vw; max-height: 88vh; border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
.lb-close {
  position: absolute; top: 24px; right: 28px;
  width: 34px; height: 34px; border-radius: 50%; border: 0;
  background: rgba(255,255,255,.14); color: #fff; font-size: 20px; cursor: pointer;
}

@media (max-width: 900px) {
  .rev-body { grid-template-columns: 1fr; }
  .rev-score { text-align: left; }
  .ri-video { width: 140px; }
  .imp-group { flex-direction: column; gap: 2px; }
  .imp-dim { width: auto; }
  .dim-bars { max-width: 320px; }
}
</style>
