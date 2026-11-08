from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from .models import TurnRecord
from .store import scan_all

ScanResult = tuple[list[TurnRecord], int, int]


class BackgroundScanner:
    """Serialize disk scans off the UI thread and coalesce queued refreshes."""

    def __init__(self, root: str, cache_dir: Path) -> None:
        self.root = root
        self.cache_dir = cache_dir
        self.last_error: Exception | None = None
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tokenspeed-scan")
        self._future: Future[ScanResult] | None = None
        self._queued_rescan: bool | None = None
        self._closed = False

    def __enter__(self) -> "BackgroundScanner":
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    def _start(self, rescan: bool) -> None:
        self._future = self._executor.submit(scan_all, self.root, self.cache_dir, rescan)

    def schedule(self, rescan: bool = False) -> None:
        if self._closed:
            return
        if self._future is None:
            self._start(rescan)
        elif self._queued_rescan is None:
            self._queued_rescan = rescan
        else:
            self._queued_rescan = self._queued_rescan or rescan

    @property
    def busy(self) -> bool:
        """Whether a scan is running or a manual refresh is already queued."""
        return self._future is not None or self._queued_rescan is not None

    def poll(self) -> ScanResult | None:
        if self._future is None or not self._future.done():
            return None
        future = self._future
        self._future = None
        try:
            result = future.result()
        except Exception as error:  # A background failure must not terminate input handling.
            self.last_error = error
            result = None
        else:
            self.last_error = None
        queued = self._queued_rescan
        self._queued_rescan = None
        if queued is not None and not self._closed:
            self._start(queued)
        return result

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._queued_rescan = None
        self._executor.shutdown(wait=False, cancel_futures=True)
