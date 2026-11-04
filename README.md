# 物流综合轨迹展示

物流轨迹查询界面，原生 HTML / CSS / JavaScript，Vinext + Cloudflare Workers 服务端。支持批量查询、状态筛选、轨迹搜索和 CSV 导出，以及可调整的 16–22px 字号。

## 免费数据源

| 数据源 | 接入方式 | 当前启用条件 |
| --- | --- | --- |
| 众乐国际 | 原站公开查询接口 | 无需密钥；可查其范围内的运单 |
| 网页抓取 | [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper)，Apache-2.0 | 无需物流商密钥；需运行独立抓取服务，设置 `SCRAPER_BASE_URL`、`SCRAPER_TOKEN` |
| UPS | [官方 Track API](https://developer.ups.com/api/reference/tracking/product-info) | 符合条件的 UPS 托运人账号，`UPS_CLIENT_ID`、`UPS_CLIENT_SECRET` |
| DHL | [Shipment Tracking Unified API](https://developer.dhl.com/tracking) | 免费开发者账号，`DHL_API_KEY`；默认每天 250 次且每 5 秒最多 1 次 |
| FedEx | [Basic Integrated Visibility](https://www.fedex.com/en-us/digital/premium-features/integrated-visibility.html) | FedEx 账号与项目，`FEDEX_CLIENT_ID`、`FEDEX_CLIENT_SECRET` |
| USPS | [官方 Tracking API](https://developers.usps.com/getting-started) | USPS Business 托运账号与追踪授权，`USPS_CLIENT_ID`、`USPS_CLIENT_SECRET` |
| 更多承运商 | [Karrio 社区版](https://github.com/karrioapi/karrio) | 自行部署、`KARRIO_BASE_URL`、`KARRIO_API_KEY`，并在 Karrio 连接各物流商账号 |

网页抓取项目通过访问物流商公开页面获取轨迹，无需各物流商 API 密钥，但仍需要一台能运行 Node.js/Chromium 的主机。物流商可能更改网页或拦截自动化访问，不能保证所有运单可查。我们实际用 `1Z1B0D750317229126` 测试普通 HTTP 抓取时收到网站验证拦截；项目的 Chromium 抓取尚需在运行服务的主机上验证。未取得轨迹时页面显示失败原因，不生成模拟结果。官方接口对特定账号免费，仍有配额和授权范围。Karrio 自托管和物流商账号由使用者负责。

## 运行与配置

需要 Node.js >= 22.13。执行：

```sh
npm run install:ci
npm run dev
```

在项目根目录创建 `.dev.vars`，参照 `.env.example` 填入自己的凭据。线上将这些值设置为服务端环境变量。不要将密钥放进浏览器代码、聊天或 Git。`/api/config` 仅返回各数据源是否已配置。若在公开站点部署，还应增加访问控制和限流。抓取服务必须以 HTTPS 对当前网站的 Worker 可达，不能将线上 `SCRAPER_BASE_URL` 设置为你电脑的 `localhost`。

### 运行开源抓取服务

项目版本固定为 `universal-parcel-scraper@0.637.1`。本机可通过 `npm install -g universal-parcel-scraper@0.637.1` 后执行 `parcel-scraper serve --host 127.0.0.1 --port 8080`；启用浏览器抓取需 Chromium 及项目文档所列的可选依赖。也可使用 [官方 Docker 镜像](https://github.com/plhery/universal-parcel-scraper/pkgs/container/universal-parcel-scraper)（包含 Chromium），本仓库提供 [Docker Compose 示例](scraper/docker-compose.yml)。要供线上网站查询，应将抓取服务部署到自己控制的 HTTPS 主机，并设置长随机 `SCRAPER_TOKEN`；站点服务端配置相同的令牌。抓取服务自带缓存、限流和并发上限，站点不会把令牌发送给浏览器。

腾讯云实例可同时部署 tracking 网站与抓取器，复用现有 Caddy 和 Docker 网络；步骤见 [腾讯云部署说明](scraper/tencent/README.md)。独立 Node 服务的入口为 `server/node-server.mjs`，不用 Sites 或物流商收费 API 才能运行。部署前应先确认实例剩余内存足够运行 Chromium。

```sh
npm test
npm run check
npm run build
npm start
```

本地构建预览默认位于 `http://127.0.0.1:8787`。`npm test` 使用模拟响应，不需要任何物流商账号或付费查询。

## 查询规则

- 自动模式将 `BG` 系统单号交给众乐；其余单号优先走已配置的网页抓取服务。若抓取被拦截或查无记录，并且单号明确匹配 UPS 或 DHL、且相应官方账号已配置，再尝试官方接口。未配置抓取时保持原有格式路由。其他格式可能重合，会要求手动选择数据源。格式匹配不代表承运商确认。
- 最多 20 个不同单号，按顺序请求。DHL 连续查询至少间隔 5 秒，其他数据源至少间隔 1 秒。支持停止、刷新与单票重试。
- Karrio 使用其 `POST /v1/trackers` 接口，并要求明确输入承运商代码（UPS 格式可自动填 `ups`）。创建的追踪会存储在使用者自己的 Karrio 实例；详情参阅 [Karrio 追踪文档](https://www.karrio.io/docs/products/tracking)。
- 网页抓取可填写承运商代码和目的地邮编。目的国家与发货日期字段仍保留，但当前适配器不提交它们。对需要额外收件人验证的渠道，须按其查询方式继续扩展。
- 页面不建运单数据库。分享链接和浏览器历史中会包含查询单号，轨迹时间按数据源原样显示。众乐公开接口的可用性、字段和跨域设置由原站决定。

服务端适配器位于 `lib/free-tracking-service.mjs`；页面在 `app/site.html` 与 `public/`；`app/api/` 提供配置、承运商目录和查询接口。新增渠道时，在适配器中添加配置状态、授权、请求与标准化转换，再在页面接入设置中说明凭据与权限要求。
