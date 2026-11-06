from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .models import TurnRecord
from .sources import SOURCE_ORDER, available, discover, parse_file

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


def scan_all(root: str, cache_dir: Path, rescan: bool = False) -> tuple[list[TurnRecord], int, int]:
    cache = None if rescan else load_cache(cache_dir)
    cached_files = cache.get("files", {}) if cache else {}
    files: dict[str, Any] = {}
    records: list[TurnRecord] = []
    scanned = from_cache = 0
    for src in SOURCE_ORDER:
        if not available(root, src):
            continue
        for entry in discover(root, src):
            cached = cached_files.get(entry.path)
            file_records: list[TurnRecord]
            if cached and cached.get("mtimeMs") == entry.mtimeMs and cached.get("size") == entry.size:
                file_records = [TurnRecord.from_dict(item) for item in cached.get("records", [])]
                from_cache += 1
            else:
                try:
                    file_records = parse_file(root, src, entry)
                except (OSError, ValueError, RuntimeError):
                    # Never erase a valid cache because an optional decoder is absent
                    # or a log is temporarily unreadable during rotation.
                    file_records = [TurnRecord.from_dict(item) for item in cached.get("records", [])] if cached else []
                scanned += 1
            serialized = [record.to_dict() for record in file_records]
            files[entry.path] = {"mtimeMs": entry.mtimeMs, "size": entry.size, "records": serialized}
            records.extend(file_records)
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
