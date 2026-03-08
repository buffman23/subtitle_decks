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

### BERTUnfactoredDisambiguator and MLEDisambiguator — Analysis Fields
Each `disambig.analyses[0].analysis` is a `dict` with these keys (use `.get()` with defaults — not all fields present in every analysis):

**Lemmatization / Lexical**
- `lex` — lemma/lexeme (currently used for frequency)
- `root` — morphological root (e.g. `k-t-b`)
- `gloss` — English definition
- `diac` — fully diacritized form
- `bw` — Buckwalter transliteration
- `caphi` — CAPHI romanization
- `pattern` — morphological pattern (e.g. `C-C-C`)

**Part of Speech & Morphology**
- `pos` — part of speech: VERB, NOUN, ADJ, PREP, etc.
- `per` — person: 1, 2, 3, na
- `gen` — gender: m, f, d, na, b
- `num` — number: s, d, p, na
- `asp` — aspect: perf, impf, imp, na
- `mod` — mood: ind, subj, juss, imp, na
- `vox` — voice: act, pass, mid, na
- `stt` — state: c, i, det, cons, na
- `cas` — case: nom, acc, gen, na
- `form_gen`, `form_num` — form gender/number

**Clitics**
- `prc0`–`prc3` — proclitic particles (e.g. `al` for definite article)
- `enc0`–`enc2` — enclitic pronouns (e.g. `h`, `k`, `ni`)

**POS Tagsets**
- `catib6` — CATIB-6 tag; `ud` — Universal Dependencies POS; `rat` — rationality

**Tokenization/Segmentation**
- `atbtok`, `atbseg`, `d1tok`–`d3tok`, `d1seg`–`d3seg`, `bwtok`

**Probabilities** (floats, default `-99.0`)
- `pos_logprob`, `lex_logprob`, `pos_lex_logprob`

**Source** — how analysis was obtained: `digit`, `punc`, `foreign`, `spvar`, `backoff`, `regular`

**Computed** (added during merge): `stem`, `stemcat`, `stemgloss`

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
