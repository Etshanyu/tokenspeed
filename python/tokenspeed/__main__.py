from __future__ import annotations

import argparse
from pathlib import Path

from . import __version__
from .app import run
from .store import default_cache_dir
from .ui import THEMES


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="tokenspeed", description="Local-first token telemetry TUI (Python)")
    result.add_argument("--home", help="home containing .claude, .codex and .dsh")
    result.add_argument("--cache-dir", help="writable cache and preference directory")
    result.add_argument("--page", choices=("overview", "timeline", "models", "requests"))
    result.add_argument("--source", choices=("all", "codex", "claude", "dsh"))
    result.add_argument("--window", choices=("today", "7d", "30d", "all"))
    result.add_argument("--lang", choices=("en", "zh"))
    result.add_argument("--theme", help="theme name or zero-based index")
    result.add_argument("--no-live", action="store_true", help="disable automatic refreshes")
    result.add_argument("--rescan", action="store_true", help="ignore cached records")
    result.add_argument("--clear-cache", action="store_true", help="delete the record cache, then exit")
    result.add_argument("--version", action="version", version=__version__)
    return result


def main() -> None:
    args = parser().parse_args()
    cache_dir = Path(args.cache_dir).resolve() if args.cache_dir else default_cache_dir()
    if args.clear_cache:
        (cache_dir / "index.json").unlink(missing_ok=True)
        print(f"Token Speed cache cleared: {cache_dir / 'index.json'}")
        return
    theme_idx = None
    if args.theme is not None:
        if args.theme.isdigit():
            theme_idx = max(0, min(len(THEMES) - 1, int(args.theme)))
        else:
            theme_idx = next((index for index, theme in enumerate(THEMES) if theme["name"] == args.theme), 0)
    overrides = {
        "page": args.page, "srcFilter": args.source, "win": args.window,
        "lang": args.lang, "themeIdx": theme_idx,
    }
    run(
        str(Path(args.home).resolve()) if args.home else str(Path.home()),
        cache_dir, overrides, live=not args.no_live, rescan=args.rescan,
    )


if __name__ == "__main__":
    main()
