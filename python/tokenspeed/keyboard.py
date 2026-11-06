from __future__ import annotations

import os
import sys
import time
from collections.abc import Iterator

if os.name == "nt":
    import ctypes
    import msvcrt
    from ctypes import wintypes

    class KEY_EVENT_RECORD(ctypes.Structure):
        _fields_ = [
            ("bKeyDown", wintypes.BOOL), ("wRepeatCount", wintypes.WORD),
            ("wVirtualKeyCode", wintypes.WORD), ("wVirtualScanCode", wintypes.WORD),
            ("UnicodeChar", wintypes.WCHAR), ("dwControlKeyState", wintypes.DWORD),
        ]

    class INPUT_UNION(ctypes.Union):
        _fields_ = [("KeyEvent", KEY_EVENT_RECORD), ("Padding", ctypes.c_byte * 16)]

    class INPUT_RECORD(ctypes.Structure):
        _fields_ = [("EventType", wintypes.WORD), ("Event", INPUT_UNION)]
else:  # pragma: no cover - Windows is covered directly, POSIX via decoder tests
    import select
    import termios
    import tty

WINDOWS_SPECIAL = {
    ";": "f1", "<": "f2", "=": "f3", ">": "f4",
    "H": "up", "P": "down", "M": "right", "K": "left",
}

ESCAPE_KEYS = {
    "\x1bOP": "f1", "\x1b[11~": "f1",
    "\x1bOQ": "f2", "\x1b[12~": "f2",
    "\x1bOR": "f3", "\x1b[13~": "f3",
    "\x1bOS": "f4", "\x1b[14~": "f4",
    "\x1b[A": "up", "\x1b[B": "down",
    "\x1b[C": "right", "\x1b[D": "left",
    "\x1b[Z": "shift_tab",
}


def ordinary_key(value: str) -> str | None:
    if value == "\t":
        return "tab"
    if value in ("\r", "\n"):
        return "enter"
    if value == "\x03":
        return "q"
    return value if value else None


class EscapeDecoder:
    """Incremental decoder for terminals that deliver one sequence over several reads."""

    def __init__(self) -> None:
        self.pending = ""

    def feed(self, chunk: str) -> list[str]:
        self.pending += chunk
        output: list[str] = []
        while self.pending:
            token = self.pending[0]
            if self.pending.startswith("\x1bO"):
                if len(self.pending) < 3:
                    break
                token = self.pending[:3]
            elif self.pending.startswith("\x1b["):
                end = -1
                for index in range(2, len(self.pending)):
                    if 0x40 <= ord(self.pending[index]) <= 0x7E:
                        end = index
                        break
                if end < 0:
                    break
                token = self.pending[:end + 1]
            elif self.pending.startswith("\x1b"):
                if len(self.pending) < 2:
                    break
                token = self.pending[:2]
            self.pending = self.pending[len(token):]
            mapped = ESCAPE_KEYS.get(token, ordinary_key(token))
            if mapped:
                output.append(mapped)
        return output


class Keyboard:
    """Direct Windows key-state input with a console/termios fallback."""

    WINDOWS_VK = {
        0x09: "tab", 0x0D: "enter",
        0x25: "left", 0x26: "up", 0x27: "right", 0x28: "down",
        0x70: "f1", 0x71: "f2", 0x72: "f3", 0x73: "f4",
        0x31: "1", 0x32: "2", 0x33: "3", 0x34: "4",
        0x61: "1", 0x62: "2", 0x63: "3", 0x64: "4",
        0x41: "a", 0x47: "g", 0x4A: "j", 0x4B: "k", 0x4C: "l",
        0x51: "q", 0x52: "r", 0x54: "t", 0x57: "w", 0x58: "x",
        0x43: "c",
    }

    def __init__(self) -> None:
        self.decoder = EscapeDecoder()
        self._saved = None
        self._pressed: set[int] = set()
        self._console_handle = None
        self._console_mode = None
        self._user32 = None
        self._kernel32 = None
        if os.name == "nt":
            self._user32 = ctypes.windll.user32
            self._kernel32 = ctypes.windll.kernel32
            self._user32.GetForegroundWindow.restype = ctypes.c_void_p
            self._user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
            self._user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
            self._user32.GetAsyncKeyState.restype = ctypes.c_short
            self._kernel32.GetStdHandle.argtypes = [wintypes.DWORD]
            self._kernel32.GetStdHandle.restype = ctypes.c_void_p
            self._kernel32.GetConsoleMode.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD)]
            self._kernel32.SetConsoleMode.argtypes = [ctypes.c_void_p, wintypes.DWORD]
            self._kernel32.GetNumberOfConsoleInputEvents.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD)]
            self._kernel32.ReadConsoleInputW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]

    def __enter__(self) -> "Keyboard":
        if os.name == "nt":
            handle = self._kernel32.GetStdHandle(0xFFFFFFF6)  # STD_INPUT_HANDLE
            mode = wintypes.DWORD()
            if handle and handle != ctypes.c_void_p(-1).value and self._kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                self._console_handle = handle
                self._console_mode = mode.value
                self._kernel32.SetConsoleMode(handle, mode.value & ~0x0006)  # no line input / echo
        elif sys.stdin.isatty():
            self._saved = termios.tcgetattr(sys.stdin.fileno())
            tty.setraw(sys.stdin.fileno())
        return self

    def __exit__(self, *_args) -> None:
        if self._console_handle is not None and self._console_mode is not None:
            self._kernel32.SetConsoleMode(self._console_handle, self._console_mode)
            self._console_handle = None
        if self._saved is not None:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, self._saved)
            self._saved = None

    def read_keys(self) -> list[str]:
        if os.name == "nt":
            events = self._read_console_events()
            if events is not None:
                return events
            try:
                return self._read_windows_state()
            except (AttributeError, OSError):
                return list(self._read_windows())
        return self._read_posix()

    def _read_console_events(self) -> list[str] | None:
        if self._console_handle is None:
            return None
        count = wintypes.DWORD()
        if not self._kernel32.GetNumberOfConsoleInputEvents(self._console_handle, ctypes.byref(count)) or count.value == 0:
            return []
        records = (INPUT_RECORD * count.value)()
        read = wintypes.DWORD()
        if not self._kernel32.ReadConsoleInputW(self._console_handle, records, count.value, ctypes.byref(read)):
            return []
        output = []
        for record in records[:read.value]:
            if record.EventType != 1 or not record.Event.KeyEvent.bKeyDown:
                continue
            event = record.Event.KeyEvent
            key = self.WINDOWS_VK.get(event.wVirtualKeyCode)
            if not key:
                continue
            shift = bool(event.dwControlKeyState & 0x0010)
            control = bool(event.dwControlKeyState & 0x000C)
            if key == "tab" and shift:
                key = "shift_tab"
            elif key == "c" and control:
                key = "q"
            elif key in ("g", "l") and shift:
                key = key.upper()
            output.append(key)
        return output

    def _window_focused(self) -> bool:
        foreground = self._user32.GetForegroundWindow()
        if not foreground:
            return False
        buffer = ctypes.create_unicode_buffer(512)
        self._user32.GetWindowTextW(foreground, buffer, len(buffer))
        return "Token Speed Python" in buffer.value

    def _read_windows_state(self) -> list[str]:
        if not self._window_focused():
            self._pressed.clear()
            return []
        # Bit 15 means "down now"; bit 0 catches a complete press/release
        # between polls, which is essential for quick taps and injected keys.
        pressed = {
            vk for vk in self.WINDOWS_VK
            if self._user32.GetAsyncKeyState(vk) & 0x8001
        }
        new_keys = sorted(pressed - self._pressed)
        self._pressed = pressed
        shift = bool(self._user32.GetAsyncKeyState(0x10) & 0x8001)
        control = bool(self._user32.GetAsyncKeyState(0x11) & 0x8001)
        output = []
        for vk in new_keys:
            key = self.WINDOWS_VK[vk]
            if key == "tab" and shift:
                key = "shift_tab"
            elif key == "c" and control:
                key = "q"
            elif key in ("g", "l") and shift:
                key = key.upper()
            output.append(key)
        return output

    def _read_windows(self) -> Iterator[str]:
        try:
            while msvcrt.kbhit():
                value = msvcrt.getwch()
                if value in ("\x00", "\xe0"):
                    special = msvcrt.getwch()
                    mapped = WINDOWS_SPECIAL.get(special)
                    if mapped:
                        yield mapped
                else:
                    mapped = ordinary_key(value)
                    if mapped:
                        yield mapped
        except (OSError, EOFError):
            return

    def _read_posix(self) -> list[str]:  # pragma: no cover - exercised on POSIX terminals
        if not sys.stdin.isatty():
            time.sleep(0.04)
            return []
        ready, _, _ = select.select([sys.stdin], [], [], 0)
        if not ready:
            return []
        data = os.read(sys.stdin.fileno(), 1024).decode("utf-8", errors="ignore")
        return self.decoder.feed(data)
