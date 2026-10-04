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

# Reap leftover containers from our image that aren't the app. The model-download
# steps below run foreground `docker run` containers; if a deploy's SSH session
# drops mid-download, the docker CLI dies but dockerd keeps the container running
# (an orphan). It keeps writing to the model volumes and can corrupt a later
# deploy's download (this actually happened — a stuck full-package stanza download
# left a half-written es model). Match on Config.Image so it still catches orphans
# after a rebuild retags 'subtitle-decks'; never touch the app (named subtitle-decks).
reap_orphans() {
  local id img name
  for id in $(sudo docker ps -aq 2>/dev/null); do
    img=$(sudo docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null || echo)
    name=$(sudo docker inspect -f '{{.Name}}' "$id" 2>/dev/null || echo)
    if [ "$img" = "subtitle-decks" ] && [ "$name" != "/subtitle-decks" ]; then
      echo "[deploy] reaping orphan container $name ($id)"
      sudo docker rm -f "$id" >/dev/null 2>&1 || true
    fi
  done
}

start_container() {
  reap_orphans
  sudo docker rm -f subtitle-decks 2>/dev/null || true
  sudo docker volume create subtitle-decks-data >/dev/null
  sudo docker volume create subtitle-decks-stanza >/dev/null
  # Bind to loopback only — Caddy (on the host) terminates TLS and proxies in.
  # Models are mounted read-only from the persistent volume.
  sudo docker run -d \
    --name subtitle-decks \
    --restart unless-stopped \
    --env-file .env \
    -v subtitle-decks-data:/app/data \
    -v subtitle-decks-models:/opt/camel_tools_data:ro \
    -v subtitle-decks-unidic:/opt/unidic_data:ro \
    -v subtitle-decks-stanza:/opt/stanza_data:ro \
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
# Reap any orphans from a prior interrupted deploy BEFORE the model-download steps,
# so a stuck download container can't write to the model volumes alongside ours.
reap_orphans
sudo docker rm -f subtitle-decks 2>/dev/null || true

# --- compute build version (baked into the image for the admin page) -------
# VERSION holds "MAJOR.MINOR <baseline-commit-or-tag>"; the patch is the number
# of commits since that baseline, so the admin page shows a number that rises per
# commit and drops on a rollback. The container has no .git, so we resolve it here.
read -r BASE BASELINE < VERSION || BASE=0.0
BASE="${BASE:-0.0}"
if [ -n "${BASELINE:-}" ]; then
  PATCH="$(git rev-list --count "$BASELINE"..HEAD 2>/dev/null || echo 0)"
else
  PATCH="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
fi
APP_VERSION="$BASE.$PATCH"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_REF="${DEPLOY_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- build image -----------------------------------------------------------
echo "[deploy] building image v$APP_VERSION ($GIT_SHA, ref $GIT_REF) — this downloads PyTorch + deps..."
sudo docker build \
  --build-arg APP_VERSION="$APP_VERSION" \
  --build-arg GIT_SHA="$GIT_SHA" \
  --build-arg GIT_REF="$GIT_REF" \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  -t subtitle-decks .

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

# --- ensure full UniDic dictionary on a persistent volume (downloaded once) -
# Like the camel_tools models, the ~770MB UniDic dict is kept off the image and
# lives on the named volume 'subtitle-decks-unidic', mounted at $UNIDIC_DIR. The
# image symlinks the pip 'unidic' package's dicdir to that mount point (see
# Dockerfile) so fugashi.Tagger() finds its mecabrc + sys.dic there.
#
# We do NOT use 'python -m unidic download' here: its download_and_clean() calls
# shutil.rmtree(dicdir) before writing, and shutil.rmtree refuses to operate on a
# symlink ("Cannot call rmtree on a symbolic link") — which is exactly what dicdir
# is. So on a fresh volume that command always dies. Instead we replicate what it
# produces, writing straight into the volume: the archive's dict files plus the
# 'version' and dummy 'mecabrc' files unidic writes itself. Guarded by sys.dic so
# later deploys skip it in seconds.
echo "[deploy] ensuring UniDic dictionary on volume (one-time ~770MB download)..."
status models "Preparing language models…"
sudo docker volume create subtitle-decks-unidic >/dev/null
sudo docker run --rm -i --user root \
  -v subtitle-decks-unidic:/opt/unidic_data \
  -e UNIDIC_DIR=/opt/unidic_data \
  subtitle-decks python - <<'PY'
import os, sys, json, zipfile, tempfile, shutil, urllib.request
d = os.environ["UNIDIC_DIR"]
if os.path.exists(os.path.join(d, "sys.dic")):
    print("[unidic] already present, skipping"); sys.exit(0)
# Resolve the same 'latest' dictionary 'python -m unidic download' would fetch.
info = json.loads(urllib.request.urlopen(
    "https://raw.githubusercontent.com/polm/unidic-py/master/dicts.json").read())
di = info["latest"]; url = di["url"]; ver = di["version"]
print("[unidic] downloading v%s from %s" % (ver, url))
tmp = tempfile.mkdtemp()
zpath = os.path.join(tmp, "unidic.zip")
urllib.request.urlretrieve(url, zpath)
with zipfile.ZipFile(zpath) as zf:
    zf.extractall(tmp)
# Find the extracted dir holding the dictionary (robust to the archive layout).
src = next((root for root, _dirs, files in os.walk(tmp) if "sys.dic" in files), None)
if src is None:
    print("[unidic] ERROR: sys.dic not found in archive", file=sys.stderr); sys.exit(1)
for name in os.listdir(src):
    s = os.path.join(src, name); t = os.path.join(d, name)
    shutil.copytree(s, t, dirs_exist_ok=True) if os.path.isdir(s) else shutil.copy2(s, t)
# unidic's own downloader writes these two; MeCab/fugashi needs mecabrc present.
open(os.path.join(d, "version"), "w").write("unidic-%s" % ver)
open(os.path.join(d, "mecabrc"), "w").write("# This is a dummy file.")
shutil.rmtree(tmp, ignore_errors=True)
print("[unidic] installed to", d)
PY

# --- ensure Stanza models on a persistent volume (downloaded once) ----------
# Same off-the-image rationale as camel_tools/UniDic: the Stanza models for the
# Stanza-backed processors (English, German, Spanish, Greek) live on the named volume
# 'subtitle-decks-stanza', mounted read-only at $STANZA_RESOURCES_DIR. Without
# this the in-container default dir resolves to an unwritable '/stanza_resources'
# and every Stanza language silently falls back to raw, unlemmatized tokens.
# Guarded by per-language .download_complete_<lang> markers so later deploys
# skip it in seconds, while a newly added language still gets fetched.
echo "[deploy] ensuring Stanza models on volume (one-time download)..."
status models "Preparing language models…"
sudo docker volume create subtitle-decks-stanza >/dev/null
sudo docker run --rm --user root \
  -v subtitle-decks-stanza:/opt/stanza_data \
  -e STANZA_RESOURCES_DIR=/opt/stanza_data \
  subtitle-decks \
  python -c '
import os, stanza
d = os.environ["STANZA_RESOURCES_DIR"]
# Legacy all-in-one marker from before per-language markers; it covers en/de/es.
legacy = os.path.exists(os.path.join(d, ".download_complete"))
for lang in ("en", "de", "es", "el"):
    marker = os.path.join(d, ".download_complete_" + lang)
    if os.path.exists(marker) or (legacy and lang in ("en", "de", "es")):
        continue
    # Only the processors the app actually uses. The default package also
    # pulls ner/sentiment/constituency/depparse (several GB, unused) — that
    # bloat made the download outlast the deploy SSH session and left the
    # app down. stanza resolves the needed deps (pretrain/charlm) itself.
    # NB: stanza.download() uses model_dir (stanza.Pipeline uses dir).
    stanza.download(lang, model_dir=d, processors="tokenize,pos,lemma", verbose=False)
    open(marker, "w").close()  # written only after this language succeeds
'

# --- ensure the Greek Wiktionary lexicon on the same volume (built once) ------
# GreekProcessor corrects Stanza's Greek lemmas against a lexicon built from the
# kaikki.org Wiktionary dump (~1MB gzipped, written atomically so its existence
# means a complete build). It's optional — without it Greek still works on plain
# Stanza lemmas — so a failed download (e.g. kaikki.org down) must not fail the deploy.
echo "[deploy] ensuring Greek Wiktionary lexicon on volume (one-time build)..."
sudo docker run --rm --user root \
  -v subtitle-decks-stanza:/opt/stanza_data \
  -e STANZA_RESOURCES_DIR=/opt/stanza_data \
  subtitle-decks \
  sh -c 'test -f /opt/stanza_data/el_wiktionary_lexicon.tsv.gz || python -m app.services.greek_lexicon build' \
  || echo "[deploy] WARNING: Greek lexicon build failed; Greek will use plain Stanza lemmas" >&2

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
