/**
 * 地址智能识别 + 级联数据辅助
 *
 * 目标：用户把「张三 13800138000 北京市朝阳区建国路 88 号 1 单元 1203」整段粘进来，
 * 自动拆成 收件人 / 手机号 / 省 / 市 / 区 / 详细地址，省掉手动选三级下拉。
 *
 * 纯函数，不依赖 DOM / Intl，Web 与移动端共用同一份实现。
 */

export type RegionTree = Record<string, Record<string, string[]>>;

export interface ParsedAddress {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  /** 拼好的「省 市 区」，直辖市不会重复出现两次 */
  region: string;
  detail: string;
  /** 没识别出来的字段名，UI 据此提示用户补填 */
  missing: string[];
}

export interface AddressDraft {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
}

/**
 * 表单必填校验。返回 { 字段: 错误文案 }，空对象表示通过。
 * Web 与移动端共用，避免两端规则漂移。
 */
export function validateAddress(f: AddressDraft): Record<string, string> {
  const errors: Record<string, string> = {};

  const name = (f.name || '').trim();
  if (!name) errors.name = '请填写收件人姓名';
  else if (name.length > 30) errors.name = '姓名不能超过 30 个字';

  const phone = (f.phone || '').trim();
  if (!phone) errors.phone = '请填写手机号';
  else if (!/^1[3-9]\d{9}$/.test(phone) && !/^[+\d][\d\s-]{5,19}$/.test(phone)) errors.phone = '手机号格式不正确';

  if (!f.province) errors.province = '请选择省份';
  else if (!f.city) errors.city = '请选择城市';
  else if (!f.district) errors.district = '请选择区/县';

  const detail = (f.detail || '').trim();
  if (detail.length < 5) errors.detail = '详细地址至少 5 个字（街道、门牌号、楼栋房间）';

  return errors;
}

const CN = /[\u4e00-\u9fa5·]/;
/** 出现这些字符基本可以断定是地址而不是人名 */
const ADDR_HINT = /[省市县区镇乡村街路巷弄号栋幢座单元楼层室\d]/;
const COMPOUND_SURNAME = [
  '欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '长孙',
  '宇文', '司徒', '司空', '令狐', '夏侯', '端木', '轩辕', '独孤', '南宫', '西门',
  '呼延', '赫连', '申屠', '第五', '澹台', '公冶', '宗政', '濮阳', '太史', '闻人',
];
const TITLE = '先生|女士|小姐|老师|经理|同学|师傅|医生';

/** 省名去后缀得到的简称，用于匹配「广东深圳」这类省略写法 */
function provinceAliases(full: string): string[] {
  const out = new Set<string>([full]);
  const short = full
    .replace(/特别行政区$/, '')
    .replace(/维吾尔自治区$/, '')
    .replace(/壮族自治区$/, '')
    .replace(/回族自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/[省市]$/, '');
  out.add(short);
  return [...out].filter((a) => a.length >= 2);
}

function cityAliases(full: string): string[] {
  const out = new Set<string>([full]);
  out.add(full.replace(/(自治州|地区|特别行政区|市|盟)$/, ''));
  out.add(full.replace(/[\u4e00-\u9fa5]{1,4}族自治州$/, ''));
  return [...out].filter((a) => a.length >= 2);
}

function districtAliases(full: string): string[] {
  const out = new Set<string>([full]);
  out.add(full.replace(/(自治县|自治旗|新区|区|县|市|旗)$/, ''));
  return [...out].filter((a) => a.length >= 2);
}

interface Hit { full: string; index: number; len: number }

/** 在文本里找最合适的候选：优先别名更长（更具体），同长度取出现更早的 */
function findHit(text: string, candidates: Array<{ alias: string; full: string }>): Hit | null {
  let best: Hit | null = null;
  for (const c of candidates) {
    const i = text.indexOf(c.alias);
    if (i < 0) continue;
    if (!best || c.alias.length > best.len || (c.alias.length === best.len && i < best.index)) {
      best = { full: c.full, index: i, len: c.alias.length };
    }
  }
  return best;
}

/** 从文本里抠掉一段，用等长空格占位，保持后续索引不变 */
function cut(text: string, hit: Hit): string {
  return text.slice(0, hit.index) + ' '.repeat(hit.len) + text.slice(hit.index + hit.len);
}

function pickName(input: string): { name: string; rest: string } {
  // 去掉「收货人：」「姓名：」这类标签，以及首尾空白与标点
  let t = input
    .replace(/(收货人|收件人|联系人|姓名|名字)\s*[:：]/g, ' ')
    .replace(/(电话|手机号|联系方式|手机)\s*[:：]?\s*/g, ' ')
    .replace(/^[\s,，、;；:：.。]+/, '')
    .replace(/[\s,，、;；:：.。]+$/, '');
  if (!t) return { name: '', rest: '' };

  // A. 优先取末尾姓名：绝大多数粘贴格式是「地址… 姓名 电话」
  const tail = t.match(new RegExp(`([\\u4e00-\\u9fa5·]{2,4})(?:\\s*(?:${TITLE}))?\\s*$`));
  if (tail) {
    const start = tail.index!;
    const before = t[start - 1] || '';
    const boundary = start === 0 || /[\s,，、;；:：]/.test(before) || /\d/.test(before);
    if (boundary && !ADDR_HINT.test(tail[1])) {
      return { name: tail[1], rest: t.slice(0, start) };
    }
  }

  // B. 姓名在开头：要求姓名后面是明确边界（空格 / 标点 / 数字 / 称谓），
  //    且姓名本身不含地址字样，避免把「中山北路」的「中山」当人名。
  const titled = t.match(new RegExp(`^([\\u4e00-\\u9fa5·]{2,4})(?:${TITLE})`));
  if (titled) return { name: titled[1], rest: t.slice(titled[0].length) };

  const compound = COMPOUND_SURNAME.find((s) =>
    t.startsWith(s) && CN.test(t[s.length] || '') && t.length >= s.length + 2);
  if (compound) {
    const after = t.slice(compound.length);
    const given = after.match(/^[\u4e00-\u9fa5·]{1,2}/)?.[0] || '';
    if (given && !ADDR_HINT.test(given)) {
      return { name: compound + given, rest: t.slice(compound.length + given.length) };
    }
  }

  for (const n of [2, 3, 4]) {
    const cand = t.slice(0, n);
    if (cand.length < n || !/^[\u4e00-\u9fa5·]+$/.test(cand)) break;
    if (ADDR_HINT.test(cand)) continue;
    const next = t[n] || '';
    // 必须紧跟边界，否则可能是地址词的一部分
    if (!(next === '' || /[\s,，、;；:：.]/.test(next) || /\d/.test(next))) continue;
    return { name: cand, rest: t.slice(n) };
  }

  return { name: '', rest: t };
}

function pickPhone(text: string): { phone: string; rest: string } {
  // 先匹配带分隔符的写法，再匹配 11 位连续数字
  const m = text.match(/(?:\+?86[-\s]?)?(1[3-9]\d[-\s]?\d{4}[-\s]?\d{4})/)
    || text.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/)
    || text.match(/(0\d{2,3}[-\s]?\d{7,8})/);
  if (!m) return { phone: '', rest: text };
  const phone = m[1].replace(/[-\s]/g, '');
  return { phone, rest: text.slice(0, m.index!) + ' '.repeat(m[0].length) + text.slice(m.index! + m[0].length) };
}

/** 清理详细地址里多余的空格、连续标点和首尾分隔符 */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[,，、;；]{2,}/g, '，')
    .replace(/([,，、;；])\s+(?=[,，、;；])/g, '$1')
    .replace(/^[\s,，、;；:：.。\-]+/, '')
    .replace(/[\s,，、;；:：.。\-]+$/, '')
    .trim();
}

/**
 * 解析一段自由文本地址。
 * 识别不出的字段返回空串，并写进 missing，交给 UI 提示补填。
 */
export function parseAddress(raw: string, tree: RegionTree): ParsedAddress {
  const input = String(raw || '').replace(/\s+/g, ' ').trim();
  const empty: ParsedAddress = {
    name: '', phone: '', province: '', city: '', district: '',
    region: '', detail: input, missing: ['收件人', '手机号', '所在地区', '详细地址'],
  };
  if (!input) return empty;

  const { phone, rest: afterPhone } = pickPhone(input);
  let text = afterPhone;

  let province = '';
  let city = '';
  let district = '';

  // 1) 省
  const provinceCandidates = Object.keys(tree).flatMap((p) =>
    provinceAliases(p).map((alias) => ({ alias, full: p })));
  const provHit = findHit(text, provinceCandidates);

  if (provHit) {
    province = provHit.full;
    text = cut(text, provHit);
    const provinceEnd = provHit.index + provHit.len;

    // 2) 市：只在省名之后找，避免「吉林省吉林市」被同名干扰
    const cities = Object.keys(tree[province] || {});
    if (cities.length === 1 && cities[0] === province) {
      city = province; // 直辖市 / 港澳
    } else {
      const cityHit = findHit(text.slice(provinceEnd), cities.flatMap((c) =>
        cityAliases(c).map((alias) => ({ alias, full: c }))));
      if (cityHit) {
        city = cityHit.full;
        text = cut(text, { ...cityHit, index: cityHit.index + provinceEnd });
      }
    }

    // 3) 区：只在市名之后找
    if (city) {
      const districts = tree[province]?.[city] || [];
      const cityEnd = text.indexOf(city) >= 0 ? text.indexOf(city) + city.length : provinceEnd;
      const districtHit = findHit(text.slice(cityEnd), districts.flatMap((d) =>
        districtAliases(d).map((alias) => ({ alias, full: d }))));
      if (districtHit) {
        district = districtHit.full;
        text = cut(text, { ...districtHit, index: districtHit.index + cityEnd });
      }
    }
  } else {
    // 没写省份：可能是「深圳市南山区」这种，用市反查省
    const allCities = Object.entries(tree).flatMap(([p, cities]) =>
      Object.keys(cities).map((c) => ({ province: p, city: c })));
    const cityHit = findHit(text, allCities.flatMap(({ city: c }) =>
      cityAliases(c).map((alias) => ({ alias, full: c }))));
    if (cityHit) {
      const owner = allCities.find((x) => x.city === cityHit.full);
      if (owner) {
        province = owner.province;
        city = owner.city;
        text = cut(text, cityHit);
        const cityEnd = cityHit.index + cityHit.len;
        const districts = tree[province]?.[city] || [];
        const districtHit = findHit(text.slice(cityEnd), districts.flatMap((d) =>
          districtAliases(d).map((alias) => ({ alias, full: d }))));
        if (districtHit) {
          district = districtHit.full;
          text = cut(text, { ...districtHit, index: districtHit.index + cityEnd });
        }
      }
    }
  }

  // 4) 姓名与详细地址
  const { name, rest } = pickName(text);
  const detail = tidy(rest);

  const region = [province, city && city !== province ? city : '', district].filter(Boolean).join(' ');

  const missing: string[] = [];
  if (!name) missing.push('收件人');
  if (!phone) missing.push('手机号');
  if (!province || !district) missing.push('所在地区');
  if (detail.length < 2) missing.push('详细地址');

  return { name, phone, province, city: city || province, district, region, detail, missing };
}
