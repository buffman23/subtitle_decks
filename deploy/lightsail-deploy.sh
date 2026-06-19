#!/usr/bin/env bash
# Runs ON the Lightsail instance. Builds the image and (re)starts the container.
#
# Invoked by the GitHub Actions "Deploy" workflow (which first fast-forwards this
# git checkout to the chosen ref), or by hand: `bash deploy/lightsail-deploy.sh`.
#
# Flow: arm the maintenance page in Caddy, stop the app (so the build gets the
# instance's RAM and visitors see a status page), build, restart, wait for
# health, then mark "live" so the status page reloads into the app. A failed
# build trips an ERR trap that restores the previous container (the
# `subtitle-decks` image tag still points at the last good build, since `docker
# build` only reassigns the tag on success). NOTE: this protects against build
# failures; rolling back a build that succeeds but runs unhealthy would need
# image versioning (a registry) — deliberately out of scope for this setup.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_DIR/webapp"
MAINT_SRC="$REPO_DIR/deploy/maintenance"
MAINT_DIR="/var/www/maintenance"
cd "$APP_DIR"

# --- require a deployer-supplied .env (never commit secrets to this script) ---
# Copy webapp/.env.example to webapp/.env on the server and fill in your values
# before running this script. Required vars are documented in deploy/aws-deploy.md.
# Tip: generate a SECRET_KEY with:  openssl rand -hex 32
if [ ! -f .env ]; then
  echo "[deploy] ERROR: $APP_DIR/.env not found." >&2
  echo "[deploy] Create it first (e.g. 'cp .env.example .env' then edit) and re-run." >&2
  exit 1
fi
chmod 600 .env
echo "[deploy] using existing .env"

# --- domain is required (Caddy needs it for the TLS cert) ---
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2- | tr -d "\"'" | xargs || true)
if [ -z "${DOMAIN:-}" ]; then
  echo "[deploy] ERROR: DOMAIN not set in .env (needed for HTTPS)." >&2
  echo "[deploy] Add a line like 'DOMAIN=example.com' to .env and re-run." >&2
  exit 1
fi
echo "[deploy] domain: $DOMAIN"

# --- Cloudflare origin cert is required for the Caddyfile we write below ---
CF_CERT=/etc/caddy/cf-origin.pem
CF_KEY=/etc/caddy/cf-origin.key
if [ ! -s "$CF_CERT" ] || [ ! -s "$CF_KEY" ]; then
  echo "[deploy] ERROR: Cloudflare origin cert/key not found at $CF_CERT / $CF_KEY." >&2
  echo "[deploy] Create an Origin Certificate in Cloudflare, place the two PEMs there, then re-run." >&2
  exit 1
fi

# --- helpers ---------------------------------------------------------------
# Write the deploy status JSON that the maintenance page polls. /var/www is
# root-owned, so write via sudo.
status() {
  local phase="$1"; shift
  local msg="$*"
  printf '{"phase":"%s","msg":"%s","ts":%s}\n' "$phase" "$msg" "$(date +%s)" \
    | sudo tee "$MAINT_DIR/deploy/status.json" >/dev/null
}

start_container() {
  sudo docker rm -f subtitle-decks 2>/dev/null || true
  sudo docker volume create subtitle-decks-data >/dev/null
  # Bind to loopback only — Caddy (on the host) terminates TLS and proxies in.
  # Models are mounted read-only from the persistent volume.
  sudo docker run -d \
    --name subtitle-decks \
    --restart unless-stopped \
    --env-file .env \
    -v subtitle-decks-data:/app/data \
    -v subtitle-decks-models:/opt/camel_tools_data:ro \
    -p 127.0.0.1:8000:8000 \
    subtitle-decks
}

wait_healthy() {
  # Container binds 127.0.0.1:8000 on the host, so curl from the host.
  local i
  for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8000/healthz >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# On any failure after this point, restore service from the last good image and
# flag the status page. Disable the trap inside the handler so it can't re-enter.
restore_previous() {
  trap - ERR
  echo "[deploy] ERROR: deploy failed — restoring previous container" >&2
  if sudo docker image inspect subtitle-decks >/dev/null 2>&1; then
    start_container || true
  fi
  status failed "Update failed — previous version restored"
  exit 1
}

# --- ensure Caddy is installed (host reverse proxy + TLS termination) ------
if ! command -v caddy >/dev/null 2>&1; then
  echo "[deploy] installing Caddy..."
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi

# --- publish the maintenance page + arm Caddy BEFORE we stop the app -------
# Caddy keeps proxying to the app while it's up; the moment the container goes
# down (during the build) `handle_errors` serves the status page automatically.
# The /deploy/* route always serves the status JSON, app up or down.
echo "[deploy] publishing maintenance assets + Caddy config..."
sudo mkdir -p "$MAINT_DIR/deploy"
sudo cp "$MAINT_SRC/index.html" "$MAINT_DIR/index.html"
[ -f "$MAINT_DIR/deploy/status.json" ] || sudo cp "$MAINT_SRC/deploy/status.json" "$MAINT_DIR/deploy/status.json"
sudo chmod -R a+rX "$MAINT_DIR"

# Caddy runs as the 'caddy' user and must read the origin key.
sudo chown root:caddy "$CF_CERT" "$CF_KEY"
sudo chmod 640 "$CF_CERT" "$CF_KEY"

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN, www.$DOMAIN {
    tls $CF_CERT $CF_KEY

    # Deploy status assets — always served by Caddy, app or not.
    handle /deploy/* {
        root * $MAINT_DIR
        file_server
        header Cache-Control "no-store"
    }

    # The app.
    handle {
        reverse_proxy 127.0.0.1:8000
    }

    # Shown automatically whenever the app is unreachable (e.g. during a deploy).
    handle_errors {
        root * $MAINT_DIR
        rewrite * /index.html
        file_server
        header Cache-Control "no-store"
        header Retry-After "20"
    }
}
EOF
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

status starting "Starting deployment…"
trap 'restore_previous' ERR

# --- stop the app to free RAM/CPU for the build ----------------------------
# From here the site shows the maintenance page (Caddy handle_errors above).
echo "[deploy] stopping app container to free resources for the build..."
status building "Building the new version…"
sudo docker rm -f subtitle-decks 2>/dev/null || true

# --- build image -----------------------------------------------------------
echo "[deploy] building image (this downloads PyTorch + deps)..."
sudo docker build -t subtitle-decks .

# --- ensure camel_tools models on a persistent volume (downloaded once) ----
# The image no longer bakes in the ~1.8GB of models. They live on the named
# volume 'subtitle-decks-models' so image rebuilds never re-download them.
# camel_data is idempotent: on later deploys the already-present packages are
# skipped in seconds, so this is safe to run every time.
echo "[deploy] ensuring camel_tools models on volume (one-time ~1.8GB download)..."
status models "Preparing language models…"
sudo docker volume create subtitle-decks-models >/dev/null
sudo docker run --rm --user root \
  -v subtitle-decks-models:/opt/camel_tools_data \
  -e CAMELTOOLS_DATA=/opt/camel_tools_data \
  subtitle-decks \
  sh -c '
    for p in disambig-bert-unfactored-msa disambig-bert-unfactored-egy morphology-db-msa-r13 morphology-db-egy-r13; do
      python -m camel_tools.cli.camel_data -i "$p" || exit 1
    done
  '

# --- (re)start container ---------------------------------------------------
echo "[deploy] starting new container..."
status starting-app "Starting the app…"
start_container

# --- wait for health, then hand traffic back to the app --------------------
echo "[deploy] waiting for /healthz..."
if ! wait_healthy; then
  echo "[deploy] new container did not become healthy in time" >&2
  false  # trip the ERR trap -> restore_previous
fi
status live "Back online"
trap - ERR

echo "[deploy] done. Container status:"
sudo docker ps --filter name=subtitle-decks
echo "[deploy] Caddy status:"
sudo systemctl is-active caddy
