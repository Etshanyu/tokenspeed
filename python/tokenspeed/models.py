from __future__ import annotations

from dataclasses import dataclass
from typing import Any

RECORD_FIELDS = (
    "src", "sid", "proj", "ts", "model", "inTok", "cacheRead",
    "cacheWrite", "outTok", "reasonTok", "durMs", "kind", "requestCount",
)


@dataclass(slots=True)
class TurnRecord:
    src: str
    sid: str
    proj: str
    ts: float
    model: str
    inTok: int = 0
    cacheRead: int = 0
    cacheWrite: int = 0
    outTok: int = 0
    reasonTok: int = 0
    durMs: float = 0
    kind: str | None = None
    requestCount: int | None = None

    @property
    def is_request(self) -> bool:
        return self.kind != "session"

    @property
    def requests(self) -> int:
        return 1 if self.is_request else max(0, self.requestCount or 0)

    def to_dict(self) -> dict[str, Any]:
        data = {
            "src": self.src, "sid": self.sid, "proj": self.proj, "ts": self.ts,
            "model": self.model, "inTok": self.inTok, "cacheRead": self.cacheRead,
            "cacheWrite": self.cacheWrite, "outTok": self.outTok,
            "reasonTok": self.reasonTok, "durMs": self.durMs,
        }
        if self.kind is not None:
            data["kind"] = self.kind
        if self.requestCount is not None:
            data["requestCount"] = self.requestCount
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TurnRecord":
        return cls(**{key: data[key] for key in RECORD_FIELDS if key in data})


@dataclass(slots=True, frozen=True)
class FileEntry:
    path: str
    mtimeMs: float
    size: int
