<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useToast } from './store';
import ShopLayout from './components/ShopLayout.vue';
import AdminLayout from './pages/admin/AdminLayout.vue';

const route = useRoute();
const toast = useToast();
const layout = computed(() => (route.meta.layout as string) || 'shop');
</script>

<template>
  <ShopLayout v-if="layout === 'shop'" />
  <AdminLayout v-else-if="layout === 'admin'" />
  <router-view v-else />

  <!-- 全局 Toast -->
  <div class="toast-wrap">
    <transition-group name="toast">
      <div v-for="t in toast.items" :key="t.id" class="toast" :class="`toast-${t.tone}`">
        {{ t.text }}
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast {
  padding: 10px 18px;
  border-radius: var(--r-sm);
  background: var(--text);
  color: #fff;
  font-size: 13px;
  box-shadow: var(--sh-2);
  max-width: 380px;
}
.toast-success { background: var(--success); }
.toast-error { background: var(--danger); }
.toast-enter-active, .toast-leave-active { transition: all 0.22s var(--ease); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
