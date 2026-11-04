# 腾讯云 EVO 东京实例上的独立抓取服务

本目录复用 EVO 验证环境已运行的 Docker 网络与 Caddy，不改动 EVO 的数据库或应用服务。实例地址来自 `EVO-App-Platform/deploy/tencent-tokyo`。部署前先确认 SSH 身份、Docker 可用、内存余量，以及实际网络名。

1. 将 `compose.yaml` 复制到腾讯云的独立目录 `/opt/tracking-scraper/compose.yaml`。
2. 在该目录创建权限为 `0600` 的 `.env`，仅写 `SCRAPER_TOKEN=<长随机令牌>`。令牌不能提交 Git 或发到聊天。
3. 在该目录运行 `docker compose up -d`，检查 `docker compose ps` 与 `docker compose logs --tail 50 scraper`。镜像已包含 Chromium。
4. 将 `Caddyfile.snippet` 中的独立站点块加入现有 `/opt/evo-tokyo/Caddyfile`，先运行 `caddy validate`，验证通过后 reload。不要覆盖现有 EVO 站点块及 Basic Auth 配置。
5. 验证 `https://scraper.43.167.252.197.sslip.io/health`，并使用带令牌的 `POST /v1/track` 验证真实运单。只将令牌放在服务器和 Sites 服务端环境变量中。
6. 在 Sites 设置 `SCRAPER_BASE_URL=https://scraper.43.167.252.197.sslip.io` 及相同的 `SCRAPER_TOKEN`，重新部署已保存的网站版本。

抓取项目对网页改版及网站验证敏感；`1Z1B0D750317229126` 的普通 HTTP 抓取已遇到验证拦截，Chromium 方式是否能取得轨迹必须在实际服务器上测试。此服务不使用 Railway，不依赖物流商 API 密钥。`SCRAPER_TOKEN` 保护公网查询接口；Caddy 的 `/health` 可公开，但不会返回轨迹或令牌。
