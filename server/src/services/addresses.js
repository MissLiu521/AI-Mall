import { all, get, run, tx } from '../db/index.js';
import { AppError } from './users.js';
import { int, str } from '../lib/validate.js';
import { toIso } from '../lib/time.js';

const MAX_ADDRESSES = 10;

const map = (a) => ({
  id: a.id,
  name: a.name,
  phone: a.phone,
  region: a.region,
  detail: a.detail,
  isDefault: !!a.is_default,
  createdAt: toIso(a.created_at),
  /** 下单时直接存完整地址快照，订单不再依赖地址簿后续修改 */
  full: `${a.region} ${a.detail}（${a.name} ${a.phone}）`,
});

function normalize(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    out.name = str(input.name, { field: '收件人', min: 1, max: 30 });
  }
  if (!partial || input.phone !== undefined) {
    const phone = str(input.phone, { field: '手机号', min: 6, max: 20 });
    if (!/^[+\d][\d\s-]{5,19}$/.test(phone)) throw new AppError('INVALID', '手机号格式不正确');
    out.phone = phone;
  }
  if (!partial || input.region !== undefined) {
    out.region = str(input.region, { field: '所在地区', min: 2, max: 60 });
  }
  if (!partial || input.detail !== undefined) {
    out.detail = str(input.detail, { field: '详细地址', min: 5, max: 200 });
  }
  return out;
}

export function listAddresses(userId) {
  return all('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [userId]).map(map);
}

export function createAddress(userId, input) {
  const data = normalize(input);
  return tx(() => {
    const count = get('SELECT COUNT(*) AS c FROM addresses WHERE user_id = ?', [userId]).c;
    if (count >= MAX_ADDRESSES) throw new AppError('LIMIT', `最多保存 ${MAX_ADDRESSES} 个地址`);
    const isDefault = count === 0 || input.isDefault === true || input.isDefault === 'true';
    if (isDefault) run('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    const { lastId } = run(
      'INSERT INTO addresses (user_id, name, phone, region, detail, is_default) VALUES (?,?,?,?,?,?)',
      [userId, data.name, data.phone, data.region, data.detail, isDefault ? 1 : 0],
    );
    return map(get('SELECT * FROM addresses WHERE id = ?', [lastId]));
  });
}

export function updateAddress(userId, id, input) {
  const idNum = int(id, { field: '地址 ID', min: 1 });
  const row = get('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [idNum, userId]);
  if (!row) throw new AppError('NOT_FOUND', '地址不存在', 404);
  const data = normalize(input, { partial: true });
  const fields = Object.keys(data);
  return tx(() => {
    if (fields.length) {
      run(`UPDATE addresses SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
        [...fields.map((f) => data[f]), idNum]);
    }
    if (input.isDefault === true || input.isDefault === 'true') {
      run('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
      run('UPDATE addresses SET is_default = 1 WHERE id = ?', [idNum]);
    }
    return map(get('SELECT * FROM addresses WHERE id = ?', [idNum]));
  });
}

export function deleteAddress(userId, id) {
  const idNum = int(id, { field: '地址 ID', min: 1 });
  return tx(() => {
    const row = get('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [idNum, userId]);
    if (!row) throw new AppError('NOT_FOUND', '地址不存在', 404);
    run('DELETE FROM addresses WHERE id = ?', [idNum]);
    if (row.is_default) {
      const next = get('SELECT id FROM addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
      if (next) run('UPDATE addresses SET is_default = 1 WHERE id = ?', [next.id]);
    }
    return { deleted: true };
  });
}

export function setDefaultAddress(userId, id) {
  const idNum = int(id, { field: '地址 ID', min: 1 });
  return tx(() => {
    const row = get('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [idNum, userId]);
    if (!row) throw new AppError('NOT_FOUND', '地址不存在', 404);
    run('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    run('UPDATE addresses SET is_default = 1 WHERE id = ?', [idNum]);
    return map(get('SELECT * FROM addresses WHERE id = ?', [idNum]));
  });
}
