import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './store';

const routes = [
  { path: '/', redirect: '/shop' },

  // ── C 端 ──
  { path: '/shop', name: 'home', component: () => import('./pages/shop/Home.vue'), meta: { layout: 'shop' } },
  { path: '/shop/category', name: 'category', component: () => import('./pages/shop/Category.vue'), meta: { layout: 'shop' } },
  { path: '/product/:id', name: 'product', component: () => import('./pages/shop/ProductDetail.vue'), meta: { layout: 'shop' } },
  { path: '/cart', name: 'cart', component: () => import('./pages/shop/Cart.vue'), meta: { layout: 'shop', auth: true } },
  { path: '/checkout', name: 'checkout', component: () => import('./pages/shop/Checkout.vue'), meta: { layout: 'shop', auth: true } },
  { path: '/orders', name: 'orders', component: () => import('./pages/shop/Orders.vue'), meta: { layout: 'shop', auth: true } },
  { path: '/orders/:id', name: 'orderDetail', component: () => import('./pages/shop/OrderDetail.vue'), meta: { layout: 'shop', auth: true } },
  { path: '/feed', name: 'feed', component: () => import('./pages/shop/Feed.vue'), meta: { layout: 'shop' } },
  { path: '/promo', name: 'promo', component: () => import('./pages/shop/Promo.vue'), meta: { layout: 'shop' } },
  { path: '/mine', name: 'mine', component: () => import('./pages/shop/Mine.vue'), meta: { layout: 'shop', auth: true } },
  { path: '/login', name: 'login', component: () => import('./pages/Login.vue'), meta: { layout: 'blank' } },

  // ── B 端（布局由 App 层的 AdminLayout 承载，父路由不挂组件避免双层嵌套）──
  {
    path: '/admin',
    meta: { layout: 'admin', merchant: true },
    children: [
      { path: '', redirect: '/admin/dashboard' },
      { path: 'dashboard', name: 'dashboard', component: () => import('./pages/admin/Dashboard.vue'), meta: { title: '数据看板' } },
      { path: 'products', name: 'adminProducts', component: () => import('./pages/admin/Products.vue'), meta: { title: '商品管理' } },
      { path: 'orders', name: 'adminOrders', component: () => import('./pages/admin/Orders.vue'), meta: { title: '订单管理' } },
      { path: 'refunds', name: 'adminRefunds', component: () => import('./pages/admin/Refunds.vue'), meta: { title: '退款审核' } },
      { path: 'marketing', name: 'adminMarketing', component: () => import('./pages/admin/Marketing.vue'), meta: { title: '营销中心' } },
      { path: 'reviews', name: 'adminReviews', component: () => import('./pages/admin/Reviews.vue'), meta: { title: '评价管理' } },
      { path: 'review-tags', name: 'adminReviewTags', component: () => import('./pages/admin/ReviewTags.vue'), meta: { title: '评价标签' } },
      { path: 'content', name: 'adminContent', component: () => import('./pages/admin/Content.vue'), meta: { title: '内容管理' } },
      { path: 'tickets', name: 'adminTickets', component: () => import('./pages/admin/Tickets.vue'), meta: { title: '人工工单' } },
      { path: 'ai-conversations', name: 'adminAiChats', component: () => import('./pages/admin/AiConversations.vue'), meta: { title: 'AI 会话' } },
      { path: 'ai-ops', name: 'adminAiOps', component: () => import('./pages/admin/AiOps.vue'), meta: { title: '运营智能体' } },
      { path: 'settings', name: 'adminSettings', component: () => import('./pages/admin/Settings.vue'), meta: { title: 'AI 配置' } },
    ],
  },

  { path: '/:pathMatch(.*)*', redirect: '/shop' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.ready) await auth.bootstrap();

  if (to.meta.auth && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.merchant && !auth.isMerchant) {
    return { name: 'login', query: { redirect: to.fullPath, needMerchant: '1' } };
  }
  return true;
});
