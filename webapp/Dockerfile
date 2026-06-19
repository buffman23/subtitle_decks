# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build the TypeScript frontend into app/static/js/app.js
# ---------------------------------------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /build

# Install deps first (cached unless package*.json change)
COPY package.json package-lock.json ./
RUN npm ci

# Build the IIFE bundle (vite outputs to app/static/js/app.js)
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build


# ---------------------------------------------------------------------------
# Stage 2 — Python runtime
# ---------------------------------------------------------------------------
FROM python:3.10-slim AS runtime

# Faster, quieter, unbuffered logs in containers
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    CAMELTOOLS_DATA=/opt/camel_tools_data \
    UNIDIC_DIR=/opt/unidic_data \
    STANZA_RESOURCES_DIR=/opt/stanza_data

WORKDIR /app

# CPU-only PyTorch (no GPU on Fargate/App Runner) — far smaller than the CUDA build.
# Installed first so the camel-tools/stanza deps reuse it instead of pulling CUDA wheels.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt ./
RUN pip install -r requirements.txt

# NOTE: large language data is NOT baked into the image. The camel_tools models
# (~1.8GB) and the full UniDic dictionary (~770MB) are each downloaded once onto a
# persistent named volume and mounted read-only at runtime ($CAMELTOOLS_DATA and
# $UNIDIC_DIR respectively — see deploy/lightsail-deploy.sh). Keeping them out of
# the image means a requirements/code change no longer busts the cache for a
# multi-GB re-download, and the image stays much smaller.

# fugashi.Tagger() bootstraps MeCab from the pip 'unidic' package's dicdir (its
# mecabrc + sys.dic). Since we keep that dict on the $UNIDIC_DIR volume instead of
# in the image, point the package's dicdir at the mount with a symlink. Without
# this, fugashi looks for a mecabrc in the (empty) package dir and fails to load,
# so Japanese silently fell back to raw tokens. The target is created at runtime by
# the volume mount, so a dangling symlink at build time is expected/fine.
RUN UD="$(python -c 'import unidic; print(unidic.DICDIR)')" \
 && rm -rf "$UD" \
 && ln -s /opt/unidic_data "$UD"

# Application code + the compiled frontend bundle from stage 1
COPY app ./app
COPY --from=frontend /build/app/static/js/app.js ./app/static/js/app.js

# Build provenance, baked in by deploy/lightsail-deploy.sh (the running container
# has no .git, so this is how the admin page knows which build is live). Placed
# after the heavy pip layers so version churn doesn't bust their cache.
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG GIT_REF=unknown
ARG BUILD_TIME=unknown
ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    GIT_REF=$GIT_REF \
    BUILD_TIME=$BUILD_TIME

# Run as a non-root user. Pre-create the data dir owned by appuser so that a
# named volume mounted at /app/data inherits appuser ownership (SQLite needs
# to create app.db there).
RUN useradd --create-home --uid 10001 appuser \
 && mkdir -p /app/data \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Production server: no reload, trust proxy headers so OAuth redirect_uri is https.
# --forwarded-allow-ips=* is safe here because only the platform's load balancer
# (App Runner / ALB) can reach the container's port.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
