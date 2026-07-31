#!/usr/bin/env python3
"""Sync one account's analysis sessions + ignore list from dev to prod.

Every AnalysisSession already stores the full lemmatization output
(`subtitles` + `results` JSON) and prod serves it straight from the DB with no
recompute. So we can run analyses locally (where the heavy NLP models live) and
copy the resulting rows to prod — prod never has to load or run the models,
saving the EC2 CPU/RAM cost.

This is a standalone developer script: stdlib only (no app venv / SQLAlchemy
import), so the exact same file runs locally *and* inside the prod container.
It is additive — it never deletes or overwrites rows on the target.

Accounts are matched by **email**; the numeric user_id and language_id differ
between the two databases, so user is remapped by email and language by its
`code`. Session/ignore JSON and timestamps are copied verbatim as opaque text.

--------------------------------------------------------------------------------
USAGE

One-shot (recommended) — export locally, copy up, import inside the container:

    python webapp/scripts/sync_sessions.py push \
        --email you@example.com --host ubuntu@54.191.135.139

Or run the steps by hand:

    # 1. On dev — dump the account to a bundle:
    python webapp/scripts/sync_sessions.py export \
        --email you@example.com --db webapp/app.db --out bundle.json

    # 2. Copy the bundle + this script to the prod box, then into the container:
    scp bundle.json webapp/scripts/sync_sessions.py ubuntu@HOST:/tmp/
    ssh ubuntu@HOST 'sudo docker cp /tmp/bundle.json subtitle-decks:/tmp/ \
        && sudo docker cp /tmp/sync_sessions.py subtitle-decks:/tmp/ \
        && sudo docker exec subtitle-decks python /tmp/sync_sessions.py import \
             --in /tmp/bundle.json --db /app/data/app.db'

For zero write-contention you may `sudo docker stop subtitle-decks` before the
import and start it after; otherwise the importer just waits out the live app's
write lock (busy_timeout).

Not synced: session shares (they reference other users' ids) — single-account
scope skips them.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime

# Default DB locations for each side.
DEV_DB_DEFAULT = "webapp/app.db"          # relative to the repo root
PROD_DB_DEFAULT = "/app/data/app.db"      # inside the subtitle-decks container
PROD_CONTAINER_DEFAULT = "subtitle-decks"


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #
def _connect(path: str) -> sqlite3.Connection:
    if not os.path.exists(path):
        sys.exit(f"error: database not found: {path}")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    # Wait out the live app's write lock rather than failing immediately.
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def _find_user_id(conn: sqlite3.Connection, email: str) -> int | None:
    row = conn.execute(
        "SELECT id FROM users WHERE lower(email) = lower(?)", (email,)
    ).fetchone()
    return row["id"] if row else None


# --------------------------------------------------------------------------- #
# export
# --------------------------------------------------------------------------- #
def cmd_export(args: argparse.Namespace) -> None:
    conn = _connect(args.db)
    try:
        user_id = _find_user_id(conn, args.email)
        if user_id is None:
            sys.exit(f"error: no user with email {args.email!r} in {args.db}")

        # Sessions, with the language resolved to its portable code. JSON and
        # created_at columns are read as-is (opaque text) for a verbatim copy.
        sessions = [
            {
                "name": r["name"],
                "language_code": r["code"],
                "srt_filename": r["srt_filename"],
                "subtitles": r["subtitles"],
                "native_subtitles": r["native_subtitles"],
                "results": r["results"],
                "created_at": r["created_at"],
            }
            for r in conn.execute(
                """
                SELECT s.name, s.srt_filename, s.subtitles, s.native_subtitles,
                       s.results, s.created_at, l.code
                  FROM analysis_sessions s
                  JOIN languages l ON l.id = s.language_id
                 WHERE s.user_id = ?
                 ORDER BY s.id
                """,
                (user_id,),
            )
        ]

        ignore_list = [
            {"word": r["word"], "language_code": r["code"]}
            for r in conn.execute(
                """
                SELECT e.word, l.code
                  FROM ignore_list_entries e
                  JOIN languages l ON l.id = e.language_id
                 WHERE e.user_id = ?
                 ORDER BY e.id
                """,
                (user_id,),
            )
        ]
    finally:
        conn.close()

    bundle = {
        "email": args.email,
        "exported_at": datetime.utcnow().isoformat(sep=" "),
        "sessions": sessions,
        "ignore_list": ignore_list,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False)
    print(
        f"exported {len(sessions)} session(s) and {len(ignore_list)} ignore "
        f"word(s) for {args.email} -> {args.out}"
    )


# --------------------------------------------------------------------------- #
# import
# --------------------------------------------------------------------------- #
def cmd_import(args: argparse.Namespace) -> None:
    with open(args.infile, encoding="utf-8") as f:
        bundle = json.load(f)

    email = bundle["email"]
    sessions = bundle.get("sessions", [])
    ignore_list = bundle.get("ignore_list", [])

    conn = _connect(args.db)
    try:
        conn.execute("BEGIN")

        # Resolve or create the target user (matched by email; a later Google
        # login reuses this row, and ADMIN_EMAILS still grants admin normally).
        user_id = _find_user_id(conn, email)
        created_user = False
        if user_id is None:
            cur = conn.execute(
                "INSERT INTO users (email, picture, is_admin, created_at, "
                "max_upload_bytes) VALUES (?, NULL, 0, ?, NULL)",
                (email, datetime.utcnow().isoformat(sep=" ")),
            )
            user_id = cur.lastrowid
            created_user = True

        lang_id = {r["code"]: r["id"] for r in conn.execute("SELECT code, id FROM languages")}

        # Sessions — skip any the user already has with the same (name, language)
        # so the import is idempotent and never produces "name (2)" duplicates.
        inserted = skipped = 0
        for s in sessions:
            lid = lang_id.get(s["language_code"])
            if lid is None:
                print(f"  ! skip session {s['name']!r}: unknown language "
                      f"{s['language_code']!r} on target")
                skipped += 1
                continue
            exists = conn.execute(
                "SELECT 1 FROM analysis_sessions WHERE user_id = ? AND "
                "language_id = ? AND name = ?",
                (user_id, lid, s["name"]),
            ).fetchone()
            if exists:
                skipped += 1
                continue
            conn.execute(
                "INSERT INTO analysis_sessions (user_id, name, language_id, "
                "srt_filename, subtitles, native_subtitles, results, "
                "created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
                (
                    user_id, s["name"], lid, s["srt_filename"],
                    s["subtitles"], s["native_subtitles"], s["results"],
                    s["created_at"],
                ),
            )
            inserted += 1

        # Ignore list — unique (user_id, word, language_id) makes this a no-op
        # for words already present.
        ign_added = ign_skipped = 0
        for e in ignore_list:
            lid = lang_id.get(e["language_code"])
            if lid is None:
                ign_skipped += 1
                continue
            cur = conn.execute(
                "INSERT OR IGNORE INTO ignore_list_entries (user_id, word, "
                "language_id) VALUES (?, ?, ?)",
                (user_id, e["word"], lid),
            )
            if cur.rowcount:
                ign_added += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    who = "created new user" if created_user else "matched existing user"
    print(f"{email}: {who} (id {user_id})")
    print(f"  sessions:    {inserted} inserted, {skipped} skipped (already present)")
    print(f"  ignore list: {ign_added} added")


# --------------------------------------------------------------------------- #
# push (export locally -> copy up -> import in the container)
# --------------------------------------------------------------------------- #
def _run(cmd: list[str]) -> None:
    print("+ " + " ".join(cmd))
    subprocess.run(cmd, check=True)


def cmd_push(args: argparse.Namespace) -> None:
    script_path = os.path.abspath(__file__)
    remote_bundle = "/tmp/sync_bundle.json"
    remote_script = "/tmp/sync_sessions.py"
    container = args.container

    with tempfile.TemporaryDirectory() as tmp:
        bundle_path = os.path.join(tmp, "bundle.json")
        cmd_export(argparse.Namespace(db=args.db, email=args.email, out=bundle_path))

        # Copy bundle + this script to the host, then into the container.
        _run(["scp", bundle_path, script_path, f"{args.host}:/tmp/"])
        remote = (
            f"sudo docker cp {remote_bundle} {container}:/tmp/bundle.json && "
            f"sudo docker cp {remote_script} {container}:/tmp/sync_sessions.py && "
            f"sudo docker exec {container} python /tmp/sync_sessions.py import "
            f"--in /tmp/bundle.json --db {args.target_db}"
        )
        _run(["ssh", args.host, remote])
    print("push complete.")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    pe = sub.add_parser("export", help="dump an account to a JSON bundle")
    pe.add_argument("--email", required=True)
    pe.add_argument("--db", default=DEV_DB_DEFAULT, help=f"source DB (default: {DEV_DB_DEFAULT})")
    pe.add_argument("--out", required=True, help="output bundle path")
    pe.set_defaults(func=cmd_export)

    pi = sub.add_parser("import", help="load a JSON bundle into a target DB (additive)")
    pi.add_argument("--in", dest="infile", required=True, help="bundle path")
    pi.add_argument("--db", default=PROD_DB_DEFAULT, help=f"target DB (default: {PROD_DB_DEFAULT})")
    pi.set_defaults(func=cmd_import)

    pp = sub.add_parser("push", help="export locally then import on the prod host over ssh")
    pp.add_argument("--email", required=True)
    pp.add_argument("--host", required=True, help="ssh target, e.g. ubuntu@54.191.135.139")
    pp.add_argument("--db", default=DEV_DB_DEFAULT, help=f"local source DB (default: {DEV_DB_DEFAULT})")
    pp.add_argument("--container", default=PROD_CONTAINER_DEFAULT, help=f"prod container (default: {PROD_CONTAINER_DEFAULT})")
    pp.add_argument("--target-db", default=PROD_DB_DEFAULT, help=f"DB path inside the container (default: {PROD_DB_DEFAULT})")
    pp.set_defaults(func=cmd_push)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
