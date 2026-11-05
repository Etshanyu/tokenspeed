# TOKEN SPEED · observatory — 设计文档

日期：2026-11-05
状态：待用户批准

## 意图与为什么

用户看到一张 "TOKEN SPEED / observatory" 终端仪表盘的截图（Codex + Claude + DSH 本地
token 遥测工具），想要一个同样的工具：**读取本机 AI CLI 工具的真实使用记录，在终端里
以酷炫的 TUI 展示吞吐量、用量趋势、模型速度等统计**。

用户明确要求：

- 终端 TUI 形态（与截图一致）
- 数据来自本机真实记录（不是演示数据）
- 多来源：Claude Code + Codex + **DSH（DeepSeek Harness）**——本机三个来源都有真实数据，
  与截图的 CODEX / CLAUDE / DSH 三卡片完全对应
- **来源必须可插拔扩展**：未来能低成本接入其他 agent harness（如 Kimi、GLM 等），
  通过实现适配器接口 + 一行注册完成（用户明确要求）
- 用现成 TUI 库美化界面，功能做全，界面一定要酷炫

## 目标

1. 复刻截图的视觉风格：深色底、三色系（青绿/橙/品红）、圆角卡片、大数字吞吐量卡片
   （带迷你直方图）、活动热力条、模型速度条形图、最近活动表、F1-F4 导航、SOURCE/WINDOW
   筛选、底部快捷键栏、LIVE 实时脉冲。
2. 完整功能：Overview / Timeline / Models / Requests 四个页面，全局来源与时间窗筛选，
   实时增量刷新，跨来源汇总。
3. 解析真实数据（详见数据规格）。
4. 近 1GB 原始数据下，冷启动可容忍（带进度动画），日常启动秒开（增量缓存索引）。
   实测基线：全量冷扫 ~5s；记录宇宙 ~2 万条 TurnRecord；fzstd 解压 zst 正常
   （~15ms/100KB）。

## 非目标

- 不做费用/价格计算（截图工具不做，定价表维护成本高）
- 不修改任何 AI 工具的数据；只读
- 不做 Web 版 / 导出报表
- 不支持 Windows 旧版 conhost 的完整体验（目标是 Windows Terminal / 现代终端）

## 反目标（做了就算失败）

- 界面在普通字体终端（无 Nerd Font）下乱码、错位
- 每次启动都全量扫描 1GB 数据（慢到没人愿意开第二次）
- 统计数字明显失真（如把流式分片当独立请求重复计数）

## 已定决策（用户拍板）

| 决策 | 选择 |
|------|------|
| 形态 | 终端 TUI |
| 数据 | 本机真实记录 |
| 范围 | Claude Code + Codex 多来源 |
| 技术路线 | 用成熟 TUI 库美化，功能做全，界面酷炫 |

## 我的决策（实现者可复议，但需给出理由）

| 决策 | 选择 | 理由 |
|------|------|------|
| 语言/运行时 | Node.js ≥ 20，ESM + TypeScript，`tsx` 直接运行 | 用户机器 Node 24；与 Claude Code 生态一致 |
| TUI 框架 | Ink 5（React for terminals） | Claude Code 自身界面即 Ink；flex 布局+边框开箱即用 |
| 酷炫组件 | `ink-gradient`+`ink-big-text`（渐变大字横幅）、`ink-spinner`（LIVE 动画）、自定义半块字符直方图/热力条/仪表条 | 截图效果的核心 |
| zstd 归档 | `fzstd`（纯 JS 解压）读 Codex `.jsonl.zst` | 174 个压缩归档占 Codex 一半以上历史，不读则数据残缺 |
| 缓存 | 项目内 `.data/index.json`（按文件 mtime+size 增量） | 秒开；删除即重建 |
| 项目位置 | `console/tokenspeed/`，独立 npm 包，`npm start` / `npx .` 运行 | 截图 png 留在 console 根目录 |
| tok/s 口径 | 输出 tokens ÷ 响应耗时；Claude 按同 `message.id` 聚合流式分片取时间跨度，Codex 按 turn 起止估算；界面标注为估算 | 静态日志没有精确流式计时，必须诚实 |
| 字体兜底 | 全部字形用 Unicode 标准块（▁▂▃▄▅▆▇█ ░▒▓ ┌┐└┘ 等），不用 Nerd Font 私有区字形；检测到宽字符问题自动降级 | 反目标第一条 |

## 数据规格

### 来源 1：Claude Code

- 路径：`~/.claude/projects/<项目目录>/<sessionId>.jsonl`，**以及**
  `~/.claude/projects/<项目目录>/<sessionId>/subagents/*.jsonl`（子代理 sidechain，
  占全部 output tokens 的 13.9%，真实用量必须纳入；token 折入父会话，不单列行）
- 取 `type === "assistant"` 的行：
  - 时间：`timestamp`（ISO）
  - 模型：`message.model`（`<synthetic>` 占位行剔除，全部零值）
  - tokens：`message.usage.{input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens}`；
    thinking tokens 在 `output_tokens_details.thinking_tokens`（含在 output 内，单列统计）
  - 数据事实：本机 GLM 中转不回填 cache_creation，Claude 的 cacheWrite 恒为 0（展示
    层如实显示，不是 bug）
- **流式分片聚合**（实测验证）：同一响应的多个分片共享同一 `message.id`（在 `message`
  对象内），按 (sessionId, message.id) 聚合；分片 usage 为**累计值且逐片相同（重复
  落盘，非流式快照），取任一片即可，严禁求和**
- **响应耗时估算**（实测验证，定义产品第一指标）：
  1. 优先：该响应的 `type:"api-request"` 行 timestamp → 首个 assistant 分片 timestamp
     （2026-10 中以后数据有此行，覆盖 47% message id）
  2. 兜底：紧邻其前的 `type:"user"` 行（用户输入或 tool_result）timestamp → 首分片
     timestamp（与 api-request 信号偏差 <10%）
  3. 末选：同会话上一响应间隔
  全程 clamp 到 (0, 10min]，异常兜底 1s。含首字等待。实测口径给出 ~40-60 tok/s 有效
  速率（GLM 中转），量级合理；分片间跨度（p50 1.9s）是重复落盘间隔，禁止当耗时
- 会话元数据：项目目录名（还原为路径）即会话归属项目

#### 来源适配器接口（所有来源通用）

所有来源实现统一适配器接口（见"架构"），新增 harness 只需实现接口并注册：

```ts
interface SourceAdapter {
  id: 'claude' | 'codex' | 'dsh' | string;   // 稳定 id
  label: string;                              // 卡片标题，如 'CODEX'
  color: string;                              // 主题色（ANSI truecolor）
  available(): boolean;                        // 数据目录存在与否
  discover(): FileEntry[];                     // 需解析的文件（path/mtime/size）
  parse(file: FileEntry): TurnRecord[];        // 解析为统一记录
}
```

### 来源 3：DSH（DeepSeek Harness）

- 路径：`~/.dsh/storages/session_projcache/sessions/*.json`（本机 11 个）
- 结构：CRDT 快照，`record.identity`（createdAt、cwd）+ `record.rows.*.val`
- 取数：
  - `rows.tokenUsage.val.totals`：uncachedInputTokens / outputTokens /
    cacheReadTokens / cacheWriteTokens（会话级累计）
  - `rows.sessionStats.val`：llmMs、ttftMs、**decodeMs / decodeTokens**（真实解码
    速度）、turns、steps
  - 模型：`rows.modelSelection.val.lastUsed.model`（实测为 `deepseek-flash` 等），
    缺省 `deepseek`
- 粒度：会话级（一条会话 → 一条 TurnRecord；durMs = decodeMs，tok/s 为真实解码速度，
  非估算——DSH 是三来源中口径最准的）

### 来源 4（未来示例，不在本期）：Kimi

本机 `~/.kimi/` 目前只有 websocket 可观测性日志、无结构化 token 数据。作为适配器
扩展的示范：待其产生结构化会话文件后，实现 `SourceAdapter` 并在 `sources/index.ts`
注册即可全界面生效（卡片、筛选、热力条、表格自动出现）。

### 来源 2：Codex

- 路径：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` **与** 同目录树下 `*.jsonl.zst`
  （105 个），以及 `~/.codex/archived_sessions/rollout-*.jsonl.zst`（69 个）；三处
  会话 id 零重叠，无需去重
- `token_usage_record` 行：**只用 `payload.usage`（逐响应值）**；
  `turn_token_usage`/`thread_token_usage` 是累计值，禁用
  - `input_tokens`（含 cached）：inTok = input_tokens − cached_input_tokens
  - `cacheRead = cached_input_tokens`，`cacheWrite = cache_write_input_tokens`
  - `outTok = output_tokens`（reasonTok = reasoning_output_tokens 含在内）
- 模型：最近一次 `turn_context.payload.model`（按 turn 关联）；会话级元数据取
  `session_meta.payload`（cwd、时间）
- **耗时估算（单响应口径，与 Claude 可比）**：本条 record timestamp − 同 thread 上一条
  token_usage_record timestamp（一个 turn 可有几十条 record）；首条回退用同 turn
  `task_started` timestamp；clamp (0, 10min]。不用 `task_complete.duration_ms`（含
  工具执行墙钟时间，会令 Codex 速率被低估一个数量级）

### 统一记录模型（缓存里存这个）

```ts
interface TurnRecord {
  src: 'claude' | 'codex' | 'dsh' | string;  // 适配器 id
  sid: string;          // 会话 id
  proj: string;         // 项目/工作目录
  ts: number;           // 响应开始时间 epoch ms
  model: string;
  inTok: number;        // 不含缓存
  cacheRead: number;
  cacheWrite: number;
  outTok: number;       // 含 reasoning（claude: 含 thinking）
  reasonTok: number;    // codex reasoning / claude thinking
  durMs: number;        // 耗时（claude/codex 为估算，dsh 为真实 decodeMs）
}
```

### 派生指标

- **avg tok/s**（卡片大数字）= 窗口内 Σ outTok ÷ Σ durMs × 1000
- **活动热力条**：窗口按 48~96 个时间桶，桶内 Σ outTok 映射 8 级灰度/颜色
- **模型速度**：按模型聚合 avg tok/s + Σ tokens，水平仪表条
- **迷你直方图**：最近 N 桶 outTok（卡片内），半块字符渐变
- 会话/请求数、in/out/cache 累计、峰值 tok/s 等

## 界面规格（四页 + 全局）

全局外壳：
- 顶栏：渐变大字 `TOKEN SPEED` + 副标题 `observatory`，右侧 `● LIVE`（呼吸动画）/
  `○ PAUSED`、`node · v0.1.0`、当前时间
- 导航：`[F1] Overview  [F2] Timeline  [F3] Models  [F4] Requests`（当前页高亮反色）
- 筛选行：`SOURCE: 1 All · 2 Codex · 3 Claude · 4 DSH`（数字键随注册表顺序）；
  `WINDOW: t Today · w cycle(7d/30d/All) · a All`
- 底部状态栏：快捷键提示 `1-4 source · T/7/3/A window · r refresh · x theme · q quit`
  + 扫描状态（`scanning… 42/231` / `cached · 5s ago`）；主题键为 `x`（`g/G` 留给
  Requests 页到顶/到底）

F1 Overview（复刻截图布局）：
- 一行来源卡片（CODEX / CLAUDE / DSH，与截图一致；available() 为假的来源自动隐藏）：
  大数字 avg tok/s + 累计活跃时长（Σ durMs）、Σ tokens、req 数、迷你直方图、来源
  主题色边框
- ACTIVITY MAP：每来源一条横向热力条（时间 → 强度）
- MODEL VELOCITY：top 模型 avg tok/s 水平仪表条
- OUTPUT ACTIVITY：双来源并列柱状图（按桶）
- LATEST ACTIVITY：最近会话表（时间、来源、项目、模型、tokens、tok/s、状态）

F2 Timeline：
- 窗口内逐日/逐时 token 柱状 + 折线（半块字符渲染），in/out/cache 分色
- 当日摘要行、峰值标注

F3 Models：
- 全模型表：模型、来源、请求数、in/out/cache/total tokens、avg tok/s、峰值 tok/s、
  占比条；按列排序（方向键）

F4 Requests：
- 最近单次响应流：时间、来源、模型、out tok、耗时、tok/s（估算）、会话短 id
- 上下滚动、g 到顶 G 到底

动效：LIVE 呼吸点、扫描进度条动画、数字滚动（大数字变化时）、主题切换渐变色重绘。
主题：默认 dark observatory（截图配色），`g` 键在 2-3 套配色间切换。

LIVE 模式：`fs.watch` 监听两个 sessions 目录 + 5s 定时增量重扫变更文件；数据变化时
界面淡入更新。CLI：`--no-live`、`--source=claude|codex`、`--window=7d`、`--rescan`。

## 架构

```
tokenspeed/
  package.json          # bin: tokenspeed
  src/
    main.tsx            # 入口，Ink render，全局状态
    theme.ts            # 配色/主题
    sources/
      index.ts          # 适配器注册表（ADAPTERS 数组）——新增 harness 在此加一行
      types.ts          # SourceAdapter / TurnRecord 接口
      claude.ts         # ~/.claude/projects/**.jsonl
      codex.ts          # ~/.codex/sessions + archived_sessions .zst
      dsh.ts            # ~/.dsh/storages/session_projcache/sessions/*.json
    scan/
      indexer.ts        # 增量扫描 + 缓存（.data/index.json）
      watcher.ts        # fs.watch + 轮询
    agg/
      metrics.ts        # 聚合：tok/s、桶、模型速度…
    ui/
      App.tsx           # 外壳 + 路由
      Overview.tsx  Timeline.tsx  Models.tsx  Requests.tsx
      comp/  (Card, Sparkline, HeatStrip, GaugeBar, BigNum, Table, Banner)
```

**扩展即插拔**：UI 层不感知具体来源，遍历 `ADAPTERS` 生成卡片/筛选键/热力条；
SOURCE 筛选数字键按注册顺序动态分配（1=All，2..N=各来源）。

## 验收清单

- [x] `npm start` 在用户机器上以真实数据启动，四个页面全部有数据
- [x] 三来源卡片齐全：CODEX / CLAUDE / DSH（DSH 用真实 decode 数据，tok/s 非估算）
- [x] 新增一个来源适配器只需实现接口 + 注册一行（以 Kimi 空适配器为反例验证 UI 自动扩展）
- [x] Claude 流式分片不重复计数（抽 3 个会话人工核对 token 总量级）
- [x] Codex .zst 归档被读取（总数 > 只算明文 .jsonl 的数）
- [x] 普通字体 Windows Terminal 下无乱码/错位
- [x] 二次启动 < 2s（命中缓存）
- [x] 界面观感与截图同水准：卡片、热力条、仪表条、渐变横幅、LIVE 动画齐全

## 留给实现者的

- 聚合/组件的内部实现细节
- 缓存文件的具体格式（json 即可）
- tok/s 兜底逻辑的具体阈值（实测后定，文档口径不变）
