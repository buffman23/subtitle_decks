"""Resolves the running build's version + provenance for display in the admin UI.

Two sources, in priority order:

1. Build-time env vars (``APP_VERSION``/``GIT_SHA``/``GIT_REF``/``BUILD_TIME``) baked
   into the Docker image by ``deploy/lightsail-deploy.sh``. The container has no
   ``.git``, so this is the only source in production.
2. Local-dev fallback: read ``MAJOR.MINOR <baseline>`` from ``webapp/VERSION`` and
   derive the patch from ``git rev-list --count <baseline>..HEAD`` plus the short
   SHA / branch from git directly.

The result is immutable for the process lifetime, so it's computed once and cached.
"""
import os
import subprocess
from functools import lru_cache
from pathlib import Path

# webapp/app/version.py -> webapp/ holds the VERSION file and lives inside the repo.
_WEBAPP_DIR = Path(__file__).resolve().parent.parent
_VERSION_FILE = _WEBAPP_DIR / "VERSION"


def _git(*args: str) -> str | None:
    """Run a git command in the webapp dir; return stripped stdout or None on failure."""
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=_WEBAPP_DIR,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip() or None


def _version_from_git() -> dict:
    """Best-effort version info from the working tree (local dev only)."""
    base, baseline = "0.0", None
    try:
        parts = _VERSION_FILE.read_text(encoding="utf-8").split()
        if parts:
            base = parts[0]
        if len(parts) > 1:
            baseline = parts[1]
    except OSError:
        pass

    if baseline:
        count = _git("rev-list", "--count", f"{baseline}..HEAD")
    else:
        count = _git("rev-list", "--count", "HEAD")
    patch = count if count is not None else "0"

    sha = _git("rev-parse", "--short", "HEAD") or "unknown"
    ref = _git("rev-parse", "--abbrev-ref", "HEAD") or "unknown"
    return {
        "version": f"{base}.{patch}",
        "sha": sha,
        "ref": ref,
        "build_time": "dev",
    }


@lru_cache(maxsize=1)
def get_build_info() -> dict:
    """Return ``{version, sha, ref, build_time}`` for the running build.

    Prefers values baked in at build time (env vars); falls back to git for local dev.
    """
    env_version = os.environ.get("APP_VERSION")
    if env_version and env_version != "dev":
        return {
            "version": env_version,
            "sha": os.environ.get("GIT_SHA", "unknown"),
            "ref": os.environ.get("GIT_REF", "unknown"),
            "build_time": os.environ.get("BUILD_TIME", "unknown"),
        }
    return _version_from_git()
