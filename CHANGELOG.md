# Changelog

All notable changes are documented here. The project uses semantic versioning.

## 0.1.0 — 2026-11-06

### Added

- Local-first Claude Code, Codex and DSH token telemetry.
- Overview, Timeline, Models and Requests views with live incremental refresh.
- English and Chinese UI with persistent language, page, source, window and theme preferences.
- Explicit DSH all-time totals, including cumulative output in `OUTPUT ACTIVITY` without fabricated time-series data.
- Cross-platform compiled CLI with `--help`, `--version`, `--home`, `--cache-dir`, `--rescan`, `--no-live` and `--clear-cache`.
- Per-user cache storage, terminal-control-sequence filtering and atomic cache/preference writes.
- Automated tests, build configuration, package contents, contribution/security documentation and cross-platform CI.

### Known limitations

- Claude Code and Codex request durations are inferred and their TPS values are estimates.
- DSH has session-level history only; no per-request DSH timeline is available.
- Upstream log schemas may change and require adapter updates.
- The primary visual layout targets Unicode true-color terminals at 120 columns or wider.
