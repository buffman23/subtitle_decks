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
| Domain | `subtitledecks.com` (+ `www`), set via `DOMAIN=` in the server `.env` |
| HTTPS | ✅ **live** — Cloudflare (proxied) → Caddy on the instance, using a Cloudflare Origin Certificate. `deploy.sh` installs/configures Caddy automatically; see "HTTPS" below. Container binds to `127.0.0.1:8000` so Caddy owns 443. |

Live: https://subtitledecks.com — `GET /healthz` → `{"status":"ok"}`. (The raw instance IP `52.39.205.152` also answers, but Google login only works over the domain/HTTPS.)

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

## Deploying (GitHub Actions — recommended)
Deploys are one click: **Actions → Deploy → Run workflow**. Pick the ref to ship
(defaults to `main`; choose an older tag/branch to roll back) and run it. The
hosted runner SSHes into the instance, fast-forwards the server's git checkout to
that ref, and runs `deploy/lightsail-deploy.sh`. The full build streams into the
Actions log.

While the image builds, the app container is **stopped** so the build gets the
instance's RAM/CPU — so the site is down for the whole build, not just the
restart. That downtime is covered by a status page: Caddy serves
`deploy/maintenance/index.html` automatically whenever the app is unreachable
(`handle_errors`), and the page polls `/deploy/status.json` and reloads into the
app once the deploy reports `live`. So visitors see "Subtitle Decks is updating"
with a live phase (building → models → starting-app → back online) instead of an
error. (This trades the old near-zero-downtime container swap for build
resources — an intentional choice.)

A failed **build** auto-recovers: an `ERR` trap in the script restarts the
previous image (the `subtitle-decks` tag still points at the last good build,
since `docker build` only moves the tag on success) and the status page shows
"previous version restored". Rolling back a build that succeeds but runs
unhealthy would need image versioning (a registry) — out of scope here.

### One-time setup for Actions deploys
1. **Make the server a git checkout** (replaces the tarball flow). On the box,
   create a read-only key and add its public half as a **Deploy key** on
   `github.com/buffman23/subtitle_decks` (Settings → Deploy keys, read-only),
   then:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/gh_deploy -N ''      # add ~/.ssh/gh_deploy.pub as the deploy key
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
       IdentityFile ~/.ssh/gh_deploy
       IdentitiesOnly yes
   EOF
   # Clone over SSH next to the existing app dir. The current ~/subtitle_decks/webapp
   # holds your .env (gitignored) — move it aside, clone, then restore .env:
   mv ~/subtitle_decks ~/subtitle_decks.bak
   git clone git@github.com:buffman23/subtitle_decks.git ~/subtitle_decks
   cp ~/subtitle_decks.bak/webapp/.env ~/subtitle_decks/webapp/.env
   ```
   `git reset --hard` never touches `webapp/.env` (it's gitignored) or the Docker
   volumes (SQLite + camel_tools), so data and secrets survive every deploy.
2. **Runner → server SSH.** Create a keypair for the runner to log in **as
   `ubuntu`** and add three repo secrets (Settings → Secrets and variables →
   Actions): `LIGHTSAIL_SSH_KEY` (the private key), `LIGHTSAIL_HOST`
   (`52.39.205.152` or `subtitledecks.com`), `LIGHTSAIL_USER` (`ubuntu`). Add the
   public half to `~/.ssh/authorized_keys` on the box. Port 22 is open by default
   on Lightsail, so GitHub-hosted runners can reach it. *(If you'd rather not
   expose SSH to GitHub's IP ranges, run a self-hosted runner on the instance
   instead — then the workflow needs no inbound SSH.)*
3. **Approval gate (optional).** The workflow runs in a `production`
   Environment; add required reviewers under Settings → Environments → production
   to require a click-to-approve before each deploy.

The first Actions run installs Caddy, writes the maintenance-aware Caddyfile, and
publishes the status page automatically — no extra manual step.

---

## Connecting to the server
On Windows the key needs locked-down ACLs or OpenSSH refuses it:
```powershell
$key = "$env:USERPROFILE\ls_key.pem"
Copy-Item .\LightsailDefaultKey-us-west-2.pem $key -Force
icacls $key /inheritance:r; icacls $key /grant:r "$($env:USERNAME):(R)"
ssh -i $key ubuntu@52.39.205.152
```

## Manual redeploy (fallback / break-glass)
> Prefer the **GitHub Actions** flow above. Use this only when Actions/GitHub is
> unavailable. It ships a tarball instead of a git pull and is the source of the
> stale-tarball trap noted below. It also runs `deploy/lightsail-deploy.sh`,
> which **requires** `webapp/.env` to already exist (it never writes secrets
> itself). Create the `.env` once before the first deploy — see below.

From the repo root (PowerShell), ship the updated source and rebuild:
```powershell
$key  = "$env:USERPROFILE\ls_key.pem"
$repo = "C:\Users\ryanc\Desktop\Arabic\subtitle_decks"   # adjust to your clone
$tgz  = "$env:TEMP\webapp.tgz"
# 1. Package webapp/ (excluding heavy/local-only dirs).
#    Use an ABSOLUTE -C path: the tool shell keeps its cwd between commands, so a
#    prior `cd webapp` (e.g. for `npm run build`) makes a relative `-C webapp` fail.
Remove-Item $tgz -ErrorAction SilentlyContinue           # never ship a leftover archive
tar -czf $tgz -C "$repo\webapp" `
  --exclude=node_modules --exclude=__pycache__ --exclude=app.db `
  --exclude=.venv --exclude=.env .
if (-not $?) { throw "tar failed — aborting before scp" } # else scp ships stale code (see note)
# Optional sanity check: confirm your edited files are in the archive
# tar -tzf $tgz | Select-String 'app/templates/index.html'
# 2. Copy up and extract
scp -i $key $tgz ubuntu@52.39.205.152:/home/ubuntu/webapp.tgz
ssh -i $key ubuntu@52.39.205.152 'tar -xzf ~/webapp.tgz -C ~/subtitle_decks/webapp && rm ~/webapp.tgz'
# 3. Rebuild + restart (cached layers make this fast unless requirements changed)
ssh -i $key ubuntu@52.39.205.152 'bash ~/subtitle_decks/deploy/lightsail-deploy.sh'
# 4. Verify the new code is actually SERVED, not just that the container is "Up".
#    Health, plus confirm an edited asset round-trips (bump the ?v= cache-buster
#    in base.html when you change static files, or Cloudflare/browser may cache them):
Invoke-WebRequest https://subtitledecks.com/healthz -UseBasicParsing | ForEach-Object Content
```
> ⚠️ **Stale-tarball trap.** If `tar` fails (most commonly the relative-`-C`
> chdir issue above) but you don't stop, the next `scp` will happily upload an
> **old `webapp.tgz` left in `$env:TEMP` from a previous deploy** — silently
> shipping stale code. The `Remove-Item` + `if (-not $?) { throw }` guards above
> prevent this; keep them. When in doubt, `tar -tzf $tgz` and eyeball the files.
>
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

## HTTPS
> **Already set up and automated.** HTTPS is live at https://subtitledecks.com:
> Cloudflare proxies the site and connects to the instance over TLS in **Full
> (strict)** mode, and `deploy.sh` installs Caddy + writes the Caddyfile on every
> run, terminating TLS with the **Cloudflare Origin Certificate** at
> `/etc/caddy/cf-origin.pem` / `.key`. You only need the manual steps below when
> standing up a **new** instance — and note the live setup uses a Cloudflare
> origin cert (placed by hand once at those paths), *not* the Let's Encrypt flow
> the original notes below describe.

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
