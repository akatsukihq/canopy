#!/usr/bin/env bash
# Idempotent provisioning for the Canopy Piston VM (Ubuntu 24.04 / Debian; arm64, cgroup v2).
#
#   sudo ./provision.sh                        # pulls ghcr.io/akatsukihq/canopy-piston:latest
#   sudo ./provision.sh de2b365-20261102       # a dated tag (rollback), or sha256:<64 hex> to pin by digest
#   (same via PISTON_IMAGE=... env)
#
# Optional env: PISTON_LISTEN_IP (default: first private IPv4), PISTON_LISTEN_PORT (8080),
#   PISTON_ENV_FILE (/etc/canopy/piston.env, root-only, holds PISTON_API_TOKEN),
#   PISTON_REQUIRED_LANGUAGES (space-separated Piston names/aliases that must be listed),
#   PISTON_LIMIT_OVERRIDES (JSON, only if measured as necessary),
#   CONTAINER_MEMORY (8g), CONTAINER_CPUS (75% of host cores, e.g. 1.5 on 2 cores).
# Re-running replaces the container and rewrites the Caddy config; it never prints the token.
set -euo pipefail

IMAGE_REPO=ghcr.io/akatsukihq/canopy-piston
NAME=canopy-piston
ENV_FILE=${PISTON_ENV_FILE:-/etc/canopy/piston.env}
PORT=${PISTON_LISTEN_PORT:-8080}
# One name (or alias) per registry language; csharp is served by the mono package.
REQUIRED=${PISTON_REQUIRED_LANGUAGES:-"python javascript typescript java c c++ csharp go rust php ruby kotlin bash"}
REF=${1:-${PISTON_IMAGE:-latest}}

die() { echo "error: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"
[[ $REF =~ ^(sha256:[0-9a-f]{64}|[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$ ]] || die "invalid image tag or digest: $REF"

# --- preflight -------------------------------------------------------------------------
[[ $(uname -m) =~ ^(aarch64|arm64)$ ]] || die "this image is arm64 only (no x86 fallback)"
[[ $(stat -fc %T /sys/fs/cgroup) == cgroup2fs ]] || die "cgroup v2 required (pure v2, not hybrid)"
[[ ! -e /sys/fs/cgroup/unified ]] || die "hybrid cgroup v1+v2 is not supported by Piston"
command -v apt-get >/dev/null || die "apt-based distro expected (Ubuntu 24.04 / Debian)"

export DEBIAN_FRONTEND=noninteractive
need=()
command -v docker >/dev/null || need+=(docker.io)
command -v caddy >/dev/null || need+=(caddy)
command -v jq >/dev/null || need+=(jq)
command -v curl >/dev/null || need+=(curl)
command -v openssl >/dev/null || need+=(openssl)
if ((${#need[@]})); then
  apt-get update -qq
  apt-get install -y --no-install-recommends "${need[@]}"
fi
systemctl enable --now docker >/dev/null

# --- listen address (private IP only, never 0.0.0.0) -------------------------------------
IP=${PISTON_LISTEN_IP:-$(hostname -I | tr ' ' '\n' | grep -E '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)' | head -1)}
[[ $IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "no private IPv4 found; set PISTON_LISTEN_IP"

# --- token file (root-only; created once, rotated by editing it and re-running) ------------
install -d -m 0750 -o root -g root "$(dirname "$ENV_FILE")"
if [[ ! -s $ENV_FILE ]]; then
  (umask 077; printf 'PISTON_API_TOKEN=%s\n' "$(openssl rand -hex 32)" > "$ENV_FILE")
  echo "created $ENV_FILE (root-only). Read the token with: sudo grep PISTON_API_TOKEN $ENV_FILE"
fi
chown root:root "$ENV_FILE"; chmod 0600 "$ENV_FILE"
grep -qE '^PISTON_API_TOKEN=.{32,}$' "$ENV_FILE" || die "$ENV_FILE needs PISTON_API_TOKEN of at least 32 chars"

# --- Piston container ----------------------------------------------------------------------
if [[ $REF == sha256:* ]]; then IMAGE="$IMAGE_REPO@$REF"; else IMAGE="$IMAGE_REPO:$REF"; fi
docker pull "$IMAGE"
docker rm -f "$NAME" >/dev/null 2>&1 || true
env_args=(
  -e PISTON_DISABLE_NETWORKING=true
  -e PISTON_RUN_TIMEOUT=5000 -e PISTON_RUN_CPU_TIME=3000
  -e PISTON_COMPILE_TIMEOUT=15000 -e PISTON_COMPILE_CPU_TIME=10000
  -e PISTON_RUN_MEMORY_LIMIT=268435456 -e PISTON_COMPILE_MEMORY_LIMIT=536870912
  -e PISTON_MAX_PROCESS_COUNT=64
  -e PISTON_OUTPUT_MAX_SIZE=65536
  -e PISTON_MAX_FILE_SIZE=10000000
  -e "PISTON_MAX_CONCURRENT_JOBS=$(($(nproc) * 2))"
  -e PISTON_REPO_URL=http://127.0.0.1:1/index   # packages are baked in; make runtime installs impossible
)
[[ -z ${PISTON_LIMIT_OVERRIDES:-} ]] || env_args+=(-e "PISTON_LIMIT_OVERRIDES=$PISTON_LIMIT_OVERRIDES")
# No -v on /piston: a volume would hide the baked-in packages.
# Containers must not reach the cloud metadata service (instance credentials/identity).
iptables -C DOCKER-USER -d 169.254.169.254 -j DROP 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254 -j DROP

# Container-level caps so a fork storm or memory balloon cannot starve the host (Isolate limits are per job).
docker run -d --name "$NAME" --privileged --restart unless-stopped \
  --memory "${CONTAINER_MEMORY:-8g}" --memory-swap "${CONTAINER_MEMORY:-8g}" --pids-limit 4096 \
  --cpus "${CONTAINER_CPUS:-$(awk -v n="$(nproc)" 'BEGIN { print n * 0.75 }')}" \
  -p 127.0.0.1:2000:2000 "${env_args[@]}" "$IMAGE" >/dev/null

# --- Caddy: bearer auth, two-endpoint allowlist, 256 KiB body cap ----------------------------
cat > /etc/caddy/Caddyfile <<CADDY
{
	admin off
	auto_https off
}

http://$IP:$PORT {
	bind $IP
	log
	request_body {
		max_size 262144
	}
	@denied {
		not header Authorization "Bearer {env.PISTON_API_TOKEN}"
	}
	@runtimes {
		method GET
		path /api/v2/runtimes
	}
	@execute {
		method POST
		path /api/v2/execute
	}
	route {
		respond @denied "unauthorized" 401
		reverse_proxy @runtimes 127.0.0.1:2000
		reverse_proxy @execute 127.0.0.1:2000
		respond "not found" 404
	}
}
CADDY
chmod 0644 /etc/caddy/Caddyfile
install -d /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=%s\n' "$ENV_FILE" > /etc/systemd/system/caddy.service.d/canopy.conf
systemctl daemon-reload
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl restart caddy

# --- verification ------------------------------------------------------------------------------
TOKEN=$(grep '^PISTON_API_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
BASE=http://$IP:$PORT
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null http://127.0.0.1:2000/api/v2/runtimes 2>/dev/null && break
  sleep 2
done
runtimes=$(curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/v2/runtimes") || die "runtimes request through Caddy failed"
missing=()
for lang in $REQUIRED; do
  jq -e --arg l "$lang" 'any(.[]; .language == $l or (.aliases | index($l)))' <<<"$runtimes" >/dev/null || missing+=("$lang")
done
((${#missing[@]} == 0)) || die "GET /api/v2/runtimes is missing: ${missing[*]}"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() { [[ $2 == "$3" ]] || die "$1: expected HTTP $3, got $2"; }
expect "no token" "$(code "$BASE/api/v2/runtimes")" 401
expect "wrong token" "$(code -H 'Authorization: Bearer wrong' "$BASE/api/v2/runtimes")" 401
expect "packages blocked" "$(code -H "Authorization: Bearer $TOKEN" "$BASE/api/v2/packages")" 404
expect "connect blocked" "$(code -H "Authorization: Bearer $TOKEN" "$BASE/api/v2/connect")" 404
head -c 300000 /dev/zero | tr '\0' 'a' > /tmp/piston-big.$$
expect "body cap" "$(code -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @/tmp/piston-big.$$ "$BASE/api/v2/execute")" 413
rm -f /tmp/piston-big.$$

echo "ok: $IMAGE serving $BASE ($(jq length <<<"$runtimes") runtimes; all of: $REQUIRED)"
