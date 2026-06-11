#!/usr/bin/env bash
# Runs ON the Lightsail instance. Builds the image and (re)starts the container.
set -euo pipefail

APP_DIR="$HOME/subtitle_decks/webapp"
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

# --- build image ---
echo "[deploy] building image (this downloads PyTorch + ~1GB models)..."
sudo docker build -t subtitle-decks .

# --- (re)start container ---
echo "[deploy] (re)starting container..."
sudo docker rm -f subtitle-decks 2>/dev/null || true
sudo docker volume create subtitle-decks-data >/dev/null
# Bind to loopback only — Caddy (on the host) terminates TLS and proxies in.
sudo docker run -d \
  --name subtitle-decks \
  --restart unless-stopped \
  --env-file .env \
  -v subtitle-decks-data:/app/data \
  -p 127.0.0.1:8000:8000 \
  subtitle-decks

# --- ensure Caddy is installed (host reverse proxy + automatic HTTPS) ---
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

# --- Caddy terminates TLS with the Cloudflare Origin Certificate ---
# Cloudflare proxies the site (orange cloud) and connects to this origin over TLS
# in "Full (strict)" mode, validating this cert. Place the PEMs from Cloudflare
# (SSL/TLS -> Origin Server -> Create Certificate) at the paths below.
CF_CERT=/etc/caddy/cf-origin.pem
CF_KEY=/etc/caddy/cf-origin.key
if [ ! -s "$CF_CERT" ] || [ ! -s "$CF_KEY" ]; then
  echo "[deploy] ERROR: Cloudflare origin cert/key not found at $CF_CERT / $CF_KEY." >&2
  echo "[deploy] Create an Origin Certificate in Cloudflare, place the two PEMs there, then re-run." >&2
  exit 1
fi
# Caddy runs as the 'caddy' user and must read the key.
sudo chown root:caddy "$CF_CERT" "$CF_KEY"
sudo chmod 640 "$CF_CERT" "$CF_KEY"

echo "[deploy] configuring Caddy for $DOMAIN (Cloudflare origin cert)..."
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN, www.$DOMAIN {
    tls $CF_CERT $CF_KEY
    reverse_proxy 127.0.0.1:8000
}
EOF
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

echo "[deploy] done. Container status:"
sudo docker ps --filter name=subtitle-decks
echo "[deploy] Caddy status:"
sudo systemctl is-active caddy
