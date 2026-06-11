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
    CAMELTOOLS_DATA=/opt/camel_tools_data

WORKDIR /app

# CPU-only PyTorch (no GPU on Fargate/App Runner) — far smaller than the CUDA build.
# Installed first so the camel-tools/stanza deps reuse it instead of pulling CUDA wheels.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt ./
RUN pip install -r requirements.txt

# Download ONLY the camel_tools data this app uses (~1 GB of the full 5 GB set):
#   BERT disambiguators for MSA + Egyptian, plus their morphology databases.
# (camel_data won't create CAMELTOOLS_DATA itself, so make it first.)
RUN mkdir -p "$CAMELTOOLS_DATA" \
 && python -m camel_tools.cli.camel_data -i disambig-bert-unfactored-msa \
 && python -m camel_tools.cli.camel_data -i disambig-bert-unfactored-egy \
 && python -m camel_tools.cli.camel_data -i morphology-db-msa-r13 \
 && python -m camel_tools.cli.camel_data -i morphology-db-egy-r13

# Application code + the compiled frontend bundle from stage 1
COPY app ./app
COPY --from=frontend /build/app/static/js/app.js ./app/static/js/app.js

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
