# AI Mall · B/C 一体化 AI 商城系统

一套代码同时服务 **C 端消费者** 与 **B 端商家**，AI 不是装饰性聊天框，而是贯穿售前、售中、售后的执行层。

```
C 端：AI 导购（选品）· AI 客服（查订单 / 发起退款 / 转人工）· 智能推荐
B 端：运营智能体（读数据 / 写文案）· AI 会话质检 · AI 配置 · 知识库 · 人工工单
```

## 快速开始

```bash
# 1. 安装依赖（前后端）
npm run install:all

# 2. 一键启动（后端 3001 + 前端 5173）
npm run dev
```

访问：

| 入口 | 地址 |
| --- | --- |
| C 端商城 | http://localhost:5173/shop |
| B 端后台 | http://localhost:5173/admin |
| API | http://localhost:3001/api/health |

演示账号：

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 商家 | `admin@mall.dev` | `admin123` |
| 买家 | `demo@mall.dev` | `demo123` |

> 首次启动自动建库并写入 16 个商品、2 笔历史订单、8 条客服知识库。
> 老库无需删库：启动时 `migrate()` 会自动补新增字段与表（`ensureColumn`）。

### 演示动线（交易闭环，本地可完整走通）

```
选品（选规格 SKU）→ 加购（按店铺分组 / 勾选结算） → 确认订单（选地址簿 + 选券 + 积分抵扣）
     → 下单（待付款）→ 点「模拟支付」 → 待发货
     → 后台「订单」发货 → 已发货 → 查看物流轨迹 → 派送 → 签收自动完成
     → 去评价（星级 + 分项评分 + 印象标签 + 拍照 / 录像，最多 9 图 + 1 视频）→ 按「文字数 + 图片数」返 ¥1～¥5 到余额
     → 评价出现在商品页 / 买家印象标签云 / AI 摘要；点标签可筛评价；返现可在下一单结算页勾选「余额抵扣」直接用掉
评价标签：评价时给「外观 / 性能 / 颜色 / 质量 / 性价比 / 服务」分别打分，勾选「颜值在线、运行流畅、无色差」等标签；词库没有的可以自己写（2–8 字，最多 3 个）→ 后台「评价标签」审核通过后进入公共词库
营销：领券中心领券 → 秒杀场次倒计时抢购（每人限购） → 拼团「自己开团」或商品详情「正在凑的团 · 参团」→ 成团自动转待发货，未成团自动退款
旁路：待付款可「取消订单」并回补库存/SKU 配额/券/积分；已支付也可取消（模拟原路退回，同步扣回返积分与累计消费）；15 分钟未支付自动关单；发货 7 天自动确认收货
售后：申请退款 → 后台驳回（订单回到原状态）→ 可再次申请 → 通过后订单转「已退款」并回补库存/券/积分
兜底：AI 客服答不上来 → 点「转人工」→ 后台「人工工单」回复结单
地址：把「张三 13800138000 北京市朝阳区建国路 88 号」整段粘进表单 → 自动拆出姓名/电话/省市区/详址
```

### 计价口径（唯一真相源）

结算页与真实下单调用**同一个函数**（`server/src/services/pricing.js` 的 `quote()`），所以预览金额与订单金额逐分一致：

```
行小计 → 会员折扣（银卡 95 折 / 金卡 9 折）→ 优惠券（满减 / 折扣 / 免邮）
      → 满减（满 199-30 / 399-80 / 999-200）→ 积分抵扣（100 积分 = 1 元，单笔 ≤ 30%）
      → 运费（会员包邮 / 满 99 包邮 / 免邮券） = 实付
```

功能全貌见 [`docs/08-商城功能蓝图.md`](docs/08-商城功能蓝图.md)（对标淘宝 / 京东 / 拼多多 / 抖音商城，12 个域 78 项功能）。

### 单端口生产模式

```bash
npm run build      # 构建前端
npm start          # 后端托管 dist，访问 http://localhost:3001
```

### 运行测试

```bash
npm test               # 后端 102 个用例：单元 + 接口集成（18 个 suite）
npm run test:address   # 地址智能识别 + 必填校验回归（29 项断言）
node scripts/smoke.js  # 端到端冒烟 29 项（需服务已启动）
B=http://localhost:3001 node scripts/audit-endpoints.js  # 全接口巡检：97 个路由全覆盖，112 次调用全部 2xx
WEB_BASE=http://localhost:3001 node scripts/e2e-web-deep.js  # PC 逐页深测 66 项（系统 Edge，含失败请求与横向溢出）
BASE=http://localhost:3001 node scripts/e2e-ux.js       # 体验专项 13 项：搜索可解释 / 信息透明 / 退款时间轴 / AI 边界
node scripts/verify-v2.js       # 主干链路 46 项：报价一致 / 券 / 积分 / 秒杀 / 拼团 / 物流 / 评价 / AI 比价算价
node scripts/verify-review-reward.js  # 评价 3.0 共 34 项：图片/视频上传与类型校验 / 返现阶梯 / 余额入账 / 余额抵扣 / 取消回补
node scripts/verify-review-tags.js    # 评价标签 47 项：按类目下发维度与词库 / 分项评分 / 官方与自定义标签 / 聚合计数 / 标签与维度筛选 / 审核 / 改名 / 合并 / 限额
node scripts/e2e-review-media.js      # 浏览器走查 38 项：真实上传图片视频 + 打标签 + 提交到账 + 商品页标签云筛选 + 后台词库
node scripts/verify-flows.js    # 全流程回归 127 项：注册 / 地址 / 购物车勾选 / 取消回补 / 退款双向 / 限购 / 后台 CRUD / AI 三场景 / 越权
node scripts/test-group-timeout.js  # 拼团超时：自动关单 + 已付款自动退款（需等定时任务，约 1 分钟）
node scripts/e2e-flows.js       # 浏览器走查 37 项：C 端 9 页 + B 端 9 页，断言渲染与无 JS 报错
npm run e2e:address            # 浏览器实测 Web 地址表单（需 dev 服务已启动）
npm run e2e:address:mobile     # 浏览器实测移动端 H5 地址表单（需 dev:mobile 已启动）
```

### 环境变量

复制 `.env.example` 即可，全部可选项：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `PORT` | 后端端口 | `3001` |
| `AUTH_SECRET` | JWT 签名密钥 | 首次启动随机生成并写入 `server/data/.auth-secret` |
| `CORS_ORIGINS` | 额外允许的跨域来源（逗号分隔） | localhost 与私有网段之外的来源一律拒绝 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 接入真实大模型 | 未配置则走本地规则引擎 |
| `LOG_REQ` | 打印请求日志 | 关闭 |

> 也可以在后台「AI 配置」页改模型名，保存即生效（`ai_config.model` 优先于 `AI_MODEL`）。

## 接入真实大模型

开箱即用**本地规则引擎**（无需 Key，工具调用与业务操作全部真实执行）。接入真模型只需环境变量：

```bash
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-xxxx
AI_MODEL=gpt-4o-mini
```

兼容任意 OpenAI 协议服务（OpenAI / DeepSeek / 通义 / Moonshot / 本地 vLLM 等）。
配置后重启，界面顶部标识会从「本地引擎模式」变为「已连接大模型」；请求失败会自动降级，不会让对话中断。

## AI 架构

```
用户消息
  └─ Agent Runtime（最多 4 轮工具循环）
       ├─ 远端：gateway → /chat/completions（tool calling）
       └─ 本地：意图分类 → 选工具 → 模板应答
            └─ 工具层（白名单 + 角色校验 + 3s 超时 + 结果截断）
                 search_products · get_product_detail · compare_products
                 quote_order（会员折扣 + 券 + 满减 + 积分，算到分）
                 get_my_orders · get_order_detail
                 check_return_eligibility · create_refund_request · search_kb
                 get_sales_insight · generate_product_copy · update_product_copy
```

设计要点：

- **工具执行真实落库**：AI 客服说"已帮你提交退款"，数据库里就真的有一条 refund 记录，订单状态同步变更。
- **权限内建在工具层**：用户只能查自己的订单；商家工具对普通用户不可见，前端不依赖隐藏按钮做安全。
- **可观测**：每条 AI 回复都带工具轨迹（调用了什么、参数、耗时），C 端可展开查看，B 端可集中质检。
- **降级透明**：降级不假装，UI 明示当前模式。
- **转人工有去处**：AI 答不了的问题可一键提交人工工单，商家后台「人工工单」页处理并回复，会话列表标记「已转人工」，不再是把用户踢回原地。

## 目录结构

```
ai-mall/
├── docs/                     PRD · 架构 · UI 规范 · 测试报告
├── server/                   Node 22 + Express 风格零依赖 HTTP 层
│   ├── src/
│   │   ├── db/               schema / seed / SQLite 适配（含字段自动迁移）
│   │   ├── services/         业务逻辑（唯一写库处）：orders · addresses · support …
│   │   ├── ai/               gateway · tools · runtime · local-engine · prompts
│   │   ├── lib/              validate（入参校验）· time（ISO 时间）· rate-limit
│   │   ├── routes/           HTTP 路由（含静态托管与安全头）
│   │   └── middleware/       鉴权
│   └── test/                 102 个用例（单元 + 接口集成）
├── web/                      Vue3 + TS + Vite + Pinia
│   └── src/
│       ├── pages/shop/       首页 · 列表 · 详情 · 购物车 · 确认订单 · 订单 · 领券中心 · 逛逛 · 我的
│       ├── pages/admin/      看板 · 商品 · 订单 · 退款 · 营销 · 评价 · 评价标签 · 内容 · AI 会话 · 人工工单 · 智能体 · 配置
│       ├── components/       ShopLayout · AiAssistant · ProductCard
│       ├── utils/format.ts   时间本地化
│       └── styles/tokens.css 设计 Token
├── mobile/                   uni-app 多端（H5 / 微信小程序 / 支付宝小程序）
│   └── src/
│       ├── pages/            首页 · 分类 · 详情 · 全部评价 · 购物车 · 确认订单 · 订单 · 促销 · 逛逛 · 我的 · 我的资产 · 登录 · AI 助手
│       ├── components/       ProductCard · AddressForm
│       └── api/              uni.request 封装，条件编译区分 H5 / 小程序 BASE_URL
└── scripts/                  dev.js（一键启动） · smoke.js · verify-v2.js / verify-flows.js / verify-review-reward.js / test-group-timeout.js · e2e.js / e2e-mobile.js / e2e-flows.js
```

## 多端（App / 微信小程序 / 支付宝小程序）

`mobile/` 是一套代码编译到 H5、微信小程序、支付宝小程序的 uni-app 工程（Vue3 + TS + Pinia），复用同一个后端 API。

```bash
# 1. 启动后端（已绑定 0.0.0.0，手机需与电脑连同一 WiFi）
npm run dev:server

# 2a. H5 端 —— 手机浏览器直接访问终端打印的局域网地址
npm run dev:mobile            # http://<局域网IP>:5180

# 2b. 微信小程序（开发模式，改代码自动重建）
npm run dev:mp-weixin         # 产物 mobile/dist/dev/mp-weixin，用微信开发者工具导入

# 2c. 支付宝小程序（开发模式，改代码自动重建）
npm run dev:mp-alipay         # 产物 mobile/dist/dev/mp-alipay，用支付宝小程序开发者工具导入

# 发布/预览（压缩版产物，路径把 dev 换成 build）
npm run build:mp-weixin       # → mobile/dist/build/mp-weixin
npm run build:mp-alipay       # → mobile/dist/build/mp-alipay
```

### 启动命令速查

| 端 | 开发模式（热更新，日常用这个） | 构建产物（发布/预览） | 打开方式 |
| --- | --- | --- | --- |
| H5 / 手机浏览器 | `npm run dev:mobile` → `http://<局域网IP>:5180` | `npm run build:h5` | 浏览器直接访问 |
| 微信小程序 | `npm run dev:mp-weixin` → 导入 `mobile/dist/dev/mp-weixin` | `npm run build:mp-weixin` → 导入 `mobile/dist/build/mp-weixin` | 微信开发者工具「导入项目」 |
| 支付宝小程序 | `npm run dev:mp-alipay` → 导入 `mobile/dist/dev/mp-alipay` | `npm run build:mp-alipay` → 导入 `mobile/dist/build/mp-alipay` | 支付宝小程序开发者工具「导入项目」 |

> 小程序端**不能**用 `npm xxx` 直接跑起来，`npm run dev:mp-*` 只负责把源码编译成小程序代码并持续监听；真正运行要在对应开发者工具里导入 `dist/dev/mp-*` 目录，工具内点「编译」即可。
> 导入时选的是 **`dist/dev/...` 目录**，不是 `mobile/` 源码目录，也不是项目根目录。

必做设置：

- **AppID（已配置）**：`mobile/src/manifest.json` 中 `mp-weixin.appid` = `wx4025339f9923f1a0`、`mp-alipay.appid` = `2021007110685043`。改动请只改这份源文件后重新编译（`npm run build:mp-*`），不要直接改 `dist/` 里的产物配置，否则会被下次构建覆盖。
  - 微信开发者工具导入根目录时读取 `project.config.json`，支付宝开发者工具导入根目录时读取 `mini.project.json`，两者也已写入对应 AppID。
  - 若使用其他主体的 AppID，需同时同步这三处（manifest + 两个工具配置文件）。
  - 注意 `manifest.json` 顶层的 `appid` 是 **DCloud AppID**（用于 uni-app 云打包/发行），与微信、支付宝的 AppID 不是一回事，保持为空不影响小程序运行。
- **不校验合法域名**：小程序直连 `http://192.168.110.33:3001/api`，开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名…」。
- **后端必须先跑**：`npm run dev:server`（3001 端口），否则小程序首页空白、请求全部失败。

说明：

- 小程序端直连后端：地址由 `mobile/vite.config.ts` **编译时自动探测本机局域网 IP** 注入（构建日志会打印 `[api] 小程序端接口地址 → ...`），换 WiFi / 换 IP 只要重新编译即可，不用改代码。
  - 后端在另一台机器或端口不是 3001 时，用环境变量指定：`API_PORT=8080` 或 `VITE_API_BASE_URL=http://10.0.0.5:3001/api npm run dev:mp-weixin`
  - 开发时需在开发者工具勾选 **"不校验合法域名"**；上线前改为 HTTPS 域名并在小程序后台配置合法域名。
- H5 端走同源 `/api`，由 vite 代理转发到 3001 端口，无需关心跨域。
- 移动端复刻了 Web 端的核心能力：确认订单（地址簿选择/新建）、AI 导购（含商品推荐）、AI 客服（查订单 / 退货资格 / 发起退款 / 转人工）、工具调用轨迹展开、消息满意度评价。
- 移动端同样接入了本轮新增的商城能力：SKU 规格选择、收藏（降价提示）、领券中心 / 秒杀 / 拼团、结算页选券与积分抵扣（服务端报价）、按店铺分组的购物车、物流轨迹、评价（星级 + 分项评分 + 印象标签 + 拍照/录像 + 实时返现提示 + 匿名）、逛逛内容流、券包 / 收藏 / 足迹 / 拼团记录（「我的资产」）。
- 三端产物均已构建验证：`npm run build:h5` / `build:mp-weixin` / `build:mp-alipay`。
- 移动端验收：`node scripts/e2e-mobile.js`（14 项检查，iPhone 视口，截图输出到 `docs/screenshots/mobile/`）。

## 安全与工程基线

本轮已补齐的"能自己兜住"的部分（详细修复清单见 `docs/07-项目不足诊断报告.md` 第八节）：

| 项 | 做法 |
| --- | --- |
| 静态资源路径穿越 | `path.resolve` + 前缀校验，只有无扩展名路由才回退 `index.html`；静态改流式读取 + 缓存头 |
| JWT 密钥 | `AUTH_SECRET` → `data/.auth-secret`（首次启动随机生成，0600）→ 临时密钥，不再有硬编码默认值 |
| 限流 | 登录 60/min、AI 60/min、写操作 120/min，超限 429 |
| 入参校验 | `int/str/oneOf/pageParams` 统一校验，非法参数回 400，不再把 SQLite 错误抛给前端 |
| 错误脱敏 | 5xx 对外统一 `INTERNAL`，细节只进服务端日志 |
| CORS | 白名单（localhost / 私有网段 / `CORS_ORIGINS`），陌生 Origin 不回 CORS 头 |
| 响应头 | `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` |
| 越权 | AI 评分校验消息归属；会话归属收紧（游客不能续写他人会话）；商家接口统一 `requireMerchant` |
| 工程 | `.gitignore`、`.env.example`、102 个后端用例覆盖上述行为 |

## 技术决策

| 决策 | 理由 |
| --- | --- |
| Node 内置 `node:sqlite` | 零外部依赖，克隆即跑；已做 `better-sqlite3` 回退适配 |
| 自建极简路由 | 只用到 path 匹配与 JSON 解析，引入 Express 收益低 |
| scrypt 而非 bcrypt | Node 内置，免原生编译，安全强度足够 |
| 单仓 monorepo | B/C 端共享类型与设计 Token，避免接口漂移 |
| 工具白名单 + 场景隔离 | 防止模型"越权调工具"，比 prompt 约束可靠 |

## 体验设计：把"说不清"的地方说清

针对电商用户反馈最集中的六类痛点（详见 `docs/06-体验痛点分析与改进方案.md`），本系统做了四项针对性设计：

| 痛点 | 具体做法 | 在哪看 |
| --- | --- | --- |
| 搜索结果不可解释 | 每条结果附 `matchReasons`：标题命中 / 标签匹配 / 类目归属 / 预算判断，前端显示为彩色标签 | 列表页 `?q=` 搜索 |
| 搜不到就是死路 | 零结果返回可点击的放宽建议（去价格、换短词、找 AI），而不是空页面 | 列表页空状态 |
| 商品信息不透明 | 规格实测表、库存分档（充足/紧张/仅剩 N 件）、价格构成明细、品类退换政策前置 | 商品详情页 |
| 退款进度黑箱 | 三步时间轴：谁在处理、当前卡在哪、还要多久、下一步做什么；驳回也保留记录 | 订单详情页 |
| 客服绕圈不办事 | 入口即展示"我能直接办的事 / 我办不了的事"，回复中区分"已提交"与"仅解答" | AI 助手抽屉 |
| 收货信息填写繁琐 | 整段粘贴自动拆出姓名/电话/省市区/详址（智能识别）；省/市/区三级级联（内置 34 省 349 市 3116 区）；必填项红字即时校验，Web 与移动端同一套规则 | 确认订单页 |

设计原则一句话：**能确定的事直接给结论，不确定的事给下一步，办不到的事提前说。**

## 已知限制

- 支付为**模拟支付**：下单只生成「待付款」，需在订单详情页手动点「模拟支付」才会进入「待发货」；未接真实支付渠道（无商户号 / 回调）
- 物流为**模拟轨迹**：承运商 + 运单号 + 节点推进（揽收 / 运输中 / 派送中 / 已签收），不查真实快递接口
- 小程序未接 `wx.login`（本地无 HTTPS 域名，`code2session` 走不通），仍用邮箱登录
- 未做备案、隐私协议、类目资质、账号注销（上线前必须补，本地演示不涉及）
- 图片使用 emoji 占位，未接入对象存储
- 本地引擎的分词是基于 2-gram 的关键词检索，不是向量检索；接入真模型后语义能力由模型提供
- 单店模型：有 `shops` 店铺表与购物车分组，但未做多商家入驻、结算与分账
- 后台未做角色分层（仅 `merchant` 单一角色）
- 未做发票、售后换货、直播、短视频上传（逛逛内容目前用图标 + 文案）
- 退款、取消等操作已闭环，但**没有操作审计表**，多人协作无法追责
- SQLite 适合单机演示与中小流量，高并发需切换 PostgreSQL

## 常见问题

**问：前端页面能打开，但所有 `/api` 请求都是 500？**

绝大多数情况不是接口挂了，而是 **Vite 代理连不上后端**（后端没启动、或监听的协议族不匹配）。按顺序排查：

```bash
# 1. 后端活着吗？（用 127.0.0.1，不要用 localhost）
curl http://127.0.0.1:3001/api/health
```

- **连不上、`curl` 直接失败** → 后端没跑，或端口被占。`npm run dev:server` 单独起一个看日志；端口占用会有明确提示 `端口 3001 已被占用`。
- **`127.0.0.1` 通、`localhost` 不通** → IPv6/IPv4 不匹配。Node 18+ 把 `localhost` 优先解析成 `::1`，若服务只监听 IPv4（`0.0.0.0`），代理就会 `ECONNREFUSED`，Vite 把它变成 **500**。
  - 本项目已默认**双栈监听**（`http://localhost:3001`、`http://127.0.0.1:3001`、局域网 IP 三者都通），代理目标也固定用 `127.0.0.1`，正常不会再触发。
  - 若你显式设置过 `HOST=0.0.0.0`，就只监听 IPv4 了；需要 `localhost` 也能访问时去掉这个变量。
- **想看真实错误**：浏览器 DevTools → Network 里看 `/api/...` 的 Response，或给后端加 `LOG_REQ=1` 看请求日志；代理层的错误不会出现在后端日志里（请求根本没到后端）。

> 同一类坑也存在于小程序端：`mobile/vite.config.ts` 注入的是编译时探测到的局域网 IP，不使用 `localhost`。
