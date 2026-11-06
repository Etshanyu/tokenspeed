from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable

from .models import TurnRecord

RATE_DURATION_MS = 520
STREAM_DURATION_MS = 1100
PULSE_DURATION_MS = 280


@dataclass(slots=True)
class RateMotion:
    start: float
    target: float
    started: float


@dataclass(slots=True)
class StreamMotion:
    started: float
    strength: float


@dataclass(slots=True)
class VisualEffects:
    """Short-lived visual state; never participates in telemetry calculations."""

    rates: dict[str, RateMotion] = field(default_factory=dict)
    streams: dict[str, StreamMotion] = field(default_factory=dict)
    totals: dict[str, int] | None = None
    pulse_kind: str | None = None
    pulse_started: float = 0.0

    @staticmethod
    def _rate_value(motion: RateMotion, now: float) -> float:
        progress = max(0.0, min(1.0, (now - motion.started) / RATE_DURATION_MS))
        eased = 1 - (1 - progress) ** 3
        return motion.start + (motion.target - motion.start) * eased

    def animated_rate(self, src: str, target: float | None, now: float) -> float | None:
        if target is None or not math.isfinite(target):
            self.rates.pop(src, None)
            return None
        motion = self.rates.get(src)
        if motion is None:
            self.rates[src] = RateMotion(target, target, now - RATE_DURATION_MS)
            return target
        if abs(motion.target - target) >= 0.05:
            motion = RateMotion(self._rate_value(motion, now), target, now)
            self.rates[src] = motion
        return self._rate_value(motion, now)

    def observe_records(self, records: Iterable[TurnRecord], now: float) -> None:
        current: dict[str, int] = {}
        for record in records:
            if record.is_request:
                current[record.src] = current.get(record.src, 0) + record.outTok
        if self.totals is not None:
            for src, total in current.items():
                delta = total - self.totals.get(src, 0)
                if delta > 0:
                    strength = min(1.0, 0.4 + math.log10(delta + 1) / 6)
                    self.streams[src] = StreamMotion(now, strength)
        self.totals = current

    def flow(self, src: str, now: float) -> tuple[float, float] | None:
        motion = self.streams.get(src)
        if motion is None:
            return None
        progress = (now - motion.started) / STREAM_DURATION_MS
        if not 0 <= progress < 1:
            return None
        return progress, motion.strength

    def trigger(self, kind: str, now: float) -> None:
        self.pulse_kind = kind
        self.pulse_started = now

    def sweep(self, now: float, allowed: tuple[str, ...]) -> float | None:
        if self.pulse_kind not in allowed:
            return None
        progress = (now - self.pulse_started) / PULSE_DURATION_MS
        return progress if 0 <= progress < 1 else None

    def active(self, now: float) -> bool:
        return (
            any(0 <= now - motion.started < RATE_DURATION_MS for motion in self.rates.values())
            or any(0 <= now - motion.started < STREAM_DURATION_MS for motion in self.streams.values())
            or (self.pulse_kind is not None and 0 <= now - self.pulse_started < PULSE_DURATION_MS)
        )
