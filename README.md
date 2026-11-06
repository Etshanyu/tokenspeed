# Token Speed

**Local-first token telemetry for Claude Code, Codex and DSH — in your terminal.**

Token Speed is a read-only, offline TUI for inspecting output-token usage and throughput. It provides source cards, a shared-scale activity map, model rankings, timelines and request details without uploading session data.

> **Status:** early open-source release (`0.1.x`). Upstream log formats may change. Read the metric definitions below before comparing speeds across tools.

## Screenshots

Real captures of the Python runtime in Windows Terminal; all values come from local telemetry.

![TokenSpeed overview in Windows Terminal](docs/assets/tokenspeed-overview.png)

<details>
<summary>View the model statistics screen</summary>

![TokenSpeed model statistics in Windows Terminal](docs/assets/tokenspeed-models.png)

</details>

## Highlights

- **Local-first:** no network service, account, API key or telemetry upload.
- **Three sources:** Claude Code, Codex and DSH, auto-detected from your home directory.
- **Honest metrics:** estimated request throughput is distinguished from DSH cumulative decode throughput.
- **Four views:** Overview, Timeline, Models and Requests.
- **Live updates:** incremental scans with per-source file watching.
- **English / 中文:** press `L` to switch; your language, theme, page, source and window preferences are remembered.
- **Cross-platform CLI:** Node.js 20+, Windows, macOS and Linux. A Unicode, true-color terminal at least 120 columns wide is recommended.

## Install

### npm

```bash
npm install -g tokenspeed
tokenspeed
```

For a package built from this repository:

```bash
npm ci
npm run build
npm pack
npm install -g ./tokenspeed-0.1.0.tgz
tokenspeed --help
```

### Run from source

```bash
npm ci
npm start
```

Windows users can also run `run-tokenspeed.bat`. It uses the directory containing the script, builds `dist/` when necessary, and applies optional Windows Terminal color/size enhancements.

## Commands

```text
tokenspeed                         open the dashboard
tokenspeed --lang zh               start in Chinese
tokenspeed --page models           open a specific page
tokenspeed --source claude         filter one source
tokenspeed --window 30d            today | 7d | 30d | all
tokenspeed --theme vapor           select a theme by name
tokenspeed --home /path/to/home    override the data-root home
tokenspeed --cache-dir /path/dir   override writable storage
tokenspeed --no-live               disable watch and polling
tokenspeed --rescan                ignore cached records
tokenspeed --clear-cache           delete the record cache, then exit
tokenspeed --help                  full command help
tokenspeed --version               print the version
```

Environment variables:

- `TOKENSPEED_HOME`: home containing `.claude`, `.codex` and `.dsh`.
- `TOKENSPEED_CACHE_DIR`: record-cache and preference directory.
- `TOKENSPEED_DEBUG=1`: print non-fatal scan and preference errors.

## Keys

| Key | Action |
| --- | --- |
| `F1`–`F4` | Overview / Timeline / Models / Requests |
| `Tab`, `Shift+Tab` | Next / previous page |
| `1`–`4` | All / Codex / Claude / DSH (available sources only) |
| `t`, `w`, `a` | Today / cycle window / all time |
| `L` | Switch English / 中文 |
| `←`, `→`, `Enter` | Select model sort column / reverse direction |
| `j`, `k`, `↑`, `↓` | Scroll request rows |
| `g`, `G` | Top / bottom |
| `r` | Rescan |
| `x` | Cycle theme |
| `q`, `Ctrl+C` | Quit |

## Data sources

Token Speed discovers only these adapter-owned locations under the selected home:

| Source | Locations | Available history |
| --- | --- | --- |
| Claude Code | `.claude/projects/**/*.jsonl` | Per-response usage with inferred duration |
| Codex | `.codex/sessions`, `.codex/archived_sessions` | Per-request usage, including `.jsonl.zst` archives |
| DSH | `.dsh/storages/session_projcache/sessions/*.json` | Session-level cumulative totals |

Malformed or partially written records are ignored and retried when the file changes. Token Speed does not modify source logs.

## What the numbers mean

### Claude Code and Codex

- **Output TPS** is `output tokens / inferred active duration`.
- Duration inference is necessarily approximate: upstream logs do not always include exact first-token and decode-complete timestamps.
- Card throughput is aggregate output divided by aggregate inferred duration; `Median` is the median per-request TPS.
- Model `PEAK TPS` is the nearest-rank p95 of valid per-request rates, not a hardware benchmark.
- Time-window charts include request records only.

### DSH

- DSH provides **session totals and cumulative decode duration**, not per-request history.
- DSH TPS is `all-time session output tokens / all-time decode duration`.
- DSH session totals remain visible in bounded windows and are explicitly labeled **All-time**.
- `OUTPUT ACTIVITY` shows the DSH cumulative output with **no time series**. It is counted, but Token Speed does not invent timestamps or distribute tokens across buckets.
- DSH session totals do not enter the activity map, latest-request list, request table or per-request peaks.

See [docs/DATA.md](docs/DATA.md) for cache contents and the data-handling contract.

## Privacy and storage

Token Speed reads local logs and stores derived metadata only; it does not require network access. Cached records can still contain session IDs, project paths, model names, timestamps and token counts, so protect the cache like other local development metadata.

Default writable locations:

- Windows: `%LOCALAPPDATA%\tokenspeed`
- macOS: `~/Library/Caches/tokenspeed`
- Linux: `${XDG_CACHE_HOME:-~/.cache}/tokenspeed`

`index.json` contains derived records. `preferences.json` contains only UI preferences. Use `tokenspeed --clear-cache` to remove the record index; preferences are preserved. Remove the directory yourself to delete both.

No prompts, completions or source-code contents are intentionally included in derived records. Do not commit real logs, caches or unredacted screenshots.

## Troubleshooting

### No source cards appear

Check that the selected home contains one of the documented source directories, or pass `--home`. Then run `tokenspeed --rescan`.

### Keys do not respond

Use a real interactive terminal rather than redirected output. On Windows, Windows Terminal is recommended. `F1`–`F4` and `1`–`4` have different functions: F-keys switch pages; digits select sources.

### Layout wraps or colors look wrong

Use at least 120 columns (120 × 47 is the tested desktop layout), a Unicode font and a true-color terminal. Narrow layouts degrade some labels but are not the primary design target.

### Numbers changed after an upgrade

Upstream formats and metric semantics can change. Run `--rescan`, check the version and consult `CHANGELOG.md`. Never compare estimated request TPS directly with DSH cumulative decode TPS as if they were the same measurement.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run bench
npm pack --dry-run
```

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports are covered by [SECURITY.md](SECURITY.md).

## 中文快速开始

```bash
npm install -g tokenspeed
tokenspeed --lang zh
```

在程序内按 `L` 切换中英文。DSH 会显示全部会话累计输出，但由于没有逐请求时间序列，不会生成活动曲线；这不是漏统计。其他快捷键、缓存目录和数据口径见上文。

## License and attribution

[MIT](LICENSE) © Token Speed contributors.

Token Speed is an independent, unofficial project. Claude, Codex and DSH names belong to their respective owners; no affiliation or endorsement is implied.
