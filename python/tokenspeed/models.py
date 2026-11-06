from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


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
        data = asdict(self)
        if data["kind"] is None:
            data.pop("kind")
        if data["requestCount"] is None:
            data.pop("requestCount")
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TurnRecord":
        fields = {
            "src", "sid", "proj", "ts", "model", "inTok", "cacheRead",
            "cacheWrite", "outTok", "reasonTok", "durMs", "kind", "requestCount",
        }
        return cls(**{key: value for key, value in data.items() if key in fields})


@dataclass(slots=True, frozen=True)
class FileEntry:
    path: str
    mtimeMs: float
    size: int
