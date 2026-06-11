# Deploying Subtitle Decks to AWS

The app is packaged as a Docker image (`webapp/Dockerfile`). It is **currently
deployed on an AWS Lightsail instance** running the container directly. This doc
is the runbook for that deployment, plus notes on alternatives.

## Current deployment (Lightsail instance)
| | |
|---|---|
| Host | `ubuntu@52.39.205.152` (Lightsail instance, us-west-2) |
| OS | Ubuntu 24.04 LTS, x86_64, 2 vCPU / 8 GB RAM / 160 GB SSD |
| SSH key | `LightsailDefaultKey-us-west-2.pem` (repo root, gitignored — local only) |
| App dir on server | `~/subtitle_decks/webapp` |
| Runtime | Docker container `subtitle-decks`, host port **80 → 8000** |
| Restart policy | `unless-stopped` (survives reboots) |
| Database | SQLite on a **named volume** `subtitle-decks-data` → `/app/data` (persists across redeploys) |
| Models | camel_tools data (~1.8 GB) on a **named volume** `subtitle-decks-models` → `/opt/camel_tools_data` (read-only), downloaded once — not baked into the image |
| HTTPS | ⚠️ **not yet configured** — see "Enabling HTTPS" below |

Live (HTTP only for now): http://52.39.205.152 — `GET /healthz` → `{"status":"ok"}`.

## What the image contains
- Python 3.10 runtime, CPU-only PyTorch (no GPU on Lightsail)
- Compiled TypeScript frontend (built in a Node stage)
- Served by `uvicorn` on port **8000** with `--proxy-headers` (so that, once
  behind a TLS proxy, the OAuth `redirect_uri` is built as `https://`)

The camel_tools models (~1.8 GB: BERT disambiguators for MSA + Egyptian and
their morphology DBs — **not** the full 5 GB local set) are **not** in the image.
`deploy.sh` downloads them once onto the `subtitle-decks-models` volume and mounts
it read-only at `/opt/camel_tools_data`. Keeping them off the image means a
requirements/code change no longer triggers a 1.8 GB re-download on rebuild, and
the image is ~1.8 GB smaller. The download step is idempotent — later deploys skip
the already-present packages in seconds.

---

## Connecting to the server
On Windows the key needs locked-down ACLs or OpenSSH refuses it:
```powershell
$key = "$env:USERPROFILE\ls_key.pem"
Copy-Item .\LightsailDefaultKey-us-west-2.pem $key -Force
icacls $key /inheritance:r; icacls $key /grant:r "$($env:USERNAME):(R)"
ssh -i $key ubuntu@52.39.205.152
```

## Redeploying after code changes
The deploy is driven by `deploy/lightsail-deploy.sh`, which lives on the server
as `~/deploy.sh`. It **requires** `webapp/.env` to already exist (it never writes
secrets itself), builds the image, and restarts the container with the data
volume. Create the `.env` once before the first deploy — see below.

From the repo root (PowerShell), ship the updated source and rebuild:
```powershell
$key = "$env:USERPROFILE\ls_key.pem"
# 1. Package webapp/ (excluding heavy/local-only dirs)
tar -czf "$env:TEMP\webapp.tgz" -C webapp `
  --exclude=node_modules --exclude=__pycache__ --exclude=app.db `
  --exclude=.venv --exclude=.env .
# 2. Copy up and extract
scp -i $key "$env:TEMP\webapp.tgz" ubuntu@52.39.205.152:/home/ubuntu/webapp.tgz
ssh -i $key ubuntu@52.39.205.152 'tar -xzf ~/webapp.tgz -C ~/subtitle_decks/webapp && rm ~/webapp.tgz'
# 3. Rebuild + restart (cached layers make this fast unless requirements changed)
ssh -i $key ubuntu@52.39.205.152 'bash ~/deploy.sh'
```
> Run `deploy.sh` **as `ubuntu`, not `sudo bash`** — it uses `sudo docker`
> internally, but the outer process must stay `ubuntu` so `$HOME` resolves to
> `/home/ubuntu`. The script already handles Docker via `sudo`.

The SQLite DB on the `subtitle-decks-data` volume is untouched by rebuilds. Take
a snapshot before risky changes: `sudo docker run --rm -v subtitle-decks-data:/d
-v $PWD:/b alpine cp /d/app.db /b/app.db.bak`.

## The server `.env`
**You supply this** — `deploy.sh` refuses to run without it and never writes
secrets itself. Create it once on the server at `~/subtitle_decks/webapp/.env`
(start from `webapp/.env.example`), `chmod 600`:
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SECRET_KEY=<generate with: openssl rand -hex 32>
ADMIN_EMAILS=you@example.com
DATABASE_URL=sqlite:////app/data/app.db   # 4 slashes = absolute /app/data/app.db
SESSION_COOKIE_SECURE=false               # flip to true once HTTPS is on
```
Passed to the container via `--env-file .env`; secrets are **not** baked into the
image (`.env` is in `.dockerignore`) nor written by any script in the repo.

---

## ⚠️ Enabling HTTPS (required before Google login works)
Google OAuth rejects non-`localhost` `http://` redirect URIs, so **login is
broken until HTTPS is set up.** With a domain pointed at `52.39.205.152`:

1. **DNS:** add an A record `yourdomain.com → 52.39.205.152`.
2. **Firewall:** in the Lightsail console → instance → *Networking*, open **443**
   (80 and 22 are open by default; 443 is not).
3. **Rebind the container to loopback** so Caddy can own 80/443. In `deploy.sh`
   change `-p 80:8000` to `-p 127.0.0.1:8000:8000` and redeploy.
4. **Install Caddy** on the instance and use this `/etc/caddy/Caddyfile`:
   ```
   yourdomain.com {
       reverse_proxy 127.0.0.1:8000
   }
   ```
   `sudo systemctl reload caddy` — it auto-obtains/renews a Let's Encrypt cert and
   sets `X-Forwarded-Proto`, which uvicorn's `--proxy-headers` already trusts.
5. **Flip the cookie flag:** set `SESSION_COOKIE_SECURE=true` in the server `.env`
   and redeploy.
6. **Google Cloud Console → Credentials**, add to the OAuth client:
   - Authorized redirect URI: `https://yourdomain.com/auth/google/callback`
   - Authorized JavaScript origin: `https://yourdomain.com`

(The repo also has `deploy/subtitle-decks.service` — a systemd unit for running
uvicorn directly without Docker, if you ever drop the container approach.)

---

## Persistence note
Because the SQLite file lives on the `subtitle-decks-data` **Docker volume**
(not the container's ephemeral layer), user accounts/sessions/ignore lists
**survive redeploys and reboots**. Still take periodic snapshots of the volume
or the whole Lightsail instance. If you outgrow SQLite, switch `DATABASE_URL` to
a Lightsail managed PostgreSQL instance (add `psycopg[binary]` to
`requirements.txt` first and verify the models don't rely on SQLite-only behavior).

---

## Other AWS options (not currently used)
If you later want managed containers instead of an instance:
- **App Runner** — push the image to **ECR**, point a service at it; gives
  automatic managed HTTPS + a default domain. No persistent volume, so SQLite
  would need to move to RDS/managed Postgres.
- **ECS Fargate + EFS + ALB** — more control; supports a persistent EFS volume
  for the SQLite file and an ACM cert on the load balancer.
- **Lightsail Containers** — similar to App Runner, flat pricing, but pricier
  than this instance for the RAM this app needs, and still no persistent volume.

For this app's modest, bursty traffic, the single Lightsail **instance** running
Docker (current setup) is the cheapest option that also gives a persistent disk.
