from __future__ import annotations

import ctypes
import os
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from .effects import VisualEffects
from .keyboard import Keyboard
from .store import load_preferences, save_preferences, scan_all
from .terminal import render_line
from .ui import THEMES, render_app

PAGES = ("overview", "timeline", "models", "requests")
SOURCES = ("all", "codex", "claude", "dsh")
WINDOWS = ("today", "7d", "30d", "all")


@dataclass(slots=True)
class AppState:
    page: str = "overview"
    src_filter: str = "all"
    win: str = "7d"
    theme_idx: int = 0
    lang: str = "en"
    scroll: int = 0
    sort_col: int = 4
    sort_dir: int = -1
    fx: VisualEffects | None = None

    @classmethod
    def from_preferences(cls, preferences: dict) -> "AppState":
        state = cls()
        state.page = preferences.get("page", state.page)
        state.src_filter = preferences.get("srcFilter", state.src_filter)
        state.win = preferences.get("win", state.win)
        state.theme_idx = preferences.get("themeIdx", state.theme_idx) % len(THEMES)
        state.lang = preferences.get("lang", state.lang)
        return state

    def preferences(self) -> dict:
        return {
            "page": self.page, "srcFilter": self.src_filter, "win": self.win,
            "themeIdx": self.theme_idx, "lang": self.lang,
        }

    def handle_key(self, key: str) -> str | None:
        if key in ("q", "Q"):
            return "quit"
        if key == "r":
            return "refresh"
        if key in ("f1", "f2", "f3", "f4"):
            self.page = PAGES[int(key[-1]) - 1]
            self.scroll = 0
        elif key in ("tab", "shift_tab"):
            direction = -1 if key == "shift_tab" else 1
            self.page = PAGES[(PAGES.index(self.page) + direction) % len(PAGES)]
            self.scroll = 0
        elif key in ("1", "2", "3", "4"):
            self.src_filter = SOURCES[int(key) - 1]
        elif key == "t":
            self.win = "today"
        elif key == "w":
            self.win = WINDOWS[(WINDOWS.index(self.win) + 1) % len(WINDOWS)]
        elif key == "a":
            self.win = "all"
        elif key in ("l", "L"):
            self.lang = "zh" if self.lang == "en" else "en"
        elif key == "x":
            self.theme_idx = (self.theme_idx + 1) % len(THEMES)
        elif key in ("up", "k"):
            self.scroll = max(0, self.scroll - 1)
        elif key in ("down", "j"):
            self.scroll += 1
        elif key == "g":
            self.scroll = 0
        elif key == "G":
            self.scroll = sys.maxsize
        elif key == "left":
            self.sort_col = max(0, self.sort_col - 1)
        elif key == "right":
            self.sort_col = min(8, self.sort_col + 1)
        elif key == "enter":
            self.sort_dir = 1 if self.sort_dir == -1 else -1
        else:
            return None
        return "changed"


def enable_windows_ansi() -> None:
    if os.name != "nt":
        return
    try:
        handle = ctypes.windll.kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            ctypes.windll.kernel32.SetConsoleMode(handle, mode.value | 0x0004)
    except (OSError, AttributeError, ValueError):
        pass


def draw(records, state: AppState, now: float, last_refresh: float, live: bool) -> None:
    size = shutil.get_terminal_size((120, 50))
    terminal_width = max(72, size.columns)
    lines = render_app(records, state, terminal_width, now, last_refresh, live)
    output = ["\x1b[H"]
    for line in lines[:max(1, size.lines - 1)]:
        output.append("\x1b[2K" + render_line(line, terminal_width) + "\r\n")
    output.append("\x1b[0J")
    sys.stdout.write("".join(output))
    sys.stdout.flush()


def run(root: str, cache_dir: Path, overrides: dict, live: bool = True, rescan: bool = False) -> None:
    enable_windows_ansi()
    sys.stdout.write("TokenSpeed · scanning local telemetry…\r\n")
    sys.stdout.flush()
    records, _, _ = scan_all(root, cache_dir, rescan)
    preferences = load_preferences(cache_dir)
    preferences.update({key: value for key, value in overrides.items() if value is not None})
    state = AppState.from_preferences(preferences)
    last_refresh = time.time() * 1000
    state.fx = VisualEffects()
    state.fx.observe_records(records, last_refresh)
    dirty = True
    running = True
    was_animating = False
    last_scan = time.monotonic()
    last_clock_second = -1
    with Keyboard() as reader:
        sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J")
        try:
            while running:
                for key in reader.read_keys():
                    previous = (state.page, state.src_filter, state.win)
                    action = state.handle_key(key)
                    if action == "quit":
                        running = False
                        break
                    if action == "refresh":
                        records, _, _ = scan_all(root, cache_dir)
                        last_refresh = time.time() * 1000
                        state.fx.observe_records(records, last_refresh)
                        last_scan = time.monotonic()
                    if action == "changed":
                        current_view = (state.page, state.src_filter, state.win)
                        kind = "page" if current_view[0] != previous[0] else "source" if current_view[1:] != previous[1:] else "ui"
                        state.fx.trigger(kind, time.time() * 1000)
                    if action:
                        save_preferences(cache_dir, state.preferences())
                    dirty = True
                if not running:
                    break
                if live and time.monotonic() - last_scan >= 5:
                    records, _, _ = scan_all(root, cache_dir)
                    last_refresh = time.time() * 1000
                    state.fx.observe_records(records, last_refresh)
                    last_scan = time.monotonic()
                    dirty = True
                current = time.time() * 1000
                clock_second = int(current / 1000)
                animating = state.fx.active(current)
                if dirty or clock_second != last_clock_second or animating or was_animating:
                    draw(records, state, current, last_refresh, live)
                    last_clock_second = clock_second
                    dirty = False
                was_animating = animating
                time.sleep(0.04)
        finally:
            sys.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l")
            sys.stdout.flush()
