# Project Notes

## About Subtitle Decks
Subtitle Decks takes subtitle files as input and outputs a word frequency list that can be used for language study.

- **Languages**: Currently supports MSA and Egyptian Arabic. More languages are planned — keep code interfaces flexible, as each language will likely rely on different lemmatization libraries. New processors go in `webapp/app/services/` and are registered in `processor_registry.py`.
- **Subtitle formats**: Currently supports `.srt` only. More formats are planned — the parsing layer (`subtitle_parser.py`) should remain decoupled from the rest of the pipeline.

## Python Environment
Always use the `.venv` in this directory — never the system Python.

```bash
# Run scripts
.venv/Scripts/python.exe script.py

# Install packages
.venv/Scripts/python.exe -m pip install <package>

# Run the webapp
cd webapp && ../.venv/Scripts/python.exe run.py
```

## camel_tools Data
The camel_tools models are stored at the path in the `CAMELTOOLS_DATA` environment variable. No need to re-download them.

## Frontend Build (TypeScript + Vite)
Source lives in `webapp/src/`. Compiled output is `webapp/app/static/js/app.js` (gitignored).

```bash
cd webapp

# Install dependencies (first time only)
npm install

# Recompile on save
npm run build

# Type-check without emitting
npm run typecheck
```
