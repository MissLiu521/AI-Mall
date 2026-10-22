<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue';
import { api } from '../../api';
import { useToast } from '../../store';

const toast = useToast();
const coupons = ref<any[]>([]);
const flash = ref<any[]>([]);
const groups = ref<any[]>([]);
const loading = ref(true);
const showForm = ref(false);
const saving = ref(false);

const form = reactive({
  title: '', type: 'reduce', threshold: 199, value: 30,
  maxDiscount: 100, total: 1000, perUser: 1, category: '', days: 30,
});

const typeLabel: Record<string, string> = { reduce: '满减券', discount: '折扣券', free_ship: '免邮券' };

async function load() {
  loading.value = true;
  try {
    const [c, f, g] = await Promise.all([api.adminCoupons(), api.flashSales(), api.groupBuys()]);
    coupons.value = c as any;
    flash.value = f as any;
    groups.value = g as any;
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { loading.value = false; }
}
onMounted(load);

const claimedTotal = computed(() => coupons.value.reduce((s, c) => s + (c.claimed || 0), 0));

async function create() {
  saving.value = true;
  try {
    await api.createCoupon({ ...form });
    toast.push('优惠券已创建', 'success');
    showForm.value = false;
    await load();
  } catch (e: any) { toast.push(e.message, 'error'); }
  finally { saving.value = false; }
}
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h1>营销中心</h1>
        <p>优惠券、限时秒杀、拼团。所有优惠都走同一套计价引擎，结算页与订单金额逐分一致。</p>
      </div>
      <button class="btn btn-primary" @click="showForm = !showForm">{{ showForm ? '取消' : '+ 新建优惠券' }}</button>
    </div>

    <div class="kpis">
      <div class="kpi"><b>{{ coupons.length }}</b><span>券模板</span></div>
      <div class="kpi"><b>{{ claimedTotal }}</b><span>累计领取</span></div>
      <div class="kpi"><b>{{ flash.length }}</b><span>进行中秒杀</span></div>
      <div class="kpi"><b>{{ groups.length }}</b><span>拼团活动</span></div>
    </div>

    <div v-if="showForm" class="card card-pad form">
      <h2 class="block-title">新建优惠券</h2>
      <div class="grid-3">
        <div class="field"><label>券名称</label><input v-model="form.title" class="input" placeholder="如：双 11 满 299 减 50" /></div>
        <div class="field">
          <label>类型</label>
          <select v-model="form.type" class="input">
            <option value="reduce">满减券</option>
            <option value="discount">折扣券</option>
            <option value="free_ship">免邮券</option>
          </select>
        </div>
        <div class="field"><label>门槛（元）</label><input v-model.number="form.threshold" type="number" class="input" min="0" /></div>
        <div class="field" v-if="form.type !== 'free_ship'">
          <label>{{ form.type === 'discount' ? '折扣（如 90 = 9 折）' : '面额（元）' }}</label>
          <input v-model.number="form.value" type="number" class="input" min="1" />
        </div>
        <div class="field" v-if="form.type === 'discount'">
          <label>最高减（元）</label>
          <input v-model.number="form.maxDiscount" type="number" class="input" min="1" />
        </div>
        <div class="field"><label>发放总量</label><input v-model.number="form.total" type="number" class="input" min="1" /></div>
        <div class="field"><label>每人限领</label><input v-model.number="form.perUser" type="number" class="input" min="1" /></div>
        <div class="field">
          <label>适用品类（留空为全场）</label>
          <select v-model="form.category" class="input">
            <option value="">全场通用</option>
            <option v-for="c in ['数码', '家居', '服饰', '美妆', '个护', '食品']" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field"><label>有效天数</label><input v-model.number="form.days" type="number" class="input" min="1" /></div>
      </div>
      <button class="btn btn-primary" style="margin-top: 14px" :disabled="saving || !form.title" @click="create">
        {{ saving ? '创建中…' : '创建并上线' }}
      </button>
    </div>

    <div v-if="loading" class="card card-pad">加载中…</div>

    <template v-else>
      <div class="card">
        <div class="card-head">优惠券</div>
        <table class="tbl">
          <thead><tr><th>券名称</th><th>类型</th><th>门槛</th><th>面额/折扣</th><th>已领/总量</th><th>每人</th><th>适用</th><th>到期</th></tr></thead>
          <tbody>
            <tr v-for="c in coupons" :key="c.id">
              <td class="strong">{{ c.title }}</td>
              <td>{{ typeLabel[c.type] }}</td>
              <td>{{ c.threshold ? `满 ¥${c.threshold}` : '无门槛' }}</td>
              <td class="danger">
                {{ c.type === 'free_ship' ? '免运费' : c.type === 'discount' ? `${(c.value / 10).toFixed(1)} 折` : `¥${c.value / 100}` }}
              </td>
              <td>{{ c.claimed }} / {{ c.total }}</td>
              <td>{{ c.perUser }}</td>
              <td>{{ c.category }}</td>
              <td class="dim">{{ c.endAt?.slice(0, 10) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="two">
        <div class="card">
          <div class="card-head">限时秒杀</div>
          <div v-for="f in flash" :key="f.id" class="mini">
            <span class="m-img">{{ f.image }}</span>
            <div class="grow">
              <div class="m-name">{{ f.productName }}</div>
              <div class="dim">¥{{ f.price }} <s>¥{{ f.origin }}</s> · 已抢 {{ f.sold }}/{{ f.stock }}</div>
            </div>
            <span class="badge badge-primary">{{ f.off }}% OFF</span>
          </div>
          <div v-if="!flash.length" class="dim pad">暂无进行中的秒杀</div>
        </div>

        <div class="card">
          <div class="card-head">拼团活动</div>
          <div v-for="g in groups" :key="g.id" class="mini">
            <span class="m-img">{{ g.image }}</span>
            <div class="grow">
              <div class="m-name">{{ g.productTitle }}</div>
              <div class="dim">¥{{ g.price }} · {{ g.required }} 人成团 · {{ g.teams }} 个团在拼</div>
            </div>
          </div>
          <div v-if="!groups.length" class="dim pad">暂无拼团活动</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.head h1 { font-size: 20px; margin: 0 0 6px; }
.head p { margin: 0; font-size: 13px; color: var(--text-3); }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.kpi { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 10px rgba(0,0,0,.04); }
.kpi b { display: block; font-size: 22px; }
.kpi span { font-size: 12px; color: var(--text-3); }
.form { margin-bottom: 16px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.04); margin-bottom: 14px; overflow: hidden; }
.card-head { padding: 12px 16px; font-weight: 600; font-size: 14px; border-bottom: 1px solid var(--line); }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { text-align: left; padding: 10px 14px; background: var(--surface-2); font-weight: 500; color: var(--text-3); font-size: 12px; }
.tbl td { padding: 11px 14px; border-top: 1px solid var(--line); }
.strong { font-weight: 600; }
.danger { color: #e53935; font-weight: 600; }
.dim { color: var(--text-3); font-size: 12px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.mini { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line); }
.m-img { font-size: 22px; }
.m-name { font-size: 13px; font-weight: 500; }
.grow { flex: 1; }
.pad { padding: 16px; }
@media (max-width: 900px) { .kpis, .grid-3, .two { grid-template-columns: 1fr 1fr; } }
</style>
