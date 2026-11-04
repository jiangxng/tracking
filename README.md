# 物流综合轨迹展示

物流轨迹查询界面，原生 HTML / CSS / JavaScript，Vinext + Cloudflare Workers 服务端。支持批量查询、状态筛选、轨迹搜索和 CSV 导出，以及可调整的 16–22px 字号。

## 免费数据源

| 数据源 | 接入方式 | 当前启用条件 |
| --- | --- | --- |
| 众乐国际 | 原站公开查询接口 | 无需密钥；可查其范围内的运单 |
| UPS | [官方 Track API](https://developer.ups.com/api/reference/tracking/product-info) | 符合条件的 UPS 托运人账号，`UPS_CLIENT_ID`、`UPS_CLIENT_SECRET` |
| DHL | [Shipment Tracking Unified API](https://developer.dhl.com/tracking) | 免费开发者账号，`DHL_API_KEY`；默认每天 250 次且每 5 秒最多 1 次 |
| FedEx | [Basic Integrated Visibility](https://www.fedex.com/en-us/digital/premium-features/integrated-visibility.html) | FedEx 账号与项目，`FEDEX_CLIENT_ID`、`FEDEX_CLIENT_SECRET` |
| USPS | [官方 Tracking API](https://developers.usps.com/getting-started) | USPS Business 托运账号与追踪授权，`USPS_CLIENT_ID`、`USPS_CLIENT_SECRET` |
| 更多承运商 | [Karrio 社区版](https://github.com/karrioapi/karrio) | 自行部署、`KARRIO_BASE_URL`、`KARRIO_API_KEY`，并在 Karrio 连接各物流商账号 |

没有可合法稳定地免费查询所有承运商和所有运单的通用接口。开源代码可以减少适配开发，但不会提供物流商数据权限。上述官方接口对特定账号免费，仍有配额和授权范围；未配置时页面会明确提示，不生成模拟轨迹。UPS 单号提供官网核验入口；`1Z1B0D750317229126` 若没有获授权的 UPS 托运账号，无法在本站取得 UPS 实时轨迹。Karrio 本身开源，自托管和物流商账号由使用者负责。USPS 对其托运人提供无费用追踪权限，但有严格访问控制；未经授权的运单可能返回 403。

## 运行与配置

需要 Node.js >= 22.13。执行：

```sh
npm run install:ci
npm run dev
```

在项目根目录创建 `.dev.vars`，参照 `.env.example` 填入自己的凭据。线上将这些值设置为服务端环境变量。不要将密钥放进浏览器代码、聊天或 Git。`/api/config` 仅返回各数据源是否已配置。若在公开站点部署，还应增加访问控制和限流。

```sh
npm test
npm run check
npm run build
npm start
```

本地构建预览默认位于 `http://127.0.0.1:8787`。`npm test` 使用模拟响应，不需要任何物流商账号或付费查询。

## 查询规则

- 自动模式将 `BG` 系统单号交给众乐、`1Z` UPS 格式交给 UPS、10 位数字交给 DHL。其他格式可能重合，会要求手动选择数据源。格式匹配不代表承运商确认。
- 最多 20 个不同单号，按顺序请求。DHL 连续查询至少间隔 5 秒，其他数据源至少间隔 1 秒。支持停止、刷新与单票重试。
- Karrio 使用其 `POST /v1/trackers` 接口，并要求明确输入承运商代码（UPS 格式可自动填 `ups`）。创建的追踪会存储在使用者自己的 Karrio 实例；详情参阅 [Karrio 追踪文档](https://www.karrio.io/docs/products/tracking)。
- 页面保留目的国家、邮编、发货日期等补充字段，但当前免费适配器不向物流商提交它们。对需要额外收件人验证的渠道，须按其官方接口要求继续扩展。
- 页面不建运单数据库。分享链接和浏览器历史中会包含查询单号，轨迹时间按数据源原样显示。众乐公开接口的可用性、字段和跨域设置由原站决定。

服务端适配器位于 `lib/free-tracking-service.mjs`；页面在 `app/site.html` 与 `public/`；`app/api/` 提供配置、承运商目录和查询接口。新增渠道时，在适配器中添加配置状态、授权、请求与标准化转换，再在页面接入设置中说明凭据与权限要求。
