# 物流综合轨迹展示

原生 HTML / CSS / JavaScript 界面，Vinext + Cloudflare Workers 服务端。

## 当前接入状态

- 众乐国际：可用，保留浏览器直接访问公开跨域接口的方式。
- Ship24 全球物流：接口代码完成，待配置有效 API 密钥。未配置时显示“全球查询待启用”，不返回虚构轨迹。
- 启用后从 Ship24 动态加载完整承运商目录，排除下线渠道，并提示各渠道必填信息。实际覆盖和权限以账号返回的目录为准。
- 聚合接口的请求、转换和异常处理已用测试响应验证；真实 UPS、FedEx、DHL 等 API 查询需配置账号后验收。官网跳转入口不等于实时数据接入成功。

## 本地运行

需要 Node.js >= 22.13，推荐 Node 24。

```sh
npm run install:ci
npm run dev
```

打开终端打印的地址。生产构建与本地预览：

```sh
npm run build
npm start
```

构建后的默认预览地址为 http://127.0.0.1:8787 。支持 `/?numbers=BG2608182036`。

运行 `npm test` 检查输入、接口合约、数据转换与错误处理；`npm run check` 检查页面脚本语法。测试不发起付费查询。

## 启用 Ship24

1. 在 [Ship24 后台](https://dashboard.ship24.com/)注册账号，选择 **Tracking API & Webhook / Per-shipment** 套餐。本版不是 Per-call 接口。免费试用额度与费用以服务商最新页面为准。
2. 从后台 Integrations / API Keys 获取密钥。
3. 本地：在根目录新建 `.dev.vars`，参考 `.env.example` 设置 `SHIP24_API_KEY`。该文件已被 Git 忽略。
4. 线上：通过 Sites 的服务端环境变量设置 `SHIP24_API_KEY`，不要写入浏览器代码、GitHub 或聊天内容。可设置 `SHIP24_ENABLED=false` 暂停聚合查询。
5. 在页面“接入设置”重新检查连接，载入承运商目录后用真实单号验收。

`/api/config` 只返回配置状态，不返回密钥。当前网站使用 Sites 私有账号访问边界。若另行部署成公开网站，需要先增加身份授权和额度控制。

## 功能

- 最多 20 个运单批量查询，自动去重，支持中文/英文逗号、分号和换行。
- 自动模式：BG 系统单号查众乐，其他单号查 Ship24。众乐客户单号或转单号可手动选择“仅众乐国际”。顺序请求，间隔 1 秒；支持取消、刷新及单票重试。
- Ship24 使用 `/public/v1/trackers/track`，首次查询可能需约 1 分钟。相同参数幂等，修改承运商、目的地、发货日期等参数可能创建新追踪并消耗额度。
- 可补充承运商、目的国家代码、邮编和发货日期；本批全部单号使用同一组条件。同号多票时要求补充条件，不合并不相关轨迹。
- 展示系统单号、客户单号、转单号、承运商、目的国家、邮编、件数和全部轨迹。
- 状态筛选、轨迹展开/收起、正反排序、轨迹关键词搜索。
- 复制单号、复制单票查询链接、导出全部成功结果及完整轨迹为 UTF-8 BOM CSV。
- 支持 `?numbers=单号1,单号2` 和原站形式 `#/tracking?numbers=单号`。
- 响应式桌面/手机布局；本站不建运单数据库。Ship24 会保存并维护创建的追踪，单号和查询条件会提交给所选数据源。
- 默认轨迹正文增大至 16px；页面顶部提供标准、大、特大、超大四档字号（16 / 18 / 20 / 22px），仅在本机保存字号偏好。
- 众乐没有返回记录时，明确提示数据源范围；符合 UPS 1Z 格式的单号提供预填单号的 UPS 官网入口。此入口不代表已接入 UPS API，也不会将一次网页核验结果写死为实时状态。

## 数据来源与限制

接口：`https://gzzlgj.nextsls.com/tracking/app?inajax=1&tracking_number=...`

众乐字段转换位于 `public/tracking.js`，Ship24 服务端逻辑位于 `lib/tracking-service.mjs`。页面结构在 `app/site.html`，交互和样式在 `public/`。`app/api/` 提供配置状态、承运商目录和聚合查询接口。

众乐仍由用户浏览器直接查询，使用 `credentials: omit` 和 `referrerPolicy: no-referrer`。Ship24 密钥仅用于服务端请求，不发送到客户端。

原站配置要求 `sleepTime: 1000`；本实现按此设置顺序查询。该公开接口没有提供稳定性保证或正式 API 协议；如果原站调整字段、跨域设置或身份验证，需要更新接入方式。不会将接口失败伪装成无结果或演示数据。

时间按数据源原样显示，不猜测时区。Ship24 提供的时区偏移和轨迹顺序会保留。顶部状态卡只统计本次查询。

部分渠道要求承运商账号、收件人电话等额外信息。本版不采集这些字段，遇到此类渠道需另行配置支持，不能保证所有渠道所有包裹均可查询。

新版需要 Worker 服务端，不能只上传静态文件。`npm run build` 生成部署产物；`.openai/hosting.json` 保留 Sites 绑定，不含密钥。单号保留在页面 URL 中，额外查询条件不会写入分享链接。

参考：[Ship24 接入文档](https://docs.ship24.com/getting-started)、[Trackers](https://docs.ship24.com/trackers)、[承运商目录](https://docs.ship24.com/couriers)。
