from __future__ import annotations

import math
from typing import Any

from . import __version__
from .metrics import apply_filters, bucket_records, model_stats, source_summaries, window_range
from .models import TurnRecord
from .sources import SOURCE_LABELS, SOURCE_ORDER
from .terminal import (
    Seg, activity_strip, blank, clip_segments, fit, fmt_duration, fmt_pct, fmt_tok,
    fmt_tps, gradient_bar, gradient_text, histogram, join_columns, local_datetime,
    panel, solid_number, sparkline, timeline_chart, width,
)

THEMES = [
    {
        "name": "observatory", "bg": "#020610", "panel": "#0b1420", "border": "#26384a",
        "text": "#e8fbff", "dim": "#6f8ca6", "accent": "#67e8f9",
        "grad": ("#67e8f9", "#c084fc"),
        "sources": {"codex": "#00ffc6", "claude": "#ffd166", "dsh": "#ff4fa3"},
        "gradients": {"codex": ("#00ffc6", "#00a3ff"), "claude": ("#fff45a", "#ff8a3d"), "dsh": ("#ff4fa3", "#b86bff")},
    },
    {
        "name": "ember", "bg": "#120d0a", "panel": "#1a1310", "border": "#3d2b20",
        "text": "#e8d5c4", "dim": "#8a7263", "accent": "#fb923c", "grad": ("#fbbf24", "#ef4444"),
        "sources": {"codex": "#f59e0b", "claude": "#fbbf24", "dsh": "#f87171"},
        "gradients": {},
    },
    {
        "name": "vapor", "bg": "#0d0a16", "panel": "#141020", "border": "#322a4a",
        "text": "#d4cfe8", "dim": "#6f688a", "accent": "#c084fc", "grad": ("#818cf8", "#e879f9"),
        "sources": {"codex": "#a78bfa", "claude": "#818cf8", "dsh": "#e879f9"},
        "gradients": {},
    },
]

TEXT = {
    "en": {
        "observatory": "observatory", "telemetry": "local token telemetry", "live": "LIVE", "paused": "paused",
        "pages": ("Overview", "Timeline", "Models", "Requests"), "source": "SOURCE", "window": "WINDOW",
        "windows": ("Today", "7 days", "30 days", "All time"), "all": "All",
        "status": "Claude/Codex TPS estimated · DSH card = All-time totals",
        "help": "Tab view · 1-4 source · t/w/a range · ↑/↓ scroll · l 中文 · r refresh · x theme · q quit",
        "weighted": "weighted request throughput", "cumulative": "cumulative session decode",
        "rate": "output tokens / second", "decode": "decode tokens / second",
        "median": "Median", "requests": "requests", "calls": "model calls · cumulative total",
        "output": "output", "usable": "usable", "all_sessions": "All-time",
        "activity": "ACTIVITY MAP", "per_bucket": "output tokens / time bucket", "bucket_activity": "BUCKET ACTIVITY",
        "total": "TOTAL", "legend": "· no output  ▁▂█ low → high · shared scale · peak",
        "latest": "LATEST ACTIVITY", "sessions": "sessions", "models": "models", "output_tokens": "output tokens",
        "time": "TIME", "duration": "DURATION", "model": "MODEL", "usage": "MODEL USAGE",
        "share": "output / share", "activity_out": "OUTPUT ACTIVITY", "no_series": "All-time · no time series",
        "tokens": "tokens", "none": "no activity in window · —", "timeline": "TIMELINE",
        "all_sources": "all sources", "input": "INPUT", "cache": "CACHE READ", "peak": "PEAK",
        "sources": "SOURCES", "trend": "5-bucket trend", "sort": "SORT", "desc": "descending", "asc": "ascending",
        "model_note": "Claude/Codex TPS estimated · DSH uses cumulative decode timing",
        "sort_note": "SHARE = output-token share · ←/→ sort column · Enter flip direction",
        "request_note": "TPS = estimated output / inferred duration · j/k or ↑/↓ scroll · g/G top/bottom",
        "showing": "SHOWING", "newest": "newest first", "session_only": "session totals only — per-request history is unavailable",
        "no_requests": "no requests in window —", "refreshed": "refreshed", "records": "records",
    },
    "zh": {
        "observatory": "观测台", "telemetry": "本地 Token 遥测", "live": "实时", "paused": "已暂停",
        "pages": ("概览", "时间线", "模型", "请求"), "source": "来源", "window": "窗口",
        "windows": ("今天", "7 天", "30 天", "全部"), "all": "全部",
        "status": "Claude/Codex TPS 为估算 · DSH 卡片为全部累计",
        "help": "Tab 视图 · 1-4 来源 · t/w/a 范围 · ↑/↓ 滚动 · l EN · r 刷新 · x 主题 · q 退出",
        "weighted": "加权请求吞吐", "cumulative": "会话累计解码",
        "rate": "输出 Token / 秒", "decode": "实测会话解码 Token / 秒",
        "median": "中位数", "requests": "请求", "calls": "次模型调用 · 全部累计",
        "output": "输出", "usable": "有效", "all_sessions": "全部累计",
        "activity": "活动图", "per_bucket": "输出 Token / 时间桶", "bucket_activity": "分桶活动",
        "total": "总量", "legend": "· 无输出  ▁▂█ 低 → 高 · 统一刻度 · 峰值",
        "latest": "最近活动", "sessions": "个会话", "models": "个模型", "output_tokens": "输出 Token",
        "time": "时间", "duration": "时长", "model": "模型", "usage": "模型使用",
        "share": "输出 / 占比", "activity_out": "输出活动", "no_series": "全部累计 · 无分时明细",
        "tokens": "Token", "none": "当前窗口无活动 · —", "timeline": "时间线",
        "all_sources": "全部来源", "input": "输入", "cache": "缓存读取", "peak": "峰值",
        "sources": "来源", "trend": "5 桶移动趋势", "sort": "排序", "desc": "降序", "asc": "升序",
        "model_note": "Claude/Codex TPS 为估算 · DSH 使用累计解码时长",
        "sort_note": "占比 = 输出 Token 比例 · ←/→ 切换列 · Enter 反转排序",
        "request_note": "TPS = 估算输出 / 推算时长 · j/k 或 ↑/↓ 滚动 · g/G 顶部/底部",
        "showing": "显示", "newest": "最新优先", "session_only": "仅有会话累计，无逐请求历史",
        "no_requests": "当前窗口无请求 —", "refreshed": "刷新于", "records": "条记录",
    },
}


def _segments_width(segments: list[Seg]) -> int:
    return sum(width(segment.text) for segment in segments)


def _left_right(left: list[Seg], right: list[Seg], total: int) -> list[Seg]:
    gap = max(1, total - _segments_width(left) - _segments_width(right))
    return [*left, Seg(" " * gap), *right]


def _pretty(src: str) -> str:
    return src.upper() if len(src) <= 3 else src.capitalize()


def _date_label(ts: float, lang: str) -> str:
    date = local_datetime(ts)
    return f"{date:%m/%d %H}{'时' if lang == 'zh' else 'h'}"


def _source_card(summary: dict, card_width: int, theme: dict, lang: str, now: float, fx: Any) -> list[list[Seg]]:
    text = TEXT[lang]
    src = summary["src"]
    color = theme["sources"].get(src, theme["accent"])
    target_rate = summary["avgTps"]
    display_rate = fx.animated_rate(src, target_rate, now) if fx else target_rate
    rate = "—" if display_rate is None else f"{display_rate:.1f}"
    content: list[list[Seg]] = []
    content.extend(solid_number(rate, color))
    content.append([Seg(text["decode"] if summary["cumulative"] else text["rate"], theme["dim"])])
    if summary["cumulative"]:
        content.append([Seg(f"{summary['reqs']} {text['calls']}", theme["text"])])
    else:
        content.append([
            Seg(f"{text['median']} {fmt_tps(summary['medianTps'])} ", theme["text"]),
            Seg(f"· {summary['reqs']} {text['requests']}", theme["dim"]),
        ])
    content.append([Seg(
        f"{fmt_tok(summary['outTok'])} {text['output']} · {round(summary['usablePct'] * 100)}% {text['usable']}",
        theme["dim"]),
    ])
    content.extend(blank())
    if summary["cumulative"]:
        content.append([Seg(f"{text['all_sessions']} · {summary['sessions']} {text['sessions']}", theme["dim"])])
    else:
        content.extend(histogram(summary["spark"], max(4, card_width - 4), 3, color))
    title = [
        Seg(SOURCE_LABELS.get(src, src.upper()), color, True), Seg("  "),
        Seg(text["cumulative"] if summary["cumulative"] else text["weighted"], theme["dim"]),
    ]
    sweep = fx.sweep(now, ("source", "page")) if fx else None
    return panel(card_width, 18, title, content, color, sweep)


def _overview(records: list[TurnRecord], state: Any, now: float, terminal_width: int, theme: dict) -> list[list[Seg]]:
    lang = state.lang
    text = TEXT[lang]
    filtered = apply_filters(records, state.src_filter, window_range(state.win, now))
    activity = [record for record in filtered if record.is_request]
    summary_records = filtered if state.win == "all" else [
        *filtered, *(record for record in records if record.kind == "session" and (state.src_filter == "all" or record.src == state.src_filter)),
    ]
    order = {src: index for index, src in enumerate(SOURCE_ORDER)}
    summaries = sorted(source_summaries(summary_records), key=lambda row: order.get(row["src"], 99))
    activity_summaries = sorted(source_summaries(activity), key=lambda row: order.get(row["src"], 99))
    if not summaries:
        return panel(terminal_width, 3, [], [[Seg(text["none"], theme["dim"])]], theme["border"])

    card_width = max(12, (terminal_width - len(summaries) + 1) // len(summaries))
    fx = getattr(state, "fx", None)
    cards = [_source_card(summary, card_width, theme, lang, now, fx) for summary in summaries]
    lines = join_columns(cards, [card_width] * len(cards), 1)
    left_width = (terminal_width - 2) * 2 // 3
    right_width = terminal_width - 2 - left_width
    left_inner, right_inner = left_width - 4, right_width - 4
    if activity:
        minimum, maximum = min(r.ts for r in activity), max(r.ts for r in activity)
    else:
        minimum, maximum = now - 86_400_000, now
    selected = window_range(state.win, now)
    bounds = (minimum, maximum + 1) if state.win == "all" and activity else selected
    if math.isinf(bounds[1]):
        bounds = (now - 86_400_000, now)
    bar_width = max(4, left_inner - 17)
    buckets = bucket_records(activity, bounds, bar_width)
    sources = [summary["src"] for summary in activity_summaries]
    peak = max([1, *(bucket["out"].get(src, 0) for bucket in buckets for src in sources)])
    bucket_ms = max(1, (bounds[1] - bounds[0]) / bar_width)
    bucket_label = f"{bucket_ms / 86_400_000:.1f}d" if bucket_ms >= 86_400_000 else f"{bucket_ms / 3_600_000:.1f}h" if bucket_ms >= 3_600_000 else f"{max(1, round(bucket_ms / 60_000))}m"
    activity_content: list[list[Seg]] = [
        [Seg(f"{_date_label(bounds[0], lang)} → {_date_label(bounds[1], lang)} · {bucket_label}/bucket", theme["dim"])],
        [Seg(fit(text["source"], 7) + " " + fit(text["bucket_activity"], bar_width) + " " + fit(text["total"], 8, "right"), theme["dim"])],
    ]
    for summary in activity_summaries:
        src = summary["src"]
        activity_content.append([
            Seg(fit(_pretty(src), 7) + " ", theme["sources"].get(src, theme["accent"])),
            *activity_strip([bucket["out"].get(src, 0) for bucket in buckets], bar_width, theme["sources"].get(src, theme["accent"]), theme["border"], peak),
            Seg(" " + fit(fmt_tok(summary["outTok"]), 8, "right"), theme["text"]),
        ])
    activity_content.extend(blank())
    activity_content.append([Seg(f"{text['legend']} {fmt_tok(peak)}", theme["dim"])])
    upper_height = max(9, len(activity_summaries) + 6)
    page_sweep = fx.sweep(now, ("page",)) if fx else None
    upper_left = panel(left_width, upper_height, [
        Seg(text["activity"], theme["text"], True), Seg(f" · {text['per_bucket']}", theme["dim"]),
    ], activity_content, theme["border"], page_sweep)

    models = model_stats(filtered)[:3]
    max_model = max([1, *(model["outTok"] for model in models)])
    usage_content: list[list[Seg]] = []
    for model in models:
        src = model["srcs"][0]
        color = theme["sources"].get(src, theme["accent"])
        usage = f"{fmt_tok(model['outTok'])} · {fmt_pct(model['share'])}"
        label_width = max(4, right_inner - width(usage) - 1)
        usage_content.append([
            Seg(fit(f"{src.upper()} {model['model']}", label_width), color), Seg(" " + usage, color, True),
        ])
        usage_content.append(gradient_bar(model["outTok"], max_model, right_inner, theme["gradients"].get(src, (color, theme["accent"])), theme["border"]))
    upper_right = panel(right_width, upper_height, [
        Seg(text["usage"], theme["text"], True), Seg(f" · {text['share']}", theme["dim"]),
    ], usage_content, theme["border"], page_sweep)
    lines.extend(blank())
    lines.extend(join_columns([upper_left, upper_right], [left_width, right_width], 2))

    latest = sorted(activity, key=lambda record: record.ts, reverse=True)[:4]
    session_count = len({(r.src, r.sid) for r in activity})
    model_count = len({r.model for r in activity})
    total_output = sum(r.outTok for r in activity)
    compact = left_inner < 64
    time_width, src_width, dur_width, out_width = (11, 5, 8, 8) if compact else (14, 6, 11, 11)
    model_width = max(4, left_inner - time_width - src_width - dur_width - out_width - 8)
    latest_content: list[list[Seg]] = [
        [Seg(f"{session_count} {text['sessions']} · {model_count} {text['models']} · {fmt_tok(total_output)} {text['output_tokens']}", theme["dim"])],
        [],
        [Seg(f"{fit(text['time'], time_width)}  {fit(text['source'], src_width)}  {fit(text['duration'], dur_width)}  {fit(text['output'], out_width)}  {fit(text['model'], model_width)}", theme["dim"])],
    ]
    for record in latest:
        date = local_datetime(record.ts)
        timestamp = f"{date:%m/%d %H:%M}" if compact else f"{date:%m/%d %H:%M:%S}"
        latest_content.append([
            Seg(fit(timestamp, time_width) + "  ", theme["dim"]),
            Seg(fit(record.src, src_width) + "  ", theme["sources"].get(record.src, theme["accent"])),
            Seg(fit(fmt_duration(record.durMs, lang), dur_width) + "  ", theme["text"]),
            Seg(fit(f"{fmt_tok(record.outTok)} {text['output']}", out_width) + "  ", theme["text"]),
            Seg("· " + fit(record.model, max(1, model_width - 2)), theme["dim"]),
        ])
    lower_left = panel(left_width, 10, [[Seg(text["latest"], theme["text"], True)]], latest_content, theme["border"], page_sweep)

    cumulative_only = [s for s in summaries if s["cumulative"] and s["src"] not in sources]
    output_content: list[list[Seg]] = []
    for summary in activity_summaries:
        src = summary["src"]
        color = theme["sources"].get(src, theme["accent"])
        output_content.append([
            Seg(_pretty(src) + " ", color), Seg(f"{fmt_tok(summary['outTok'])} {text['tokens']}", theme["text"]),
        ])
        flow = fx.flow(src, now) if fx else None
        output_content.append(sparkline([bucket["out"].get(src, 0) for bucket in buckets], right_inner, color, flow))
    for summary in cumulative_only:
        src = summary["src"]
        output_content.append([
            Seg(_pretty(src) + " ", theme["sources"].get(src, theme["accent"])),
            Seg(f"{fmt_tok(summary['outTok'])} {text['tokens']}", theme["text"]),
        ])
        output_content.append([Seg(text["no_series"], theme["dim"])])
    lower_right = panel(right_width, 10, [[Seg(text["activity_out"], theme["text"], True)]], output_content, theme["border"], page_sweep)
    lines.extend(blank())
    lines.extend(join_columns([lower_left, lower_right], [left_width, right_width], 2))
    return lines


def _timeline(records: list[TurnRecord], state: Any, now: float, terminal_width: int, theme: dict) -> list[list[Seg]]:
    lang, text = state.lang, TEXT[state.lang]
    filtered = [r for r in apply_filters(records, state.src_filter, window_range(state.win, now)) if r.is_request]
    if not filtered:
        return panel(terminal_width, 5, [[Seg(text["timeline"], theme["text"], True)]], [[Seg(text["none"], theme["dim"])]], theme["border"])
    selected = window_range(state.win, now)
    bounds = (min(r.ts for r in filtered), max(r.ts for r in filtered) + 1) if state.win == "all" else selected
    planned = {"today": 24, "7d": 28, "30d": 30}.get(state.win, max(1, min(40, math.ceil((bounds[1] - bounds[0]) / 86_400_000))))
    count = max(4, min(planned, max(10, terminal_width - 24)))
    buckets = bucket_records(filtered, bounds, count)
    sources = list(dict.fromkeys(r.src for r in filtered))
    series = [([bucket["out"].get(src, 0) for bucket in buckets], theme["sources"].get(src, theme["accent"])) for src in sources]
    rows = timeline_chart(series, 8, theme["accent"])
    bucket_ms = (bounds[1] - bounds[0]) / count
    totals = [sum(bucket["out"].values()) for bucket in buckets]
    peak_index = max(range(count), key=lambda index: totals[index])
    content: list[list[Seg]] = [
        [Seg(f"{bucket_ms / 3_600_000:.1f}h/bucket · {state.src_filter if state.src_filter != 'all' else text['all_sources']} · {len(filtered)} {text['requests']}", theme["dim"])],
        [], *rows,
        [Seg(fit(_date_label(buckets[0]["t0"], lang), count)[:count], theme["dim"])],
        [Seg(f"{text['output']} {fmt_tok(sum(r.outTok for r in filtered))}   {text['input']} {fmt_tok(sum(r.inTok for r in filtered))}   {text['cache']} {fmt_tok(sum(r.cacheRead for r in filtered))}", theme["dim"])],
        [Seg(f"{text['peak']} {fmt_tok(totals[peak_index])} / bucket @ {_date_label(buckets[peak_index]['t0'], lang)}", theme["accent"], True)],
        [],
    ]
    legend = [Seg(text["sources"] + "  ", theme["dim"])]
    for src in sources:
        total = sum(bucket["out"].get(src, 0) for bucket in buckets)
        legend.extend([Seg(f"● {src} ", theme["sources"].get(src, theme["accent"])), Seg(fmt_tok(total) + "  ", theme["dim"])])
    legend.append(Seg("· " + text["trend"], theme["dim"]))
    content.append(legend)
    fx = getattr(state, "fx", None)
    sweep = fx.sweep(now, ("page", "source")) if fx else None
    return panel(terminal_width, len(content) + 4, [[Seg(text["timeline"], theme["text"], True), Seg(" · " + text["per_bucket"], theme["dim"])]], content, theme["border"], sweep)


MODEL_COLUMNS = [
    ("model", "MODEL", 22, "left"), ("srcs", "SOURCE", 8, "left"), ("reqs", "REQS", 6, "right"),
    ("inTok", "INPUT", 8, "right"), ("outTok", "OUTPUT", 8, "right"), ("cacheRead", "CACHE", 8, "right"),
    ("avgTps", "AVG TPS", 9, "right"), ("peakTps", "PEAK TPS", 9, "right"), ("share", "SHARE", 15, "left"),
]


def _models(records: list[TurnRecord], state: Any, now: float, terminal_width: int, theme: dict) -> list[list[Seg]]:
    lang, text = state.lang, TEXT[state.lang]
    filtered = apply_filters(records, state.src_filter, window_range(state.win, now))
    rows = model_stats(filtered)
    key = MODEL_COLUMNS[min(state.sort_col, len(MODEL_COLUMNS) - 1)][0]
    def sort_value(row: dict):
        value = row[key]
        if key == "share":
            return value
        if value is None:
            return -math.inf
        return value.lower() if isinstance(value, str) else value
    rows.sort(key=sort_value, reverse=state.sort_dir == -1)
    direction = "▼" if state.sort_dir == -1 else "▲"
    content: list[list[Seg]] = [
        [Seg(f"{len(rows)} {text['models']} · {sum(r.requests for r in filtered)} {text['requests']} · {fmt_tok(sum(r.outTok for r in filtered))} {text['output']}", theme["dim"])],
        [Seg(f"{text['sort']} {key.upper()} {direction} · {text['desc'] if state.sort_dir == -1 else text['asc']}", theme["dim"])], [],
    ]
    header = []
    for index, (_, label, column_width, align) in enumerate(MODEL_COLUMNS):
        header.append(Seg(fit(label + (f" {direction}" if index == state.sort_col else ""), column_width + (2 if index == state.sort_col else 0), align) + " ", theme["dim"]))
    content.append(header)
    for row in rows:
        values = {
            "model": row["model"], "srcs": "+".join(src.upper() for src in row["srcs"]), "reqs": str(row["reqs"]),
            "inTok": fmt_tok(row["inTok"]), "outTok": fmt_tok(row["outTok"]), "cacheRead": fmt_tok(row["cacheRead"]),
            "avgTps": fmt_tps(row["avgTps"]), "peakTps": fmt_tps(row["peakTps"]),
            "share": "█" * round(row["share"] * 7) + "░" * (7 - round(row["share"] * 7)) + " " + fmt_pct(row["share"]),
        }
        line = []
        for index, (column, _, column_width, align) in enumerate(MODEL_COLUMNS):
            color = theme["sources"].get(row["srcs"][0], theme["accent"]) if column in ("srcs", "share") else theme["accent"] if column in ("avgTps", "peakTps") else theme["text"]
            line.append(Seg(fit(values[column], column_width + (2 if index == state.sort_col else 0), align) + " ", color))
        content.append(line)
    content.extend(blank())
    content.append([Seg(text["model_note"], theme["dim"])])
    content.append([Seg(text["sort_note"], theme["dim"])])
    fx = getattr(state, "fx", None)
    sweep = fx.sweep(now, ("page", "source")) if fx else None
    return panel(terminal_width, len(content) + 4, [[Seg(text["pages"][2].upper(), theme["text"], True)]], content, theme["border"], sweep)


def _requests(records: list[TurnRecord], state: Any, now: float, terminal_width: int, theme: dict) -> list[list[Seg]]:
    lang, text = state.lang, TEXT[state.lang]
    selected = apply_filters(records, state.src_filter, window_range(state.win, now))
    rows = sorted((r for r in selected if r.is_request), key=lambda record: record.ts, reverse=True)
    if not rows:
        message = text["session_only"] if selected else text["no_requests"]
        return panel(terminal_width, 5, [[Seg(text["pages"][3].upper(), theme["text"], True)]], [[Seg(message, theme["dim"])]], theme["border"])
    start = max(0, min(state.scroll, max(0, len(rows) - 10)))
    visible = rows[start:start + 10]
    columns = [("TIME", 14), ("SOURCE", 8), ("MODEL", 26), ("OUTPUT", 9), ("DURATION", 10), ("TPS", 9), ("SESSION", 10)]
    content: list[list[Seg]] = [
        [Seg(f"{len(rows)} {text['requests']} · {len({(r.src, r.sid) for r in rows})} {text['sessions']} · {fmt_tok(sum(r.outTok for r in rows))} {text['output']}", theme["dim"])], [],
        [Seg("".join(fit(label, column_width, "right" if label in ("OUTPUT", "DURATION", "TPS") else "left") for label, column_width in columns), theme["dim"])],
    ]
    for record in visible:
        date = local_datetime(record.ts)
        values = [
            (f"{date:%m-%d %H:%M:%S}", 14, "left", theme["dim"]),
            (record.src.upper(), 8, "left", theme["sources"].get(record.src, theme["accent"])),
            (record.model, 26, "left", theme["text"]),
            (fmt_tok(record.outTok), 9, "right", theme["text"]),
            (fmt_duration(record.durMs, lang), 10, "right", theme["text"]),
            (fmt_tps(record.outTok / record.durMs * 1000 if record.durMs > 0 else None), 9, "right", theme["accent"]),
            (record.sid[:8], 10, "left", theme["dim"]),
        ]
        content.append([Seg(fit(value, column_width, align), color) for value, column_width, align, color in values])
    content.extend(blank())
    content.append([Seg(f"{text['showing']} {start + 1}-{min(len(rows), start + 10)} / {len(rows)} · {text['newest']}", theme["dim"])])
    content.append([Seg(text["request_note"], theme["dim"])])
    fx = getattr(state, "fx", None)
    sweep = fx.sweep(now, ("page", "source")) if fx else None
    return panel(terminal_width, len(content) + 4, [[Seg(text["pages"][3].upper(), theme["text"], True)]], content, theme["border"], sweep)


def render_app(records: list[TurnRecord], state: Any, terminal_width: int, now: float, last_refresh: float, live: bool = True) -> list[list[Seg]]:
    theme = THEMES[state.theme_idx % len(THEMES)]
    lang, text = state.lang, TEXT[state.lang]
    terminal_width = max(72, terminal_width)
    left = [Seg("❖ ", theme["accent"], True), *gradient_text("TOKEN SPEED", *theme["grad"], True), Seg("  /  " + text["observatory"], theme["dim"])]
    right = [Seg("● " + (text["live"] if live else text["paused"]) + "  ", theme["sources"]["codex"] if live else theme["dim"]), Seg(f"Python · v{__version__}", theme["dim"])]
    lines: list[list[Seg]] = [_left_right(left, right, terminal_width)]
    sources_line = []
    for index, src in enumerate(SOURCE_ORDER):
        if index:
            sources_line.append(Seg(" + ", theme["dim"]))
        sources_line.append(Seg(_pretty(src), theme["sources"][src]))
    sources_line.append(Seg("  ·  " + text["telemetry"], theme["dim"]))
    date = local_datetime(now)
    lines.append(_left_right(sources_line, [Seg(f"{date:%b %d · %H:%M:%S}", theme["dim"])], terminal_width))
    lines.extend(blank())
    navigation = []
    for index, page in enumerate(("overview", "timeline", "models", "requests")):
        selected = state.page == page
        navigation.append(Seg(f" F{index + 1} {text['pages'][index]} ", theme["bg"] if selected else theme["dim"], selected, theme["accent"] if selected else theme["panel"]))
        navigation.append(Seg("  "))
    lines.append(navigation)
    lines.extend(blank())
    filters = [Seg(text["source"] + " ", theme["dim"])]
    for index, src in enumerate(("all", *SOURCE_ORDER), 1):
        selected = state.src_filter == src
        color = theme["accent"] if src == "all" else theme["sources"][src]
        label = text["all"] if src == "all" else _pretty(src)
        filters.append(Seg(f" {index} {label} ", theme["bg"] if selected else color, selected, color if selected else theme["panel"]))
        filters.append(Seg(" "))
    windows = [Seg(text["window"] + " ", theme["dim"])]
    for index, window in enumerate(("today", "7d", "30d", "all")):
        selected = state.win == window
        windows.append(Seg(f" {text['windows'][index]} ", theme["bg"] if selected else theme["dim"], selected, theme["accent"] if selected else theme["panel"]))
        windows.append(Seg(" "))
    lines.append(_left_right(filters, windows, terminal_width))
    lines.extend(blank())
    if state.page == "overview":
        lines.extend(_overview(records, state, now, terminal_width, theme))
    elif state.page == "timeline":
        lines.extend(_timeline(records, state, now, terminal_width, theme))
    elif state.page == "models":
        lines.extend(_models(records, state, now, terminal_width, theme))
    else:
        lines.extend(_requests(records, state, now, terminal_width, theme))
    lines.extend(blank())
    lines.append([Seg(f"● {text['status']} · {len(records)} {text['records']} · {text['refreshed']} {max(0, round((now - last_refresh) / 1000))}s", theme["dim"])])
    lines.append([Seg(text["help"], theme["dim"])])
    return lines
