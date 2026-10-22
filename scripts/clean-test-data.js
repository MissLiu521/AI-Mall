/**
 * 清理端到端测试留下的账号与订单（默认 dry-run，加 --yes 才执行）
 * 只匹配 e2e_ / flow_ / dbg_ 前缀的测试邮箱，不会碰种子账号。
 */
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = process.env.DB_FILE || path.resolve('server/data/mall.db');
const apply = process.argv.includes('--yes');
const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const TEST = /^(e2e|flow|dbg)_/i;
const users = db.prepare('SELECT id, email FROM users').all().filter((u) => TEST.test(u.email));
if (!users.length) {
  console.log('没有测试账号，无需清理');
  process.exit(0);
}
const ids = users.map((u) => u.id);
const ph = ids.map(() => '?').join(',');
const orders = db.prepare(`SELECT id FROM orders WHERE user_id IN (${ph})`).all(...ids);

console.log(`待清理：${users.length} 个账号 / ${orders.length} 笔订单`);
console.table(users);
if (!apply) {
  console.log('（dry-run）确认无误后加 --yes 执行');
  process.exit(0);
}

db.exec('BEGIN');
for (const o of orders) {
  const items = db.prepare('SELECT product_id, sku_id, qty FROM order_items WHERE order_id = ?').all(o.id);
  for (const it of items) {
    db.prepare('UPDATE products SET stock = stock + ?, sales = MAX(0, sales - ?) WHERE id = ?')
      .run(it.qty, it.qty, it.product_id);
    if (it.sku_id) db.prepare('UPDATE product_skus SET stock = stock + ? WHERE id = ?').run(it.qty, it.sku_id);
  }
  db.prepare('DELETE FROM reviews WHERE order_id = ?').run(o.id);
  db.prepare('DELETE FROM shipment_events WHERE order_id = ?').run(o.id);
  db.prepare('DELETE FROM refunds WHERE order_id = ?').run(o.id);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(o.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
}
for (const id of ids) {
  db.prepare('DELETE FROM group_members WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM addresses WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM favorites WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM footprints WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM points_log WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM user_coupons WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM reviews WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
// 只剩空壳的团（成员都删了）一并清掉
db.prepare(`DELETE FROM group_teams WHERE id NOT IN (SELECT DISTINCT team_id FROM group_members)`).run();
db.exec('COMMIT');
console.log(`✅ 已清理 ${users.length} 个账号、${orders.length} 笔订单，并回补库存`);
db.close();
