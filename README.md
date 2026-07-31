# Subtitle Decks

Turn subtitle files into study-ready **word-frequency lists** for language learning.

Feed Subtitle Decks a `.srt` file and it parses, tokenizes, and lemmatizes every line,
then returns each lemma with its frequency (sorted most-frequent first) — a ready-made
vocabulary study list for the show or film you're watching.

## Features

- **Multi-language lemmatization** — 7 language variants, each backed by the best-fit NLP
  library (see below).
- **Per-subtitle token highlighting** — analysis returns character-offset segments per
  line, so the UI can highlight the exact token behind each lemma.
- **Saveable analysis sessions** — name, revisit, and share past analyses with other users.
- **Ignore list & blacklist filtering** — hide words you already know; filtering is
  applied both at the token level (pre-lemmatize) and at the lemma level.
- **CSV export** — take your frequency list into a spreadsheet or a flashcard tool.
- **Google OAuth auth** with admin pages for user and system management.

## Supported languages

| Code     | Language                     | Library            |
| -------- | ---------------------------- | ------------------ |
| `ar-msa` | Arabic – Modern Standard     | camel-tools        |
| `ar-egy` | Arabic – Egyptian            | camel-tools        |
| `en`     | English                      | Stanza             |
| `de`     | German                       | Stanza             |
| `es`     | Spanish                      | Stanza             |
| `tl`     | Tagalog                      | calamancy          |
| `ja`     | Japanese                     | fugashi / UniDic   |

Languages are registered in `webapp/app/services/processor_registry.py`.

## Supported formats

`.srt` only, for now. The parsing layer (`webapp/app/services/subtitle_parser.py`) is kept
decoupled from the rest of the pipeline so more formats can be added later. SRT files are
read as UTF-8 with a fallback to windows-1256.

## Tech stack

- **Backend** — FastAPI + Uvicorn, SQLAlchemy 2 / SQLite, Jinja2 templates.
- **Frontend** — TypeScript compiled by Vite into a single IIFE bundle; Bootstrap 5.
- **Auth** — Authlib (Google OAuth) over Starlette `SessionMiddleware`.
- **NLP** — camel-tools, Stanza, calamancy, fugashi/UniDic.

Heavy analysis runs on a background job queue (`services/job_queue.py`). The app
intentionally runs a single Uvicorn worker: the NLP model caches are process-local, so
extra workers would each hold their own copy and multiply RAM usage.

## Project structure

```
subtitle_decks/
├── webapp/
│   ├── app/
│   │   ├── main.py              # FastAPI app, lifespan (DB init, migrations, job queue)
│   │   ├── config.py            # pydantic-settings, reads .env
│   │   ├── models.py            # User, BlacklistEntry, AnalysisSession ORM models
│   │   ├── auth.py              # Google OAuth routes
│   │   ├── routers/             # pages, analysis, ignorelist, sessions, demo, admin APIs
│   │   ├── services/            # analysis pipeline + per-language processors
│   │   │   ├── frequency_analyzer.py   # parse → tokenize → lemmatize → count
│   │   │   ├── subtitle_parser.py      # .srt parsing (decoupled)
│   │   │   ├── processor_registry.py   # language registry — add processors here
│   │   │   ├── arabic_processor.py, english_processor.py, ... japanese_processor.py
│   │   │   └── job_queue.py            # background analysis worker
│   │   ├── templates/          # Jinja2 templates
│   │   └── static/             # CSS + compiled JS (app/static/js/app.js, gitignored)
│   ├── src/                    # TypeScript frontend source
│   ├── run.py                  # dev entry point (uvicorn on :8000)
│   ├── requirements.txt
│   ├── package.json            # Vite build
│   └── VERSION                 # MAJOR.MINOR + baseline commit
├── deploy/                     # deployment scripts & docs
└── CLAUDE.md                   # detailed developer notes
```

## Getting started

### Prerequisites

- Python (use the project's `.venv` — see the [Python environment](#python-environment)
  note below).
- Node.js (to build the TypeScript frontend).
- **camel-tools models** for Arabic — pointed to by the `CAMELTOOLS_DATA` environment
  variable.

### 1. Install Python dependencies

```bash
.venv/Scripts/python.exe -m pip install -r webapp/requirements.txt
```

### 2. Configure environment

Copy the example env file and fill it in:

```bash
cp webapp/.env.example webapp/.env
```

At minimum set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SECRET_KEY`
(`openssl rand -hex 32`). Add your email to `ADMIN_EMAILS` to bootstrap the first admin.

> **Local dev tip:** set `DEV_MODE=true` to enable a "log in as any existing user" picker
> on the login page and skip Google OAuth entirely. Keep it `false`/unset in production.

### 3. Run the app

```bash
cd webapp && ../.venv/Scripts/python.exe run.py
```

Then open <http://localhost:8000>. The database tables and migrations run automatically on
startup.

## Frontend build

Frontend source lives in `webapp/src/`; the compiled output is
`webapp/app/static/js/app.js` (gitignored).

```bash
cd webapp

npm install          # first time only
npm run build        # compile once
npm run build:watch  # recompile on save
npm run typecheck    # type-check without emitting
```

## Configuration

All settings are read from `webapp/.env` (see `webapp/.env.example`).

| Variable                | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`      | Google OAuth client ID.                                                 |
| `GOOGLE_CLIENT_SECRET`  | Google OAuth client secret.                                             |
| `SECRET_KEY`            | Session-cookie signing key (**required** in production).                |
| `ADMIN_EMAILS`          | Comma-separated emails auto-granted admin on login.                     |
| `DATABASE_URL`          | Optional. Defaults to `sqlite:///./app.db` for local dev.               |
| `SESSION_COOKIE_SECURE` | `true` in production (HTTPS) so the session cookie is marked `Secure`.  |
| `DEV_MODE`              | Local only. Enables the "log in as any user" picker. Keep off in prod.  |
| `DOMAIN`                | Public deployment domain (used by the deploy scripts). Blank for local. |

## Versioning

Semantic versioning `MAJOR.MINOR.PATCH`, surfaced on the admin pages. `MAJOR.MINOR` and
the baseline commit live in `webapp/VERSION`; **PATCH is derived automatically** from the
git commit count since the baseline. See the *Versioning* section of `CLAUDE.md` for when
to bump each part.

## Deployment

Deployment scripts and docs live in `deploy/` (`aws-deploy.md`, `lightsail-deploy.sh`, and
a `subtitle-decks.service` systemd unit). Note that the AWS doc may be partly out of date
as the hosting setup evolves — treat it as a starting point, not gospel.

## Adding a language

1. Create a processor in `webapp/app/services/` that implements the `LanguageProcessor`
   interface (`language_processor.py`) — `tokenize()` and `lemmatize()`.
2. Register it in `webapp/app/services/processor_registry.py`.

Each language can rely on a different lemmatization library, so keep processor interfaces
flexible. For camel-tools analysis fields and other deep internals, see `CLAUDE.md`.

<a id="python-environment"></a>
> **Python environment:** always use the `.venv` in the repo root — never the system
> Python. Commands above assume Windows paths (`.venv/Scripts/python.exe`).
