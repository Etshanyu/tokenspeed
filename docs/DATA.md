# Data and privacy contract

## Read-only source access

Token Speed scans adapter-owned Claude Code, Codex and DSH locations under the selected home. It does not intentionally modify those logs. Use `--home` or `TOKENSPEED_HOME` to select a different root.

## Derived record fields

The record cache stores source, session ID, project identifier/path, model, timestamp, input/output/cache/reasoning token counts and inferred or cumulative duration. DSH session records additionally carry a request count and a `session` marker.

Prompts, completions and source-code contents are not intentionally copied into derived records. Cached metadata may still be sensitive.

## Cache and preferences

`index.json` is a versioned derived-record cache keyed by source path, file modification time and size. Invalid or old-version caches are ignored. Writes use a temporary file followed by rename.

`preferences.json` stores only page, source filter, time window, theme index and language. Invalid fields are discarded. Both files live in a per-user writable directory, never inside the installed package.

`tokenspeed --clear-cache` removes only `index.json`. Delete the cache directory to remove preferences as well. Set `--cache-dir` or `TOKENSPEED_CACHE_DIR` for portable or isolated storage.

## Timing and aggregation rules

- Claude Code and Codex request TPS is estimated from output tokens and inferred active duration.
- Invalid or non-positive durations do not produce meaningful per-request peaks.
- Bounded windows include request records only.
- DSH session totals are all-time values and use cumulative decode duration.
- DSH totals are not distributed over activity buckets and do not become synthetic requests.
- `OUTPUT ACTIVITY` displays cumulative DSH output separately with a no-time-series label.
- All-time model aggregation can include session totals; per-request peaks still use request records only.

## Terminal safety

Model names, session identifiers and other log-derived strings must be treated as untrusted terminal text. Table and fitted-cell rendering strips ANSI/OSC control sequences and control characters. Preserve this filtering when adding new views.

## Fixture policy

Tests and documentation must use synthetic or fully anonymized data. Do not commit `.data`, real session logs, private project names, credentials, prompts or unredacted terminal captures.
