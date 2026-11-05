# TOKEN SPEED · observatory 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复刻截图风格的本地 token 遥测终端 TUI —— 解析 Claude Code / Codex / DSH 三来源真实会话数据，展示吞吐量、活动热力、模型速度、会话与请求明细，支持时间窗/来源筛选与 LIVE 增量刷新。

**Architecture:** 可插拔 SourceAdapter（discover/parse → 统一 TurnRecord）→ 增量索引器（mtime+size 缓存）→ 纯函数聚合层 → Ink React TUI（四页面 + 全局键盘外壳）。UI 不感知具体来源，遍历 ADAPTERS 注册表渲染。

**Tech Stack:** Node ≥20 ESM + TypeScript strict（tsx 直跑、无构建）、Ink 5 + React 18、ink-gradient/ink-big-text/ink-spinner、fzstd、string-width；测试 node:test + ink-testing-library。

**Spec:** `docs/superpowers/specs/2026-11-05-tokenspeed-design.md`（本计划从 spec 立论，执行者两份都要读）

## Global Constraints

- 项目根：`C:\Users\Administrator\Desktop\developer\console\tokenspeed\`；Task 1 内 `git init`
- 依赖白名单（运行时）：`ink@^5 react@^18 ink-gradient ink-big-text ink-spinner fzstd string-width`；（开发）：`tsx typescript @types/react @types/node ink-testing-library`。不得新增
- Node ESM（`"type":"module"`）、TS strict、无构建步骤；`npm start` = `tsx src/main.tsx`
- 字形只用 Unicode 标准块（▁▂▃▄▅▆▇█ ░▒▓ ─│┌┐└┘ ▏▎▍▌▋▊▉ █ ▀▄ ●○），禁止 Nerd Font 私有区
- durMs 全部 clamp 到 (0, 600000] ms，异常兜底 1000ms；ΣdurMs=0 时 tps=null 显示 `—`，禁止 NaN/Infinity
- 所有适配器以 `root: string`（用户主目录）为参数，禁止模块级 `os.homedir()`；测试用临时目录注入
- 对源数据目录只读；缓存写 `.data/index.json`（gitignore），带 `version` 字段，不匹配即重建；写入用 tmp+rename 原子替换
- UI 文案英文（与截图一致：TOKEN SPEED / ACTIVITY MAP / MODEL VELOCITY / LATEST ACTIVITY…）
- avg tok/s ≡ ΣoutTok / ΣdurMs × 1000（spec 口径，含首字等待，界面角落标注 `~ estimated`）
- 目标终端 Windows Terminal（truecolor）；Windows 合理路径处理（正斜杠/反斜杠都接受）
- 每个任务一次 commit，消息以 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾

## Review Focus

1. **Claude 重复分片**：同 message.id 多分片 usage 为累计重复值 —— 求和会把总量虚增 ~2 倍。→ Task 3 测试 `dedups multi-fragment responses`
2. **残缺/畸形行**（LIVE 写入中半行、坏 JSON、空行）：解析器必须跳过不崩溃。→ Task 3 `tolerates partial trailing line`、Task 4 `skips malformed lines`
3. **空窗口/零时长**（ΣdurMs=0、无记录）：tps 显示 `—`，卡片显示 0，不渲染 NaN。→ Task 7 `returns null tps on zero duration` + Task 11 `renders zeros without NaN`
4. **CJK 双宽字符**（项目路径含中文）表格错位：displayWidth/truncate 必须按显示宽度。→ Task 2 `measures CJK as width 2` + Task 9 `table truncates CJK to column width`
5. **时长锚点越界**（锚点晚于首分片/间隔>10min 的时钟错乱）：clamp 到 (0,600000]，兜底 1000。→ Task 3 `clamps out-of-range durations` + Task 4 `clamps inter-record gaps`

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/main.tsx`

**Interfaces:**
- Produces: npm scripts `start`=`tsx src/main.tsx`、`test`=`node --import tsx --test src/`、`typecheck`=`tsc --noEmit`；git 仓库

- [ ] **Step 1: 初始化项目**

`package.json`：name `tokenspeed`、`"type":"module"`、`"private":true`、bin 字段 `{"tokenspeed":"src/main.tsx"}`；依赖按 Global Constraints 白名单装齐（ink@^5 系 + dev）。`tsconfig.json`：`strict`、`jsx:"react-jsx"`、`module:"preserve"`、`moduleResolution:"bundler"`、`target:"ES2022"`、`noEmit:true`、`types:["node"]`。`.gitignore`：`node_modules/ .data/ *.log`。

`src/main.tsx` 临时内容：用 Ink 渲染 `<Text color="cyan">TOKEN SPEED boot…</Text>`，3 秒后 exit。

- [ ] **Step 2: 验证三条命令**

Run: `npm install && npm start`（输出含 TOKEN SPEED）；`npm run typecheck`（0 错误）；`npm test`（发现 0 个测试文件、退出码 0——无测试时 node --test 对空也通过；若非 0，把 test 脚本改为 `node --import tsx --test src/**/*.test.ts` 再验）

- [ ] **Step 3: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold tokenspeed (ink + tsx + node:test)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 核心类型 + 格式化工具

**Files:**
- Create: `src/sources/types.ts`, `src/util/fmt.ts`
- Test: `src/util/fmt.test.ts`

**Interfaces:**
- Produces（后续所有任务消费）:

```ts
// types.ts
export type SourceId = string;
export interface FileEntry { path: string; mtimeMs: number; size: number; }
export interface TurnRecord {
  src: SourceId; sid: string; proj: string; ts: number; model: string;
  inTok: number; cacheRead: number; cacheWrite: number;
  outTok: number; reasonTok: number; durMs: number;
}
export interface SourceAdapter {
  id: SourceId; label: string; color: string;          // color: hex 如 "#22d3ee"
  available(root: string): boolean;
  discover(root: string): FileEntry[];
  parse(root: string, file: FileEntry): TurnRecord[];
}
```

```ts
// fmt.ts
export function fmtTok(n: number): string;            // 999→"999" 1_000..999_999→"1.2k"→M→B，1 位小数去尾 0
export function fmtDur(ms: number): string;           // <60s→"42s" <1h→"12m34s" <24h→"3.5h"→"2d4h"
export function fmtTps(x: number | null): string;     // null→"—" <100 保留 1 位小数 ≥100 取整
export function fmtPct(x: number): string;            // 0.925→"92.5%"
export function displayWidth(s: string): number;      // 基于 string-width
export function truncateToWidth(s: string, w: number): string;  // 超宽截断加 "…"，结果 displayWidth ≤ w
export function projShort(proj: string): string;      // "C--Users-x-Desktop-developer-console"→"console"；无 "-" 原样
export function sidShort(sid: string): string;        // uuid→前 8 位
```

- [ ] **Step 1: 写失败测试** `src/util/fmt.test.ts`：`fmtTok(999)==="999"`、`fmtTok(1234)==="1.2k"`、`fmtTok(2_500_000_000)==="2.5B"`；`fmtDur(87_000)==="1m27s"`；`fmtTps(null)==="—"`、`fmtTps(52.66)==="52.7"`、`fmtTps(161.7)==="162"`；`fmtPct(0.925)==="92.5%"`；**`displayWidth("中文ab")==="4".length===4`**（Review Focus 4）；`truncateToWidth("中文六字路径", 5)` 宽度 ≤5 且以 `…` 结尾；`projShort`/`sidShort` 各 2 断言。
- [ ] **Step 2: 跑测试确认失败**：`npm test` → FAIL（模块不存在）
- [ ] **Step 3: 实现 types.ts + fmt.ts**（fmtTok 用 `n>=1e9?'B':n>=1e6?'M':n>=1e3?'k':''` 分档；`displayWidth` 直接 `stringWidth`）
- [ ] **Step 4: 跑测试确认通过 + typecheck**
- [ ] **Step 5: Commit** `feat: core types and display formatting`

---

### Task 3: Claude 适配器

**Files:**
- Create: `src/sources/claude.ts`
- Test: `src/sources/claude.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `FileEntry/TurnRecord/SourceAdapter`
- Produces: `export const claudeAdapter: SourceAdapter`（`id:"claude"`, `label:"CLAUDE"`, `color:"#22d3ee"`）

数据形状（全部实测确认，fixture 按此造）：
- 发现路径：`<root>/.claude/projects/<projDir>/<sid>.jsonl` 与 `<projDir>/<parentSid>/subagents/<subSid>.jsonl`（subagent 记录 `sid` 折叠为 parentSid、proj 同父）
- 分片聚合键：`message.id`（形如 `msg_...`）；usage 累计重复 → 取任一分片（实现取最后见到的）
- 耗时锚点（优先级）：① 精确 join：`type:"api-request"` 行 `{id}` == assistant 行顶层 `requestRef` → dur = 首分片 ts − api-request.timestamp；② 兜底：首分片出现时刻已记录的最近 `type:"user"` 行 ts；③ 末选：同文件上一组末分片 ts。全部 clamp (0,600000]，否则 1000
- 剔除 `message.model === "<synthetic>"`；`type:"user"` 行（含 tool_result）只用于锚点；坏 JSON/空行/残缺尾行跳过
- tokens：`message.usage.{input_tokens→inTok, cache_read_input_tokens→cacheRead, cache_creation_input_tokens→cacheWrite, output_tokens→outTok, output_tokens_details.thinking_tokens→reasonTok(缺省0)}`

- [ ] **Step 1: 写失败测试**（fixture 用模板字符串写进 `os.tmpdir()` 临时目录，`beforeEach` 建目录 `afterEach` 清理；timestamp 全用可控 ISO 串）。用例：
  - `dedups multi-fragment responses`（Review Focus 1）：3 分片同 message.id、usage 相同 out=100 → 1 条记录 outTok=100
  - `joins api-request by requestRef`：api-request(id=A, ts=T0) + 助手行 requestRef=A 首分片 T0+12s → durMs≈12000
  - `falls back to preceding user line`：无 api-request，user@T0 → 首分片 T0+8s → durMs≈8000
  - `falls back to previous response gap`：无 user 锚点 → 上一组末分片锚点
  - `clamps out-of-range durations`（Review Focus 5）：锚点在首分片之后（dur≤0）→ 1000；锚点 20min 前 → 600000
  - `drops synthetic assistant rows`：model `<synthetic>` 不产记录
  - `folds subagent files into parent session`：`<proj>/<parent>/subagents/sub.jsonl` → 记录 sid=parent
  - `tolerates partial trailing line`（Review Focus 2）：文件尾半行 JSON 后仍产出前面完整记录
  - `discovers nested jsonl files`：discover 返回两种路径形态
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现 claude.ts**：`fs.createReadStream`+`readline` 流式单遍；Map<msgId,{firstTs,anchorCandidates…}> 按需快照锚点（首分片到达时锁定 max(apiReqTs?, userTs, prevGroupTs)——api-request join 精确匹配优先），EOF 冲账；projDir 取路径段、`projShort` 规则同 Task 2
- [ ] **Step 4: 跑测试确认通过 + typecheck**
- [ ] **Step 5: Commit** `feat: claude source adapter with honest duration estimation`

---

### Task 4: Codex 适配器

**Files:**
- Create: `src/sources/codex.ts`
- Test: `src/sources/codex.test.ts`

**Interfaces:**
- Produces: `export const codexAdapter: SourceAdapter`（`id:"codex"`, `label:"CODEX"`, `color:"#f59e0b"`）

数据形状（实测确认）：
- 发现：`<root>/.codex/sessions/**/*.jsonl`、`<root>/.codex/sessions/**/*.jsonl.zst`、`<root>/.codex/archived_sessions/*.jsonl(.zst)`
- 记录行：`type:"token_usage_record"`，`payload.{thread_id→sid, turn_id, usage}`，外层 `timestamp`
- `payload.usage`（逐响应）：`input_tokens`（含 cached）→ inTok=`input−cached`；`cached_input_tokens→cacheRead`；`cache_write_input_tokens→cacheWrite`；`output_tokens→outTok`；`reasoning_output_tokens→reasonTok`。**禁用** `turn_token_usage`/`thread_token_usage`（累计值）
- 模型：`type:"turn_context"` 行 `payload.{turn_id, model}` 建 turn→model 映射，找不到沿用最近已知，再不行 `"unknown"`
- proj：`type:"session_meta"` 的 `payload.cwd`（无则 `""`）；ts=行 timestamp
- 耗时（单响应口径）：本条 ts − 同 thread_id 上一条 record ts；首条/越界回退同 turn `task_started` ts（`payload.turn_id` 对应）；clamp (0,600000] 否则 1000
- zst：`fzstd.decompress(fs.readFileSync(path))` 再按行拆

- [ ] **Step 1: 写失败测试**（临时目录 fixture，明文 JSONL）。用例：
  - `parses per-response usage`：inTok=input−cached 断言、cacheRead/cacheWrite/reasonTok 各断言
  - `computes duration from previous record in thread`：同 thread 两条相隔 5s → 第二条 durMs=5000；跨 thread 不串
  - `clamps inter-record gaps`（Review Focus 5）：间隔 20min → 600000；首条回退 task_started 锚
  - `joins model from turn_context`：record 继承同 turn 模型；未知模型行 → 最近已知
  - `skips malformed lines`（Review Focus 2）：坏行/空行/残缺尾行不炸
  - `reads zst archives`：`zlib.zstdCompressSync` 存在则现场压缩 fixture 生成 .zst 断言解析等价；不存在则 `t.skip("node zlib zstd unavailable")`
  - `never reads cumulative usage fields`：构造含 `turn_token_usage` 的行断言不产记录
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现 codex.ts**（zlib 判断仅测试用；zst 与明文统一走 `readEntries(path): string[]`）
- [ ] **Step 4: 跑测试确认通过 + typecheck**
- [ ] **Step 5: Commit** `feat: codex source adapter (plain + zst archives)`

---

### Task 5: DSH 适配器 + 注册表

**Files:**
- Create: `src/sources/dsh.ts`, `src/sources/index.ts`
- Test: `src/sources/dsh.test.ts`, `src/sources/index.test.ts`

**Interfaces:**
- Produces:

```ts
// dsh.ts
export const dshAdapter: SourceAdapter;   // id:"dsh", label:"DSH", color:"#f472b6"
// sources/index.ts
export const ADAPTERS: SourceAdapter[] = [codexAdapter, claudeAdapter, dshAdapter]; // 截图顺序
export function filterKeys(adapters: SourceAdapter[]): { key: string; src: SourceId | 'all' }[];
// → [{key:'1',src:'all'},{key:'2',src:'codex'},{key:'3',src:'claude'},{key:'4',src:'dsh'}]（与截图一致，顺序随注册表）
```

DSH 数据形状（实测）：`<root>/.dsh/storages/session_projcache/sessions/*.json` →
`record.identity.{createdAt→ts, cwd→proj}`；`record.rows.tokenUsage.val.totals.{uncachedInputTokens→inTok, cacheReadTokens→cacheRead, cacheWriteTokens→cacheWrite, outputTokens→outTok}`；`record.rows.sessionStats.val.{decodeMs→durMs（0 或缺失回退 llmMs）}`；`record.rows.modelSelection.val.lastUsed.model`（缺省 `"deepseek"`）；`sid`=文件名去 `session-` 前缀；`reasonTok=0`。一文件一记录。

- [ ] **Step 1: 写失败测试**：dsh —— 完整 fixture 断言全字段 + decodeMs 缺失回退 llmMs + 模型缺省 + 坏 JSON 跳过；index —— `filterKeys` 顺序断言、`available()` 以目录存在为准（临时目录造 `.codex/` 存在、`.dsh/` 不存在 → dsh unavailable）
- [ ] **Step 2: 确认失败** → **Step 3: 实现** → **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: dsh adapter + pluggable source registry`

---

### Task 6: 增量索引器

**Files:**
- Create: `src/scan/indexer.ts`
- Test: `src/scan/indexer.test.ts`

**Interfaces:**
- Produces:

```ts
export const CACHE_VERSION = 1;
export interface IndexStore { version: number; files: Record<string, { mtimeMs: number; size: number; records: TurnRecord[] }>; }
export interface ScanResult { records: TurnRecord[]; scanned: number; fromCache: number; }
export function loadCache(cachePath: string): IndexStore | null;   // 缺失/损坏/version 不符 → null
export function scanAll(opts: { adapters: SourceAdapter[]; root: string; cache: IndexStore | null; onProgress?: (p: { done: number; total: number; file: string }) => void }): { store: IndexStore; result: ScanResult };
// mtime+size 未变 → 用缓存；变了/新文件 → 重解析；已删文件 → 移出 store
export function saveCache(cachePath: string, store: IndexStore): void;  // tmp+rename
```

- [ ] **Step 1: 写失败测试**（临时目录 + 内联 fake adapter：按文件内容产固定记录）。用例：首扫全量（scanned=total）；二扫零重扫（fromCache=total）；改 mtime+内容 → 只重扫该文件且记录更新；删文件 → 记录消失；`loadCache` 吃坏 JSON → null；`saveCache` 后 `loadCache` 回读等价；version 不符 → null
- [ ] **Step 2: 确认失败** → **Step 3: 实现**（路径为 store 键；解析异常 try/catch 单文件跳过）→ **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: incremental scan index with mtime+size cache`

---

### Task 7: 聚合指标

**Files:**
- Create: `src/agg/metrics.ts`
- Test: `src/agg/metrics.test.ts`

**Interfaces:**
- Produces:

```ts
export type WindowKey = 'today' | '7d' | '30d' | 'all';
export function windowRange(w: WindowKey, now: number): { from: number; to: number }; // today=本地零点
export function applyFilters(records: TurnRecord[], src: SourceId | 'all', range: { from: number; to: number }): TurnRecord[];
export interface SourceSummary { src: SourceId; avgTps: number | null; inTok: number; outTok: number; cacheRead: number; reqs: number; sessions: number; activeMs: number; spark: number[]; }
export function sourceSummaries(records: TurnRecord[], sparkBuckets?: number): SourceSummary[]; // 按 src 分组 + spark=按时间均分桶的 outTok；Σdur=0 → avgTps=null（Review Focus 3）
export interface Bucket { t0: number; out: Record<SourceId, number>; in: Record<SourceId, number>; }
export function buckets(records: TurnRecord[], range: { from: number; to: number }, n: number): Bucket[];
export interface ModelRow { model: string; srcs: SourceId[]; reqs: number; inTok: number; outTok: number; cacheRead: number; avgTps: number | null; peakTps: number | null; share: number; } // share 按 outTok 占比
export function modelStats(records: TurnRecord[]): ModelRow[];   // outTok 降序；peakTps=单条 tps 的 p95
export interface SessionRow { sid: string; src: SourceId; proj: string; lastTs: number; outTok: number; totalTok: number; reqs: number; avgTps: number | null; }
export function latestSessions(records: TurnRecord[], n: number): SessionRow[]; // lastTs 降序
```

- [ ] **Step 1: 写失败测试**：手工构造 6-8 条混合 records 断言每个函数（含：`Σdur=0 → avgTps null`（Review Focus 3）、today 本地零点边界、share 求和=1、p95 手算值、空数组输入 → 各函数返回空数组/null 不炸）
- [ ] **Step 2: 确认失败** → **Step 3: 实现**（p95 用最近秩法：`arr[Math.min(len-1, Math.ceil(0.95*len)-1)]`）→ **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: aggregation metrics (summaries, buckets, models, sessions)`

---

### Task 8: 字符图表组件（纯函数）

**Files:**
- Create: `src/ui/comp/chart.ts`
- Test: `src/ui/comp/chart.test.ts`

**Interfaces:**
- Produces:

```ts
export function sparkline(values: number[], width: number): string;      // ▁▂▃▄▅▆▇ 8 级，恒定 displayWidth=width
export function heatStrip(values: number[], width: number, colors: string[]): string; // 重采样到 width 列，强度→colors[i] 的 ░▒▓█（返回带 ANSI 色码的串）
export function gaugeBar(value: number, max: number, width: number, fill: string, track: string): string; // value/max 比例填充，NaN/max≤0 → 全 track
export function histogram(series: { values: number[]; color: string }[], width: number, height: number): string[]; // 分组柱：每桶各系列相邻半列，▀▄█ 叠高出 height 行字符串，按行返回（顶行在 index 0）
```

- [ ] **Step 1: 写失败测试**：`sparkline` 长度=width（values 多于/少于 width 两种重采样）、全 0 → 全 `▁`；`heatStrip` 输出 strip ANSI 后字符数=width；`gaugeBar(5,10,10,…) → fill×5+track×5`、max=0 → 全 track；`histogram` 返回 height 行、每行等宽、单调数据左低右高（顶行右侧有块左侧无）
- [ ] **Step 2: 确认失败** → **Step 3: 实现**（重采样用线性插值桶均值；ANSI truecolor `\x1b[38;2;r;g;bm`）→ **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: unicode chart primitives (sparkline, heatstrip, gauge, histogram)`

---

### Task 9: 主题 + 表格组件

**Files:**
- Create: `src/theme.ts`, `src/ui/comp/Table.tsx`
- Test: `src/ui/comp/Table.test.tsx`

**Interfaces:**
- Produces:

```ts
// theme.ts
export interface Theme { name: string; bg: string; panel: string; border: string; text: string; dim: string; accent: string; gradFrom: string; gradTo: string; srcColors: Record<SourceId, string>; heat: string[]; }
export const THEMES: Theme[];  // [0]="observatory"（截图配色：bg #0a0e14 panel #11151c border #2b3648 text #c9d1d9 dim #6b7280 accent #22d3ee grad #22d3ee→#f472b6 src codex #f59e0b claude #22d3ee dsh #f472b6 heat 10 级由暗青到亮青）[1]="ember" [2]="vapor"（实现者自选但字段全）
// Table.tsx
export interface Column<T> { key: string; header: string; width: number; align?: 'l' | 'r'; render: (row: T, idx: number) => string; color?: (row: T) => string | undefined; }
export function Table<T>(props: { columns: Column<T>[]; rows: T[]; scroll?: number; visible?: number; headerColor?: string; dim?: string }): React.ReactElement;
```

- [ ] **Step 1: 写失败测试**（ink-testing-library `render` 后 `lastFrame()` 断言子串）：表头渲染；右对齐列；`scroll` 窗口位移；**`table truncates CJK to column width`**（Review Focus 4：中文 render 值宽于列宽 → lastFrame 行内不该出现完整串且含 `…`）；空 rows → 仅表头
- [ ] **Step 2: 确认失败** → **Step 3: 实现**（单元格 `truncateToWidth`+pad；行用 `<Text>`，色码经 `<Text color>`）→ **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: themes and width-safe table component`

---

### Task 10: App 外壳 —— 键盘、Banner、路由、状态栏

**Files:**
- Create: `src/ui/keys.ts`, `src/ui/App.tsx`
- Test: `src/ui/keys.test.ts`, `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: `ADAPTERS`、`filterKeys`（Task 5）、`THEMES`（Task 9）
- Produces:

```ts
// keys.ts —— Ink useInput 不支持 F 键，自建解析（纯函数可测）
export type KeyAction =
  | { t: 'page'; p: 'overview' | 'timeline' | 'models' | 'requests' }
  | { t: 'src'; key: string } | { t: 'win'; w: WindowKey } | { t: 'winCycle' }
  | { t: 'theme' } | { t: 'refresh' } | { t: 'quit' } | { t: 'tab' } | { t: 'tabBack' }
  | { t: 'up' } | { t: 'down' } | { t: 'top' } | { t: 'bottom' } | { t: 'left' } | { t: 'right' } | { t: 'enter' };
export function parseKey(buf: string): KeyAction | null;
// 数字 '1'..'9'→src（filterKeys 顺序）；'t'→today、'w'→winCycle(today→7d→30d→all 循环，App 层解析)、'a'→win all；F1-F4='\x1bOP','\x1bOQ','\x1bOR','\x1bOS' 及 '\x1b[11~'..'\x1b[14~'→page；'\t'/'\x1b[Z'→tab/tabBack；'g'→top,'G'→bottom；'j','k'→down/up；'\x1b[A..D'→上下左右；'r'→refresh；'x'→theme；'\x03'(ctrl-c),'q'→quit
// App.tsx
export interface AppProps { records: TurnRecord[]; scan?: { done: number; total: number } | null; live?: boolean; lastRefresh?: number; booting?: boolean; now?: number; }
```

App 职责：内部 useState 保存 page/srcFilter/win/themeIdx/scroll/排序态；`useEffect` 挂 `process.stdin.on('data')`（Ink 已 raw mode）→ `parseKey` → dispatch；布局：Banner（`ink-big-text` "TOKEN SPEED" + `ink-gradient`（终端宽 <90 或非 truecolor 降级为 accent 色纯文本）+ 副标题 `observatory · codex + claude + dsh` + 右侧 LIVE 呼吸点（ink-spinner dots + ●/○）+ `node · v0.1.0` + 时钟）；导航行 `[F1] Overview …` 当前页反色；筛选行（filterKeys 动态数字键 + 当前值高亮）；`{children 页面}`；底部状态栏（快捷键提示 + `~ estimated` 标注 + 扫描/缓存状态）。页面组件本任务先占位（`<Text>WIP</Text>`）。

- [ ] **Step 1: 写失败测试**：keys —— 上表每类至少 1 断言（含 F 键两种序列、`'w'`→winCycle、数字 `'3'`→src 而非窗口、`'q'` 与 `'\x03'` 均 quit）；App —— render `<App records={[]} />` lastFrame 含 `TOKEN SPEED`、`[F1] Overview`、`LIVE`；占位页切换无法测 UI 就跳过（keys 已覆盖）
- [ ] **Step 2: 确认失败** → **Step 3: 实现 keys.ts + App.tsx** → **Step 4: 通过 + typecheck + `npm start` 手跑 3 秒看渲染不崩**
- [ ] **Step 5: Commit** `feat: app shell - keymap, banner, nav, status bar`

---

### Task 11: Overview 页

**Files:**
- Create: `src/ui/Overview.tsx`
- Test: `src/ui/Overview.test.tsx`

**Interfaces:**
- Consumes: Task 7 全部、Task 8 图元、Task 9 Table、Task 2 fmt、`ADAPTERS`（卡片顺序=注册表，只渲染 `available` 或有记录的来源）
- Produces: `export function Overview(props: { records: TurnRecord[]; now: number; theme: Theme; srcFilter: SourceId | 'all' }): React.ReactElement`

布局（复刻截图）：① 来源卡片行（CODEX/CLAUDE/DSH + 首位 ALL 汇总卡）：主题色圆角边框、大数字 `fmtTps(avgTps)` + ` tok/s`（数值变化时 300ms 补间滚动动画：本地 state + setTimeout 链，卸载即停）、`Σ ${fmtTok(outTok)} out · ${fmtDur(activeMs)} active`、`${fmtTok(totalTok)} tok · ${reqs} reqs`、底部 sparkline；② `ACTIVITY MAP`：每来源一行 `label + heatStrip(out buckets, width, theme.heat)` + 首尾时间刻度；③ `MODEL VELOCITY`：top 5 模型 `model名 + gaugeBar(avgTps, max, 30) + fmtTps`；④ `OUTPUT ACTIVITY`：histogram 双系列（按 srcFilter/ALL 着 srcColors）height 6；⑤ `LATEST ACTIVITY`：Table（TIME/SRC/PROJECT/MODEL/OUT/AVG TKS/REQS，最新 8 会话，24h 内 lastTs 显示青色时间）。宽度自适应 `useStdout().columns`。

- [ ] **Step 1: 写失败测试**：fixture records（3 来源各 2-3 条）→ lastFrame 含 `CLAUDE`、`CODEX`、`DSH`、`tok/s`、`ACTIVITY MAP`、`MODEL VELOCITY`、`LATEST ACTIVITY`；**`renders zeros without NaN`（Review Focus 3）：records=[] → 含 `—` 不含 `NaN`/`Infinity`**
- [ ] **Step 2: 确认失败** → **Step 3: 实现**（全部数据经 Task 7 函数，组件无自算聚合）→ **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: overview page - cards, activity map, model velocity`

---

### Task 12: Timeline 页

**Files:**
- Create: `src/ui/Timeline.tsx`
- Test: `src/ui/Timeline.test.tsx`

**Interfaces:**
- Produces: `export function Timeline(props: { records: TurnRecord[]; now: number; theme: Theme; srcFilter: SourceId | 'all' }): React.ReactElement`

窗口桶数：today→24（小时）、7d→28（6h）、30d→30（日）、all→min(40, 活跃天数)。渲染：`TIMELINE` 标题 + 窗口说明；主图 histogram（out 按来源着色，height 8）+ 顶行移动均值折线（5 桶 MA，`·` 标记，accent 色）；下方摘要行 `Σ out/in/cache · peak bucket 时间与量`；空数据态 `no activity in window`。

- [ ] **Step 1: 写失败测试**：7 天 fixture → lastFrame 含 `TIMELINE`、桶标签（首尾日期）、`peak`；空 → `no activity`
- [ ] **Step 2: 确认失败** → **Step 3: 实现** → **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: timeline page with bucketed histogram`

---

### Task 13: Models 页

**Files:**
- Create: `src/ui/Models.tsx`
- Test: `src/ui/Models.test.tsx`

**Interfaces:**
- Produces: `export function Models(props: { records: TurnRecord[]; now: number; theme: Theme; sort: { col: number; dir: 1 | -1 }; onSort: (col: number) => void }): React.ReactElement`（App 传键盘 ←/→/enter 的排序态）

Table 列：MODEL/SRC/REQS/IN/OUT/CACHE/AVG TKS/PEAK/SHARE（share 附 gaugeBar 迷你条）；默认 OUT 降序；←/→ 换列 enter 翻转（App 层状态，本组件纯展示）。

- [ ] **Step 1: 写失败测试**：fixture → lastFrame 含 `MODELS`、模型名、`92.5%` 类 share 值；空 → `no models`
- [ ] **Step 2: 确认失败** → **Step 3: 实现** → **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: models page with sortable stats table`

---

### Task 14: Requests 页

**Files:**
- Create: `src/ui/Requests.tsx`
- Test: `src/ui/Requests.test.tsx`

**Interfaces:**
- Produces: `export function Requests(props: { records: TurnRecord[]; now: number; theme: Theme; srcFilter: SourceId | 'all'; scroll: number }): React.ReactElement`（ts 降序全量行，App 传 scroll 窗口；j/k/g/G/箭头在 App 层）

列：TIME/SRC/MODEL/OUT/DUR/TOK·S/SESSION；模型超宽 truncate；底部 `showing X-Y of N · j/k scroll`。

- [ ] **Step 1: 写失败测试**：12 条 fixture、visible 10、scroll 2 → lastFrame 含第 3-12 条时间、不含第 1 条；`showing 3-12 of 12`
- [ ] **Step 2: 确认失败** → **Step 3: 实现** → **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: requests page with scrollable response stream`

---

### Task 15: LIVE 监听 + main 入口 + CLI + 启动流程

**Files:**
- Create: `src/scan/watcher.ts`, `src/main.tsx`（重写 Task 1 占位）
- Test: `src/scan/watcher.test.ts`, `src/main.test.ts`

**Interfaces:**
- Consumes: 全部前序
- Produces:

```ts
// watcher.ts
export function startWatch(dirs: string[], onDirty: () => void, opts?: { pollMs?: number }): () => void;
// fs.watch recursive:true（Windows 支持），异常回退 pollMs(默认 5000) 扫 mtime；事件 300ms 去抖；返回 stop()
// main.tsx —— CLI: --source=<id> --window=<today|7d|30d|all> --no-live --rescan --theme=<n>
// root = process.env.TOKENSPEED_HOME ?? os.homedir()；cachePath = <项目>/.data/index.json
```

main 流程：parseArgs（util.parseArgs）→ loadCache → 若空/rescan：渲染 Boot 屏（spinner + `scanning ${done}/${total}` + gaugeBar 进度 + 渐变 logo）→ scanAll(onProgress) → saveCache → 换 App；LIVE（未 --no-live）：`startWatch` 各 adapter 根目录 + 每 5s 兜底 poll → 增量 scanAll → setState 新 records；`r` 键手动重扫；退出时 restore cursor + exit。

- [ ] **Step 1: 写失败测试**：watcher —— 临时目录建文件触发 onDirty（await 至多 2s）、stop() 后不再触发；main —— 环境变量 `TOKENSPEED_HOME` 指向 fixture 目录（含 1 个假 `.claude/projects/x/y.jsonl`）→ 调 `buildRuntime({root, cacheDir})`（从 main.tsx 导出的纯装配函数，便于测试；真正的 render 在 `if (import.meta.url === pathToFileURL(process.argv[1]).href)` 守卫内）→ 断言 scanResult.records.length>0、缓存文件生成、二次调用 fromCache=1
- [ ] **Step 2: 确认失败** → **Step 3: 实现** → **Step 4: 通过 + typecheck**
- [ ] **Step 5: Commit** `feat: live watcher, CLI entry, boot progress flow`

---

### Task 16: 真机验收

**Files:**
- Modify: 发现问题对应的源文件

**Interfaces:**
- Consumes: 全部；真实数据

- [ ] **Step 1: 真机冷启动**：删除 `.data/` 后 `npm start` —— 记录扫描文件总数（预期 ≈ 107+123+174 zst 中 codex 297 + claude 107 + dsh 11 ≈ 415）、Boot 进度条可见、完成后 Overview 三卡片有真实数字
- [ ] **Step 2: 数字抽查**：用独立 Python 脚本抽算 1 个 Claude 会话的 ΣoutTok 与 Requests 页对应值一致（允许末分片取值口径误差 <1%）；Codex 记录总数 > 仅明文 .jsonl 会话数（证明 zst 生效）
- [ ] **Step 3: 性能与 LIVE**：二次启动计时 <2s；开着 TUI 在任意项目里跑一条 Claude 命令 → 5s 内 LATEST ACTIVITY 出现新会话（LIVE 点亮）
- [ ] **Step 4: 可扩展性验收（spec 验收清单第 3 条）**：临时在 `sources/index.ts` 注册一个返回固定 2 条记录的 `kimiStub` 适配器 → 启动后 Overview 出现第 4 张 KIMI 卡片、筛选行出现新数字键、热力条多一行 → 移除 stub 恢复三来源并 commit（stub 不入库）
- [ ] **Step 5: 乱码与布局**：Windows Terminal 默认字体全页无 `?`/错位（重点 CJK 项目路径行、直方图行宽）；窗口拉宽/缩窄不崩
- [ ] **Step 6: 修复发现的问题（每修一处补一条测试）并 commit** `feat: real-machine acceptance fixes`；全部通过后 commit `docs: mark acceptance checklist done`（spec 验收清单勾选）
