from __future__ import annotations

import io
import json
import math
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .models import FileEntry, TurnRecord

MAX_DUR = 600_000
FALLBACK_DUR = 1_000
SOURCE_ORDER = ("codex", "claude", "dsh")
SOURCE_LABELS = {"codex": "CODEX", "claude": "CLAUDE", "dsh": "DSH"}

try:
    import zstandard as zstd
except ImportError:  # pragma: no cover - exercised by installations without extras
    zstd = None


def _number(value: Any, default: float = 0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return default
    return value


def _integer(value: Any) -> int:
    return int(_number(value))


def parse_timestamp(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp() * 1000
    except (ValueError, OverflowError, OSError):
        return None


def _entry(path: Path) -> FileEntry | None:
    try:
        stat = path.stat()
        return FileEntry(str(path), stat.st_mtime_ns / 1_000_000, stat.st_size)
    except OSError:
        return None


def _walk_files(base: Path, extensions: tuple[str, ...]) -> Iterable[FileEntry]:
    if not base.exists():
        return
    for root, dirs, files in os.walk(base):
        dirs.sort()
        for name in sorted(files):
            if not name.endswith(extensions):
                continue
            item = _entry(Path(root) / name)
            if item:
                yield item


def available(root: str, src: str) -> bool:
    home = Path(root)
    if src == "codex":
        return (home / ".codex").exists()
    if src == "claude":
        return (home / ".claude" / "projects").exists()
    return (home / ".dsh" / "storages" / "session_projcache" / "sessions").exists()


def discover(root: str, src: str) -> list[FileEntry]:
    home = Path(root)
    if src == "codex":
        base = home / ".codex"
        return [
            *_walk_files(base / "sessions", (".jsonl", ".jsonl.zst")),
            *_walk_files(base / "archived_sessions", (".jsonl", ".jsonl.zst")),
        ]
    if src == "claude":
        return list(_walk_files(home / ".claude" / "projects", (".jsonl",)))
    base = home / ".dsh" / "storages" / "session_projcache" / "sessions"
    if not base.exists():
        return []
    output = []
    for path in sorted(base.glob("*.json")):
        if path.is_file() and (item := _entry(path)):
            output.append(item)
    return output


def _read_lines(path: str) -> Iterable[str]:
    if path.endswith(".zst"):
        if zstd is None:
            raise RuntimeError("zstandard is required to read Codex .zst archives")
        with open(path, "rb") as compressed:
            with zstd.ZstdDecompressor().stream_reader(compressed) as reader:
                text = reader.read().decode("utf-8")
        yield from text.splitlines()
        return
    with open(path, encoding="utf-8") as handle:
        yield from handle


def _json_lines(path: str) -> Iterable[dict[str, Any]]:
    for line in _read_lines(path):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except (json.JSONDecodeError, UnicodeError):
            continue
        if isinstance(value, dict):
            yield value


def _claude_usage(message: dict[str, Any]) -> dict[str, int] | None:
    usage = message.get("usage") or {}
    if not isinstance(usage, dict) or ("input_tokens" not in usage and "output_tokens" not in usage):
        return None
    details = usage.get("output_tokens_details") or {}
    return {
        "inTok": _integer(usage.get("input_tokens")),
        "cacheRead": _integer(usage.get("cache_read_input_tokens")),
        "cacheWrite": _integer(usage.get("cache_creation_input_tokens")),
        "outTok": _integer(usage.get("output_tokens")),
        "reasonTok": _integer(details.get("thinking_tokens")) if isinstance(details, dict) else 0,
    }


def parse_claude(root: str, file: FileEntry) -> list[TurnRecord]:
    base = Path(root) / ".claude" / "projects"
    segments = Path(file.path).relative_to(base).parts
    proj = segments[0] if segments else ""
    if len(segments) >= 3 and segments[-2] == "subagents":
        sid = segments[-3]
    else:
        sid = Path(file.path).name.removesuffix(".jsonl")
    records: list[TurnRecord] = []
    last_user: float | None = None
    previous_group: float | None = None
    api_requests: dict[str, float] = {}
    current: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal current, previous_group
        if current is None:
            return
        group, current = current, None
        previous_group = group["lastTs"]
        usage = group["usage"]
        if usage is None:
            return
        candidates = (
            api_requests.get(group["requestRef"]) if group["requestRef"] else None,
            group["anchorUser"], group["anchorPrev"],
        )
        duration = FALLBACK_DUR
        for anchor in candidates:
            if anchor is None or not math.isfinite(anchor):
                continue
            difference = group["firstTs"] - anchor
            if difference > 0:
                duration = min(difference, MAX_DUR)
                break
        records.append(TurnRecord(
            src="claude", sid=sid, proj=proj, ts=group["firstTs"],
            model=group["model"], durMs=duration, **usage,
        ))

    for data in _json_lines(file.path):
        ts = parse_timestamp(data.get("timestamp"))
        if ts is None:
            continue
        kind = data.get("type")
        if kind == "user":
            last_user = ts
        elif kind == "api-request":
            if isinstance(data.get("id"), str):
                api_requests[data["id"]] = ts
        elif kind == "assistant":
            message = data.get("message")
            if not isinstance(message, dict) or not isinstance(message.get("id"), str):
                continue
            model = message.get("model") if isinstance(message.get("model"), str) else "unknown"
            if model == "<synthetic>":
                continue
            message_id = message["id"]
            usage = _claude_usage(message)
            request_ref = data.get("requestRef") if isinstance(data.get("requestRef"), str) else None
            if current is None or current["msgId"] != message_id:
                flush()
                current = {
                    "msgId": message_id, "firstTs": ts, "lastTs": ts,
                    "requestRef": request_ref, "anchorUser": last_user,
                    "anchorPrev": previous_group, "model": model, "usage": usage,
                }
            else:
                current["lastTs"] = ts
                if usage is not None:
                    current["usage"] = usage
                if current["requestRef"] is None and request_ref is not None:
                    current["requestRef"] = request_ref
    flush()
    return records


def _clamp_duration(ts: float, anchor: float | None) -> float | None:
    if anchor is None or not math.isfinite(anchor):
        return None
    difference = ts - anchor
    return min(difference, MAX_DUR) if difference > 0 else None


def parse_codex(_root: str, file: FileEntry) -> list[TurnRecord]:
    records: list[TurnRecord] = []
    project = ""
    last_model = "unknown"
    turn_models: dict[str, str] = {}
    turn_starts: dict[str, float] = {}
    previous_in_thread: dict[str, float] = {}
    token_count_anchor: float | None = None
    for data in _json_lines(file.path):
        ts = parse_timestamp(data.get("timestamp"))
        if ts is None:
            continue
        payload = data.get("payload")
        if not isinstance(payload, dict):
            continue
        kind = data.get("type")
        if kind == "session_meta":
            if isinstance(payload.get("cwd"), str):
                project = payload["cwd"]
        elif kind == "turn_context":
            if isinstance(payload.get("turn_id"), str) and isinstance(payload.get("model"), str):
                turn_models[payload["turn_id"]] = payload["model"]
                last_model = payload["model"]
        elif kind == "event_msg" and payload.get("type") == "task_started":
            attribution = payload.get("turn_attribution") or {}
            turn = attribution.get("turn_id") if isinstance(attribution, dict) else None
            if isinstance(turn, str):
                turn_starts[turn] = ts
        elif kind == "event_msg" and payload.get("type") == "token_count":
            if token_count_anchor is None:
                token_count_anchor = ts
        elif kind == "token_usage_record":
            usage = payload.get("usage")
            thread = payload.get("thread_id")
            if not isinstance(usage, dict) or not isinstance(thread, str):
                continue
            turn = payload.get("turn_id")
            model = turn_models.get(turn, last_model) if isinstance(turn, str) else last_model
            duration = (
                _clamp_duration(ts, token_count_anchor)
                or _clamp_duration(ts, previous_in_thread.get(thread))
                or _clamp_duration(ts, turn_starts.get(turn) if isinstance(turn, str) else None)
                or FALLBACK_DUR
            )
            token_count_anchor = None
            previous_in_thread[thread] = ts
            records.append(TurnRecord(
                src="codex", sid=thread, proj=project, ts=ts, model=model,
                inTok=max(0, _integer(usage.get("input_tokens")) - _integer(usage.get("cached_input_tokens"))),
                cacheRead=_integer(usage.get("cached_input_tokens")),
                cacheWrite=_integer(usage.get("cache_write_input_tokens")),
                outTok=_integer(usage.get("output_tokens")),
                reasonTok=_integer(usage.get("reasoning_output_tokens")),
                durMs=duration,
            ))
    return records


def parse_dsh(_root: str, file: FileEntry) -> list[TurnRecord]:
    try:
        with open(file.path, encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, json.JSONDecodeError, UnicodeError):
        return []
    record = document.get("record") if isinstance(document, dict) else None
    if not isinstance(record, dict):
        return []
    identity = record.get("identity") or {}
    rows = record.get("rows") or {}
    totals = rows.get("tokenUsage", {}).get("val", {}).get("totals", {})
    stats = rows.get("sessionStats", {}).get("val", {})
    model = rows.get("modelSelection", {}).get("val", {}).get("lastUsed", {}).get("model")
    last_message = rows.get("timeContext", {}).get("val", {}).get("lastMessageTime")
    decode_ms = _number(stats.get("decodeMs"))
    if decode_ms <= 0:
        decode_ms = 0
    steps = _number(stats.get("steps"), -1)
    name = Path(file.path).stem
    sid = name.removeprefix("session-")
    ts = last_message if isinstance(last_message, (int, float)) and last_message > 0 else _number(identity.get("createdAt"))
    return [TurnRecord(
        src="dsh", sid=sid,
        proj=identity.get("cwd") if isinstance(identity.get("cwd"), str) else "",
        ts=ts, model=model if isinstance(model, str) else "deepseek",
        inTok=_integer(totals.get("uncachedInputTokens")),
        cacheRead=_integer(totals.get("cacheReadTokens")),
        cacheWrite=_integer(totals.get("cacheWriteTokens")),
        outTok=_integer(totals.get("outputTokens")), reasonTok=0,
        durMs=decode_ms, kind="session", requestCount=int(steps) if steps >= 0 else 0,
    )]


def parse_file(root: str, src: str, file: FileEntry) -> list[TurnRecord]:
    if src == "codex":
        return parse_codex(root, file)
    if src == "claude":
        return parse_claude(root, file)
    return parse_dsh(root, file)
