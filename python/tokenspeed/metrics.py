from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

from .models import TurnRecord

WINDOW_ORDER = ("today", "7d", "30d", "all")


def window_range(window: str, now: float) -> tuple[float, float]:
    if window == "today":
        local = datetime.fromtimestamp(now / 1000).replace(hour=0, minute=0, second=0, microsecond=0)
        return local.timestamp() * 1000, now
    if window == "7d":
        return now - 7 * 86_400_000, now
    if window == "30d":
        return now - 30 * 86_400_000, now
    return 0.0, math.inf


def apply_filters(records: Iterable[TurnRecord], src: str, bounds: tuple[float, float]) -> list[TurnRecord]:
    start, end = bounds
    return [
        r for r in records
        if (src == "all" or r.src == src)
        and start <= r.ts <= end
        and (math.isinf(end) or r.is_request)
    ]


def spark(
    records: list[TurnRecord], buckets: int = 32,
    bounds: tuple[float, float] | None = None,
) -> list[float]:
    if not records:
        return []
    if bounds is None:
        timestamps = [r.ts for r in records]
        start, end = min(timestamps), max(timestamps)
    else:
        start, end = bounds
    span = max(1.0, end - start)
    values = [0.0] * buckets
    for record in records:
        if not start <= record.ts <= end:
            continue
        index = min(buckets - 1, int(((record.ts - start) / span) * buckets))
        values[index] += record.outTok
    return values


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def source_summaries(
    records: Iterable[TurnRecord], spark_buckets: int = 32,
    spark_bounds: tuple[float, float] | None = None,
) -> list[dict]:
    grouped: dict[str, list[TurnRecord]] = defaultdict(list)
    for record in records:
        grouped[record.src].append(record)
    output = []
    for src, items in grouped.items():
        timed = [r for r in items if r.is_request]
        out_tokens = sum(r.outTok for r in items)
        active_ms = sum(max(0, r.durMs) for r in items)
        usable = [r for r in items if r.durMs > 0]
        rates = [(r.outTok / r.durMs) * 1000 for r in timed if r.durMs > 0]
        output.append({
            "src": src,
            "avgTps": out_tokens / active_ms * 1000 if active_ms > 0 else None,
            "medianTps": median(rates),
            "usablePct": len(usable) / len(items) if items else 0,
            "inTok": sum(r.inTok for r in items),
            "outTok": out_tokens,
            "cacheRead": sum(r.cacheRead for r in items),
            "cacheWrite": sum(r.cacheWrite for r in items),
            "reqs": sum(r.requests for r in items),
            "sessions": len({r.sid for r in items}),
            "activeMs": active_ms,
            "spark": spark(timed, spark_buckets, spark_bounds),
            "cumulative": not timed,
        })
    return output


def bucket_records(records: Iterable[TurnRecord], bounds: tuple[float, float], count: int) -> list[dict]:
    start, end = bounds
    span = max(1.0, end - start)
    buckets = [
        {"t0": start + span / count * index, "out": defaultdict(float), "in": defaultdict(float)}
        for index in range(count)
    ]
    for record in records:
        if not record.is_request or not start <= record.ts <= end:
            continue
        index = min(count - 1, int((record.ts - start) / span * count))
        buckets[index]["out"][record.src] += record.outTok
        buckets[index]["in"][record.src] += record.inTok
    return buckets


def p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1)]


def model_stats(records: Iterable[TurnRecord]) -> list[dict]:
    items = list(records)
    grouped: dict[str, list[TurnRecord]] = defaultdict(list)
    for record in items:
        grouped[record.model].append(record)
    total_output = sum(r.outTok for r in items)
    rows = []
    for model, group in grouped.items():
        out_tokens = sum(r.outTok for r in group)
        active_ms = sum(max(0, r.durMs) for r in group)
        peaks = [(r.outTok / r.durMs) * 1000 for r in group if r.is_request and r.durMs > 0]
        rows.append({
            "model": model,
            "srcs": list(dict.fromkeys(r.src for r in group)),
            "reqs": sum(r.requests for r in group),
            "inTok": sum(r.inTok for r in group),
            "outTok": out_tokens,
            "cacheRead": sum(r.cacheRead for r in group),
            "avgTps": out_tokens / active_ms * 1000 if active_ms > 0 else None,
            "peakTps": p95(peaks),
            "share": out_tokens / total_output if total_output > 0 else 0,
        })
    rows.sort(key=lambda row: row["outTok"], reverse=True)
    return rows


@dataclass(slots=True)
class OverviewMetrics:
    summaries: list[dict]
    activity_summaries: list[dict]
    spark_bounds: tuple[float, float]
    bounds: tuple[float, float]
    buckets: list[dict]
    models: list[dict]
    latest: list[TurnRecord]
    session_count: int
    model_count: int
    total_output: int


def build_overview_metrics(
    records: list[TurnRecord], src_filter: str, window: str, now: float,
    bar_width: int,
) -> OverviewMetrics:
    """Compute expensive overview aggregation once per data/view-time key."""
    selected = window_range(window, now)
    filtered = apply_filters(records, src_filter, selected)
    activity = [record for record in filtered if record.is_request]
    summary_records = filtered if window == "all" else [
        *filtered, *(record for record in records if record.kind == "session" and (src_filter == "all" or record.src == src_filter)),
    ]
    timed_summary = [record for record in summary_records if record.is_request]
    if window == "all" and timed_summary:
        spark_bounds = (min(r.ts for r in timed_summary), max(r.ts for r in timed_summary) + 1)
    elif math.isinf(selected[1]):
        spark_bounds = (now - 86_400_000, now)
    else:
        spark_bounds = selected
    if activity:
        minimum, maximum = min(r.ts for r in activity), max(r.ts for r in activity)
    else:
        minimum, maximum = now - 86_400_000, now
    bounds = (minimum, maximum + 1) if window == "all" and activity else selected
    if math.isinf(bounds[1]):
        bounds = (now - 86_400_000, now)
    return OverviewMetrics(
        summaries=source_summaries(summary_records, spark_bounds=spark_bounds),
        activity_summaries=source_summaries(activity),
        spark_bounds=spark_bounds,
        bounds=bounds,
        buckets=bucket_records(activity, bounds, bar_width),
        models=model_stats(filtered)[:3],
        latest=sorted(activity, key=lambda record: record.ts, reverse=True)[:4],
        session_count=len({(r.src, r.sid) for r in activity}),
        model_count=len({r.model for r in activity}),
        total_output=sum(r.outTok for r in activity),
    )


class OverviewCache:
    """Single-entry cache; records are replaced, never mutated, by the scanner."""

    def __init__(self) -> None:
        self._records: list[TurnRecord] | None = None
        self._key: tuple | None = None
        self._value: OverviewMetrics | None = None

    def get(
        self, records: list[TurnRecord], src_filter: str, window: str,
        now: float, bar_width: int,
    ) -> OverviewMetrics:
        key = (src_filter, window, int(now // 1000), bar_width)
        if self._records is records and self._key == key and self._value is not None:
            return self._value
        value = build_overview_metrics(records, src_filter, window, now, bar_width)
        self._records, self._key, self._value = records, key, value
        return value


def latest_sessions(records: Iterable[TurnRecord], limit: int) -> list[dict]:
    grouped: dict[tuple[str, str], list[TurnRecord]] = defaultdict(list)
    for record in records:
        grouped[(record.src, record.sid)].append(record)
    rows = []
    for (src, sid), group in grouped.items():
        latest = max(group, key=lambda r: r.ts)
        out_tokens = sum(r.outTok for r in group)
        active_ms = sum(max(0, r.durMs) for r in group)
        rows.append({
            "sid": sid,
            "src": src,
            "proj": group[0].proj,
            "model": latest.model,
            "firstTs": min(r.ts for r in group),
            "lastTs": latest.ts,
            "outTok": out_tokens,
            "totalTok": sum(r.inTok + r.outTok + r.cacheRead + r.cacheWrite for r in group),
            "reqs": sum(r.requests for r in group),
            "avgTps": out_tokens / active_ms * 1000 if active_ms > 0 else None,
        })
    rows.sort(key=lambda row: row["lastTs"], reverse=True)
    return rows[:limit]
