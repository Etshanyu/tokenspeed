from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .models import TurnRecord
from .sources import SOURCE_ORDER, UnsupportedLogFormat, available, discover, parse_file, zstd

CACHE_VERSION = 2


def default_cache_dir() -> Path:
    if os.environ.get("TOKENSPEED_CACHE_DIR"):
        return Path(os.environ["TOKENSPEED_CACHE_DIR"]).resolve()
    home = Path.home()
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local")) / "tokenspeed"
    if os.sys.platform == "darwin":
        return home / "Library" / "Caches" / "tokenspeed"
    return Path(os.environ.get("XDG_CACHE_HOME", home / ".cache")) / "tokenspeed"


def load_cache(cache_dir: Path) -> dict[str, Any] | None:
    try:
        with open(cache_dir / "index.json", encoding="utf-8") as handle:
            value = json.load(handle)
        if value.get("version") == CACHE_VERSION and isinstance(value.get("files"), dict):
            return value
    except (OSError, ValueError, AttributeError):
        pass
    return None


def save_cache(cache_dir: Path, store: dict[str, Any]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / "index.json"
    temporary = cache_dir / f"index.json.{os.getpid()}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(store, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(temporary, target)


def _cached_records(cached: Any) -> tuple[list[TurnRecord], list[dict]] | None:
    if not isinstance(cached, dict) or not isinstance(cached.get("records"), list):
        return None
    try:
        serialized = cached["records"]
        return [TurnRecord.from_dict(item) for item in serialized], serialized
    except (AttributeError, TypeError, ValueError):
        return None


def scan_all(root: str, cache_dir: Path, rescan: bool = False) -> tuple[list[TurnRecord], int, int]:
    cache = load_cache(cache_dir)
    cached_files = cache.get("files", {}) if cache else {}
    files: dict[str, Any] = {}
    records: list[TurnRecord] = []
    scanned = from_cache = 0
    for src in SOURCE_ORDER:
        if not available(root, src):
            continue
        for entry in discover(root, src):
            cached = cached_files.get(entry.path)
            cached_result = _cached_records(cached)
            if cached_result is None:
                cached = None
            if cached_result and entry.path.endswith(".zst") and zstd is None and cached.get("retry"):
                # Migrate retries produced by older versions without rescanning.
                cached = {**cached, "unsupported": "zstandard"}
                cached.pop("retry", None)
            cache_matches = cached.get("mtimeMs") == entry.mtimeMs and cached.get("size") == entry.size if cached else False
            decoder_reusable = not cached or cached.get("unsupported") != "zstandard" or zstd is None
            if not rescan and cached_result and not cached.get("retry") and cache_matches and decoder_reusable:
                file_records, _ = cached_result
                files[entry.path] = cached
                records.extend(file_records)
                from_cache += 1
                continue
            try:
                file_records = parse_file(root, src, entry)
            except UnsupportedLogFormat:
                # Missing optional decoders are stable until the next launch or a
                # full rescan. Avoid retrying every archive every five seconds.
                file_records, serialized = cached_result if cached_result else ([], [])
                files[entry.path] = {
                    "mtimeMs": entry.mtimeMs, "size": entry.size,
                    "records": serialized, "unsupported": "zstandard",
                }
            except Exception:
                # Transient parse failures keep the last good records and retry.
                file_records, serialized = cached_result if cached_result else ([], [])
                files[entry.path] = {
                    "mtimeMs": entry.mtimeMs, "size": entry.size,
                    "records": serialized, "retry": True,
                }
            else:
                files[entry.path] = {
                    "mtimeMs": entry.mtimeMs, "size": entry.size,
                    "records": [record.to_dict() for record in file_records],
                }
            scanned += 1
            records.extend(file_records)
    if rescan or cache is None or files != cached_files:
        save_cache(cache_dir, {"version": CACHE_VERSION, "files": files})
    return records, scanned, from_cache


def load_preferences(cache_dir: Path) -> dict[str, Any]:
    try:
        with open(cache_dir / "preferences.json", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    output: dict[str, Any] = {}
    if raw.get("page") in ("overview", "timeline", "models", "requests"):
        output["page"] = raw["page"]
    if raw.get("srcFilter") in ("all", *SOURCE_ORDER):
        output["srcFilter"] = raw["srcFilter"]
    if raw.get("win") in ("today", "7d", "30d", "all"):
        output["win"] = raw["win"]
    if isinstance(raw.get("themeIdx"), int) and not isinstance(raw.get("themeIdx"), bool) and raw["themeIdx"] >= 0:
        output["themeIdx"] = raw["themeIdx"]
    if raw.get("lang") in ("en", "zh"):
        output["lang"] = raw["lang"]
    return output


def save_preferences(cache_dir: Path, preferences: dict[str, Any]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / "preferences.json"
    temporary = cache_dir / f"preferences.json.{os.getpid()}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(preferences, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, target)
