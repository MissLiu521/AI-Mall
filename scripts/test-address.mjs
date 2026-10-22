/**
 * 地址智能识别 + 必填校验的回归测试
 * 运行：node scripts/test-address.mjs
 *
 * 为什么单独放这里：解析逻辑同时被 Web 与移动端使用（两份文件内容一致），
 * 用纯 Node 跑，不依赖浏览器或小程序环境。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { parseAddress, validateAddress } = await import(
  'file:///' + path.join(root, 'web/src/utils/address.ts').replace(/\\/g, '/')
);
const tree = JSON.parse(fs.readFileSync(path.join(root, 'web/src/data/regions.json'), 'utf8'));

let pass = 0;
const fails = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fails.push({ label, actual, expected });
}

// ── 1. 地址拆分 ────────────────────────────────────────────
const cases = [
  ['张三 13800138000 北京市朝阳区建国路88号1单元1203',
    { name: '张三', phone: '13800138000', region: '北京市 朝阳区', detail: '建国路88号1单元1203' }],
  ['李四13800138000广东省深圳市南山区科技园南路18号A栋502',
    { name: '李四', phone: '13800138000', region: '广东省 深圳市 南山区', detail: '科技园南路18号A栋502' }],
  ['收货人：王小明，电话 138-0013-8000，广东省 广州市 天河区 体育西路 3 号',
    { name: '王小明', phone: '13800138000', region: '广东省 广州市 天河区', detail: '体育西路 3 号' }],
  ['浙江省杭州市西湖区文三路 100 号 张伟 13900139000',
    { name: '张伟', phone: '13900139000', region: '浙江省 杭州市 西湖区', detail: '文三路 100 号' }],
  ['江苏南京鼓楼区中山北路 200 号 12 幢 301 室 赵敏 13700137000',
    { name: '赵敏', phone: '13700137000', region: '江苏省 南京市 鼓楼区', detail: '中山北路 200 号 12 幢 301 室' }],
  ['上海市浦东新区世纪大道8号 3号楼 周杰伦 13500135000',
    { name: '周杰伦', phone: '13500135000', region: '上海市 浦东新区', detail: '世纪大道8号 3号楼' }],
  ['欧阳娜娜 13600136000 上海市浦东新区世纪大道 8 号',
    { name: '欧阳娜娜', phone: '13600136000', region: '上海市 浦东新区', detail: '世纪大道 8 号' }],
  ['内蒙古自治区呼和浩特市新城区中山东路 5 号 那顺 13400134000',
    { name: '那顺', phone: '13400134000', region: '内蒙古自治区 呼和浩特市 新城区', detail: '中山东路 5 号' }],
  ['四川省成都市武侯区天府大道北段 1700 号 李雷 13300133000',
    { name: '李雷', phone: '13300133000', region: '四川省 成都市 武侯区', detail: '天府大道北段 1700 号' }],
  ['13800138000 北京市 海淀区 中关村大街 1 号 韩梅梅',
    { name: '韩梅梅', phone: '13800138000', region: '北京市 海淀区', detail: '中关村大街 1 号' }],
  ['广东深圳龙岗区布吉街道 陈小红 13911112222',
    { name: '陈小红', phone: '13911112222', region: '广东省 深圳市 龙岗区', detail: '布吉街道' }],
];

for (const [input, want] of cases) {
  const r = parseAddress(input, tree);
  check(`拆分：${input.slice(0, 16)}…`,
    { name: r.name, phone: r.phone, region: r.region, detail: r.detail }, want);
}

// 只给了部分信息时，应如实报告缺什么，而不是硬编
{
  const r = parseAddress('张三', tree);
  check('只给姓名 → 缺手机号/地区/详址', r.missing, ['手机号', '所在地区', '详细地址']);
}
{
  const r = parseAddress('建国路88号1单元1203 张三 13800138000', tree);
  check('无省市 → 提示所在地区', r.missing, ['所在地区']);
  check('无省市 → 仍能取到姓名电话', { n: r.name, p: r.phone }, { n: '张三', p: '13800138000' });
}
{
  const r = parseAddress('', tree);
  check('空输入 → 四项全缺', r.missing.length, 4);
}

// ── 2. 必填校验 ────────────────────────────────────────────
const good = { name: '张三', phone: '13800138000', province: '北京市', city: '北京市', district: '朝阳区', detail: '建国路 88 号 1 单元 1203' };
check('完整表单通过', validateAddress(good), {});

for (const field of ['name', 'phone', 'province', 'city', 'district', 'detail']) {
  const bad = { ...good, [field]: '' };
  const e = validateAddress(bad);
  check(`缺少 ${field} → 该字段报错`, Object.keys(e), [field]);
}
check('手机号格式错', Object.keys(validateAddress({ ...good, phone: '12345' })), ['phone']);
check('手机号带空格也算合法', validateAddress({ ...good, phone: '138 0013 8000' }), {});
check('详址太短', Object.keys(validateAddress({ ...good, detail: '1 号' })), ['detail']);
check('姓名超长', Object.keys(validateAddress({ ...good, name: '张'.repeat(31) })), ['name']);
check('空白姓名等同未填', Object.keys(validateAddress({ ...good, name: '   ' })), ['name']);

// ── 3. 两端文件一致 ────────────────────────────────────────
{
  const web = fs.readFileSync(path.join(root, 'web/src/utils/address.ts'), 'utf8');
  const mobile = fs.readFileSync(path.join(root, 'mobile/src/utils/address.ts'), 'utf8');
  check('Web 与移动端解析器内容一致', web === mobile, true);
  const webData = fs.readFileSync(path.join(root, 'web/src/data/regions.json'), 'utf8');
  const mobileData = fs.readFileSync(path.join(root, 'mobile/src/data/regions.json'), 'utf8');
  check('Web 与移动端省市区数据一致', webData === mobileData, true);
}

// ── 输出 ─────────────────────────────────────────────────
for (const f of fails) {
  console.log(`  ❌ ${f.label}`);
  console.log(`     期望 ${JSON.stringify(f.expected)}`);
  console.log(`     实际 ${JSON.stringify(f.actual)}`);
}
console.log(`\n${fails.length ? '❌' : '✅'} 地址模块测试：${pass} 通过 / ${fails.length} 失败\n`);
process.exit(fails.length ? 1 : 0);
