# 腾讯云 EVO 东京实例上的独立抓取服务

本目录在同一台腾讯云实例运行 tracking 网站和网页抓取器，复用 EVO 已运行的 Docker 网络与 Caddy，不改动 EVO 的数据库或应用服务。实例地址来自 `EVO-App-Platform/deploy/tencent-tokyo`。部署前先确认 SSH 身份、Docker 可用、内存余量，以及实际网络名。Chromium 需要一定内存；若 EVO 的资源余量不足，应先暂停此部署，不得挤占 EVO。

1. 将整个 tracking 仓库检出到独立目录，例如 `/home/evo-deploy/tracking`，固定到已验证的 Git commit。Compose 的 build context 需要项目根目录，不可只复制本目录的 `compose.yaml`。
2. 在 `scraper/tencent/.env` 创建权限为 `0600` 的私有文件，仅写 `SCRAPER_TOKEN=<长随机令牌>`。令牌不能提交 Git 或发到聊天。
3. 从仓库根目录运行 `docker compose --env-file scraper/tencent/.env -f scraper/tencent/compose.yaml up -d --build`，检查 `docker compose ... ps` 与两个容器的日志。抓取器官方镜像已包含 Chromium。
4. 备份现有 `/opt/evo-tokyo/Caddyfile`，将 `Caddyfile.snippet` 的两个独立站点块追加进去；先在 Caddy 容器中 validate，验证通过后 reload。不要覆盖现有 EVO 站点块及 Basic Auth 配置。失败时恢复备份并 reload。
5. 分别验证 `https://tracking.43.167.252.197.sslip.io/health` 和 `https://scraper.43.167.252.197.sslip.io/health`，并使用带令牌的 `POST /v1/track` 验证真实运单。只将令牌放在服务器和 Sites 服务端环境变量中。tracking 网站的 `/api/config` 应显示抓取服务已启用。
6. 如果还要保留 Sites 网站作为第二入口，在 Sites 设置 `SCRAPER_BASE_URL=https://scraper.43.167.252.197.sslip.io` 及相同的 `SCRAPER_TOKEN`，重新部署已保存的网站版本。

抓取项目对网页改版及网站验证敏感；`1Z1B0D750317229126` 的普通 HTTP 抓取已遇到验证拦截，Chromium 方式是否能取得轨迹必须在实际服务器上测试。此服务不使用 Railway，不依赖物流商 API 密钥。`SCRAPER_TOKEN` 保护抓取器公网查询接口；tracking 网站另有每 IP 每分钟 30 次、同时 4 次的查询上限。两个 `/health` 可公开，但不会返回轨迹或令牌。
