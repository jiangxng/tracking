#!/usr/bin/env bash
set -euo pipefail

# Run as the existing evo-deploy account with a verified tracking commit SHA.
sha="${1:-}"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Provide the verified 40-character tracking Git commit SHA.' >&2
  exit 2
fi
if [[ "$(id -un)" != evo-deploy ]]; then
  echo 'Run as the existing evo-deploy account, which owns the Caddyfile and Docker deployment.' >&2
  exit 2
fi

root=/home/evo-deploy/tracking
release="$root/releases/$sha"
evo_compose=/opt/evo-tokyo/compose.yaml
evo_env=/opt/evo-tokyo/.env
caddyfile=/opt/evo-tokyo/Caddyfile
network=evo-tokyo-dev_internal
for tool in git docker curl openssl awk df; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
test -f "$evo_compose" && test -f "$evo_env" && test -f "$caddyfile" || { echo 'EVO deployment files are missing.' >&2; exit 1; }
docker info >/dev/null
docker compose version >/dev/null
docker network inspect "$network" >/dev/null
available_kib="$(awk '/MemAvailable:/ { print $2 }' /proc/meminfo)"
free_kib="$(df -Pk /var/lib/docker | awk 'NR==2 { print $4 }')"
if (( available_kib < 1200000 || free_kib < 4000000 )); then
  echo "Insufficient capacity for Chromium: available RAM ${available_kib} KiB, Docker disk ${free_kib} KiB." >&2
  exit 1
fi

caddy_id="$(docker compose --env-file "$evo_env" -f "$evo_compose" ps -q caddy)"
test -n "$caddy_id" && test "$(docker inspect -f '{{.State.Running}}' "$caddy_id")" = true || { echo 'EVO Caddy is not running.' >&2; exit 1; }

mkdir -p "$root/releases"
if [[ ! -d "$release" ]]; then
  git clone --quiet https://github.com/jiangxng/tracking.git "$release"
  git -C "$release" checkout --quiet --detach "$sha"
fi
test "$(git -C "$release" rev-parse HEAD)" = "$sha" || { echo 'Tracking source SHA mismatch.' >&2; exit 1; }

if [[ ! -f "$root/.env" ]]; then
  umask 077
  printf 'SCRAPER_TOKEN=%s\n' "$(openssl rand -hex 32)" > "$root/.env"
fi
chmod 0600 "$root/.env"
compose="$release/scraper/tencent/compose.yaml"
snippet="$release/scraper/tencent/Caddyfile.snippet"
docker compose --env-file "$root/.env" -f "$compose" config --quiet
docker compose --env-file "$root/.env" -f "$compose" up -d --build
docker compose --env-file "$root/.env" -f "$compose" ps

tracking_present=0
scraper_present=0
grep -Fq 'tracking.43.167.252.197.sslip.io {' "$caddyfile" && tracking_present=1
grep -Fq 'scraper.43.167.252.197.sslip.io {' "$caddyfile" && scraper_present=1
if (( tracking_present != scraper_present )); then
  echo 'Only one tracking Caddy site exists; inspect the existing Caddyfile before continuing.' >&2
  exit 1
fi
if (( tracking_present == 0 )); then
  backup="$caddyfile.tracking-backup.$(date +%Y%m%d%H%M%S)"
  cp -p "$caddyfile" "$backup"
  printf '\n' >> "$caddyfile"
  cat "$snippet" >> "$caddyfile"
  if ! docker exec "$caddy_id" caddy validate --config /etc/caddy/Caddyfile || ! docker exec "$caddy_id" caddy reload --config /etc/caddy/Caddyfile; then
    cat "$backup" > "$caddyfile"
    docker exec "$caddy_id" caddy reload --config /etc/caddy/Caddyfile || true
    echo 'Caddy rejected the tracking sites; original configuration restored.' >&2
    exit 1
  fi
fi

curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 3 --max-time 10 \
  https://tracking.43.167.252.197.sslip.io/health
echo
curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 3 --max-time 10 \
  https://scraper.43.167.252.197.sslip.io/health
echo
echo "TRACKING_DEPLOYED sha=$sha"
