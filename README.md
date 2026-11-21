[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/gta6scam/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/gta6scam/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

`main.ts` is the house driver, unchanged: it reads every case from `/input/cases.json`, answers each with
`run(input)` from `solve.js`, and writes `/output/answers.json`. `solve.js` is the entry: a dependency-free ES
module whose `run` returns, for every input `{text, header}`, exactly csv-reader 1.0.0's answer
`{columns, rows, errors}` — the same broken-row policy, error codes, line/row bookkeeping and width
padding/cutting, bit for bit.

## How solve.js is fast

- One pass over the text with `charCodeAt`; fields are taken out with a single `slice()` — never built a
  character at a time, no per-field objects, no regular expressions.
- The common field (no stray CR) is scanned inline to its end (comma, LF, CRLF, or end of text) and sliced once.
- A quoted field with no doubled quote and no CR inside is also a single slice; doubled quotes and CRs are
  stitched from slices only when they actually occur, and the line counter is tracked on a side variable that is
  discarded if the quote turns out to be unterminated (the reference resets it the same way).
- The rare broken paths — a lone CR inside an unquoted field, junk after a closing quote, an unterminated
  quote's re-read — share one full reader that rebuilds the value from the slices between dropped CRs and reports
  `stray_cr` / `quote_junk` / `unterminated_quote` in exactly the reference's order.
- Nothing is kept from one call to the next.

## Local results (kit practice instance, drawn from drand round 34140941)

- Official local grade (`node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process`):
  `passed = 1`, 6 of 6 cases identical to the reference; the regrade reproduced the outputs byte for byte.
- Differential test against the kit's own `vendor/csv-reader` (the oracle's code): the 6 practice cases, an
  edge battery (unterminated quotes, stray CRs, quote junk, BOM, blank lines, trailing commas, CRLF inside
  quotes, …) under both `header` values, and 4,000 fuzz inputs — 4,144 comparisons, 0 mismatches.
- CPU, whole entry run on the practice set (9 runs each, trimmed mean, this machine): house baseline 2.49 s,
  this entry 1.30 s — **1.9× less CPU end to end** (Welch one-sided t ≈ 15, far past the 95% gate). The parser
  alone is ~6–7× faster than the reference (best of 7: 0.20 s vs 1.43 s for the set); the rest of the run is the
  shared driver (Node start, JSON in/out), identical for both entries.
- The two executions of this entry produce byte-identical `answers.json`, and they also match the baseline's
  own output byte for byte on the practice set.

## Layout

- `main.ts` — the harness driver (the house baseline's, unchanged).
- `solve.js` — the fast reader.
- `package.json` — `{"type": "module"}`.
- `LICENSE` — MIT.
