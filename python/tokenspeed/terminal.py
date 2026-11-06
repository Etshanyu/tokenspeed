from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

RESET = "\x1b[0m"


@dataclass(slots=True, frozen=True)
class Seg:
    text: str
    color: str | None = None
    bold: bool = False
    bg: str | None = None


def rgb(color: str, background: bool = False) -> str:
    value = color.lstrip("#")
    red, green, blue = (int(value[index:index + 2], 16) for index in (0, 2, 4))
    return f"\x1b[{48 if background else 38};2;{red};{green};{blue}m"


def char_width(char: str) -> int:
    if unicodedata.combining(char):
        return 0
    return 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1


def sanitize(value: str) -> str:
    value = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value)
    value = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", value)
    return "".join(char for char in value if ord(char) >= 32 and not 0x7F <= ord(char) <= 0x9F)


def width(value: str) -> int:
    return sum(char_width(char) for char in value)


def truncate(value: str, limit: int) -> str:
    value = sanitize(value)
    if limit < 1:
        return ""
    if width(value) <= limit:
        return value
    output = ""
    used = 0
    for char in value:
        size = char_width(char)
        if used + size > limit - 1:
            break
        output += char
        used += size
    return output + "…"


def fit(value: str, limit: int, align: str = "left") -> str:
    text = truncate(value, limit)
    padding = " " * max(0, limit - width(text))
    return padding + text if align == "right" else text + padding


def clip_segments(segments: Iterable[Seg], limit: int, pad: bool = False) -> list[Seg]:
    output: list[Seg] = []
    used = 0
    for segment in segments:
        if used >= limit:
            break
        text = truncate(segment.text, limit - used)
        if text:
            output.append(Seg(text, segment.color, segment.bold, segment.bg))
            used += width(text)
    if pad and used < limit:
        output.append(Seg(" " * (limit - used)))
    return output


def render_line(segments: Iterable[Seg], limit: int) -> str:
    output = []
    for segment in clip_segments(segments, limit):
        if segment.color:
            output.append(rgb(segment.color))
        if segment.bg:
            output.append(rgb(segment.bg, True))
        if segment.bold:
            output.append("\x1b[1m")
        output.append(segment.text)
        output.append(RESET)
    return "".join(output)


def blank(count: int = 1) -> list[list[Seg]]:
    return [[] for _ in range(count)]


def join_columns(columns: list[list[list[Seg]]], widths: list[int], gap: int = 1) -> list[list[Seg]]:
    height = max((len(column) for column in columns), default=0)
    output = []
    for row in range(height):
        line: list[Seg] = []
        for index, (column, column_width) in enumerate(zip(columns, widths)):
            if index:
                line.append(Seg(" " * gap))
            content = column[row] if row < len(column) else []
            line.extend(clip_segments(content, column_width, pad=True))
        output.append(line)
    return output


def _sweep_segments(text: str, color: str, glow: str, phase: float, perimeter: int, positions: Iterable[int]) -> list[Seg]:
    output = []
    for char, position in zip(text, positions):
        distance = abs(position / perimeter - phase)
        distance = min(distance, 1 - distance)
        intensity = max(0.0, 1 - distance / 0.12)
        output.append(Seg(char, mix_color(color, glow, intensity * 0.9)))
    return output


def panel(
    panel_width: int, height: int, title: list[Seg], content: list[list[Seg]], color: str,
    sweep: float | None = None, glow: str = "#e8fbff",
) -> list[list[Seg]]:
    # Accept a one-row title as well; this keeps simple panel call sites concise.
    if title and isinstance(title[0], list):
        title = title[0]
    inner = max(1, panel_width - 4)
    rows = [title, *content]
    perimeter = max(1, 2 * (panel_width + height - 4))
    top = "╭" + "─" * (panel_width - 2) + "╮"
    bottom = "╰" + "─" * (panel_width - 2) + "╯"
    if sweep is None:
        output: list[list[Seg]] = [[Seg(top, color)]]
    else:
        output = [_sweep_segments(top, color, glow, sweep, perimeter, range(panel_width))]
    for index in range(max(0, height - 2)):
        body = rows[index] if index < len(rows) else []
        left_color, right_color = color, color
        if sweep is not None:
            left = _sweep_segments("│", color, glow, sweep, perimeter, [2 * panel_width + height - 3 + height - index - 2])
            right = _sweep_segments("│", color, glow, sweep, perimeter, [panel_width + index])
            left_color, right_color = left[0].color or color, right[0].color or color
        output.append([
            Seg("│ ", left_color), *clip_segments(body, inner, pad=True), Seg(" │", right_color),
        ])
    if sweep is None:
        output.append([Seg(bottom, color)])
    else:
        positions = [panel_width + height - 2 + panel_width - 1 - x for x in range(panel_width)]
        output.append(_sweep_segments(bottom, color, glow, sweep, perimeter, positions))
    return output[:height]


def mix_color(from_color: str, to_color: str, position: float) -> str:
    position = max(0.0, min(1.0, position))
    start = [int(from_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    end = [int(to_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    values = [round(a + (b - a) * position) for a, b in zip(start, end)]
    return "#" + "".join(f"{value:02x}" for value in values)


def gradient_text(value: str, start: str, end: str, bold: bool = False) -> list[Seg]:
    return [
        Seg(char, mix_color(start, end, index / max(1, len(value) - 1)), bold)
        for index, char in enumerate(value)
    ]


def resample(values: list[float], count: int) -> list[float]:
    if count <= 0:
        return []
    if not values:
        return [0.0] * count
    output = [0.0] * count
    counts = [0] * count
    for index, value in enumerate(values):
        bucket = min(count - 1, int(index / len(values) * count))
        output[bucket] += value
        counts[bucket] += 1
    if len(values) > count:
        output = [value / counts[index] if counts[index] else 0 for index, value in enumerate(output)]
    return output


def sparkline(
    values: list[float], count: int, color: str,
    flow: tuple[float, float] | None = None,
) -> list[Seg]:
    sampled = resample(values, count)
    maximum = max(1, *sampled)
    levels = "▁▂▃▄▅▆▇█"
    output = []
    head = (flow[0] * (count + 7) - 4) if flow else -100
    for index, value in enumerate(sampled):
        pixel_color = color
        if flow and value > 0:
            distance = head - index
            if 0 <= distance < 5:
                intensity = (1 - distance / 5) * flow[1] * 0.85
                pixel_color = mix_color(color, "#e8fbff", intensity)
        output.append(Seg(levels[min(7, round(value / maximum * 7))], pixel_color))
    return output


def activity_strip(values: list[float], count: int, color: str, quiet: str, scale_max: float) -> list[Seg]:
    sampled = resample(values, count)
    maximum = max(1, scale_max, *sampled)
    levels = "▁▂▃▄▅▆▇█"
    output = []
    for value in sampled:
        if value <= 0:
            output.append(Seg("·", quiet))
        else:
            level = max(1, min(7, math.ceil(value / maximum * 7)))
            output.append(Seg(levels[level], color))
    return output


def gradient_bar(value: float, maximum: float, count: int, colors: tuple[str, str], track: str) -> list[Seg]:
    ratio = max(0.0, min(1.0, value / maximum)) if maximum > 0 else 0
    filled = round(ratio * count)
    return [
        Seg("█", mix_color(colors[0], colors[1], index / max(1, filled - 1)) if index < filled else track)
        for index in range(count)
    ]


def histogram(values: list[float], count: int, height: int, color: str) -> list[list[Seg]]:
    sampled = resample(values, count)
    maximum = max(1, *sampled)
    pixels = height * 2
    fills = [round(value / maximum * pixels) for value in sampled]
    rows = []
    for row in range(height):
        base = (height - 1 - row) * 2
        line = []
        for fill in fills:
            top, bottom = fill > base + 1, fill > base
            char = "█" if top and bottom else "▀" if top else "▄" if bottom else " "
            line.append(Seg(char, color if char != " " else None))
        rows.append(line)
    return rows


def timeline_chart(series: list[tuple[list[float], str]], height: int, accent: str) -> list[list[Seg]]:
    if not series or not series[0][0]:
        return []
    count = len(series[0][0])
    totals = [sum(values[index] for values, _ in series) for index in range(count)]
    moving = [sum(totals[max(0, index - 4):index + 1]) / len(totals[max(0, index - 4):index + 1]) for index in range(count)]
    maximum, max_moving = max(1, *totals), max(1, *moving)
    rows = []
    for row in range(height):
        base = (height - 1 - row) * 2
        line = []
        for index in range(count):
            dominant = max(series, key=lambda item: item[0][index])
            fill = round(totals[index] / maximum * height * 2)
            top, bottom = fill > base + 1, fill > base
            moving_point = base + 1 <= round(moving[index] / max_moving * height * 2) <= base + 2
            if moving_point and not top:
                line.append(Seg("·", accent))
            elif top and bottom:
                line.append(Seg("█", dominant[1]))
            elif top:
                line.append(Seg("▀", dominant[1]))
            elif bottom:
                line.append(Seg("▄", dominant[1]))
            else:
                line.append(Seg(" "))
        rows.append(line)
    return rows


SOLID_DIGITS = {
    "0": ("████", "█  █", "█  █", "█  █", "████"),
    "1": ("  █ ", " ██ ", "  █ ", "  █ ", "████"),
    "2": ("████", "   █", "████", "█   ", "████"),
    "3": ("████", "   █", " ███", "   █", "████"),
    "4": ("█  █", "█  █", "████", "   █", "   █"),
    "5": ("████", "█   ", "████", "   █", "████"),
    "6": ("████", "█   ", "████", "█  █", "████"),
    "7": ("████", "   █", "  █ ", " █  ", " █  "),
    "8": ("████", "█  █", "████", "█  █", "████"),
    "9": ("████", "█  █", "████", "   █", "████"),
    ".": ("  ", "  ", "  ", "  ", "█ "),
    "—": ("    ", "    ", "████", "    ", "    "),
}


def solid_number(value: str, color: str) -> list[list[Seg]]:
    glyphs = [SOLID_DIGITS.get(char, ("    ",) * 5) for char in value]
    return [[Seg(" ".join(glyph[row] for glyph in glyphs).rstrip(), color)] for row in range(5)]


def fmt_tok(value: float) -> str:
    if value < 1000:
        return str(round(value))
    for divisor, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if value >= divisor * 0.9995:
            text = f"{value / divisor:.1f}"
            return text.removesuffix(".0") + suffix
    return str(value)


def fmt_tps(value: float | None) -> str:
    if value is None or not math.isfinite(value):
        return "—"
    if value < 100:
        return f"{value:.1f}".removesuffix(".0")
    return str(round(value))


def fmt_pct(value: float) -> str:
    return f"{value * 100:.1f}".removesuffix(".0") + "%"


def fmt_duration(ms: float, lang: str = "en") -> str:
    seconds = int(ms // 1000)
    if seconds < 60:
        return f"{seconds}秒" if lang == "zh" else f"{seconds}s"
    minutes = seconds // 60
    if minutes < 60:
        if lang == "zh":
            return f"{minutes}分" if seconds % 60 == 0 else f"{minutes}分{seconds % 60}秒"
        return f"{minutes}m" if seconds % 60 == 0 else f"{minutes}m{seconds % 60}s"
    if minutes < 1440:
        hours = minutes // 60
        return f"{hours}小时{minutes % 60:02d}分" if lang == "zh" else f"{hours}h{minutes % 60:02d}m"
    days = minutes // 1440
    hours = (minutes % 1440) // 60
    return f"{days}天{hours}小时" if lang == "zh" else f"{days}d{hours}h"


def local_datetime(ts: float) -> datetime:
    return datetime.fromtimestamp(ts / 1000)
