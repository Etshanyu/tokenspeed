from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

from tokenspeed.app import AppState
from tokenspeed.effects import PULSE_DURATION_MS, RATE_DURATION_MS, STREAM_DURATION_MS, VisualEffects
from tokenspeed.keyboard import EscapeDecoder, WINDOWS_SPECIAL, ordinary_key
from tokenspeed.metrics import apply_filters, model_stats, source_summaries, window_range
from tokenspeed.models import FileEntry, TurnRecord
from tokenspeed.sources import parse_claude, parse_codex, parse_dsh
from tokenspeed.store import load_cache, save_cache, scan_all
from tokenspeed.terminal import fmt_tok, render_line, solid_number, width
from tokenspeed.ui import render_app

NOW = 1_800_000_000_000


def record(src="codex", *, kind=None, ts=NOW, out=1000, duration=2000):
    return TurnRecord(
        src=src, sid=f"{src}-sid", proj="project", ts=ts, model=f"{src}-model",
        inTok=50, cacheRead=10, cacheWrite=0, outTok=out, durMs=duration,
        kind=kind, requestCount=12 if kind == "session" else None,
    )


class StateTests(unittest.TestCase):
    def test_chained_digits_return_to_all_and_language_round_trip(self):
        state = AppState()
        for key in "2341":
            state.handle_key(key)
        self.assertEqual(state.src_filter, "all")
        for key in "lL":
            state.handle_key(key)
        self.assertEqual(state.lang, "en")
        state.handle_key("4")
        self.assertEqual(state.src_filter, "dsh")
        state.handle_key("1")
        self.assertEqual(state.src_filter, "all")

    def test_function_tab_arrow_and_sort_keys(self):
        state = AppState()
        state.handle_key("f2")
        self.assertEqual(state.page, "timeline")
        state.handle_key("tab")
        self.assertEqual(state.page, "models")
        state.handle_key("shift_tab")
        self.assertEqual(state.page, "timeline")
        state.handle_key("f1")
        self.assertEqual(state.page, "overview")
        state.handle_key("right")
        self.assertEqual(state.sort_col, 5)
        state.handle_key("enter")
        self.assertEqual(state.sort_dir, 1)
        self.assertEqual(state.handle_key("q"), "quit")

    def test_windows_special_and_split_escape_sequences(self):
        self.assertEqual(WINDOWS_SPECIAL[";"], "f1")
        self.assertEqual(WINDOWS_SPECIAL[">"], "f4")
        self.assertEqual(WINDOWS_SPECIAL["H"], "up")
        self.assertEqual(ordinary_key("\t"), "tab")
        decoder = EscapeDecoder()
        self.assertEqual(decoder.feed("\x1b"), [])
        self.assertEqual(decoder.feed("OQ"), ["f2"])
        self.assertEqual(decoder.feed("2341lL"), list("2341lL"))
        self.assertEqual(decoder.feed("\x1b[Z"), ["shift_tab"])


class MetricTests(unittest.TestCase):
    def test_session_totals_stay_out_of_bounded_windows(self):
        records = [record("dsh", kind="session"), record("codex")]
        self.assertEqual(len(apply_filters(records, "all", window_range("7d", NOW))), 1)
        self.assertEqual(len(apply_filters(records, "all", window_range("all", NOW))), 2)

    def test_summary_and_models_keep_real_request_counts(self):
        rows = source_summaries([record("dsh", kind="session", out=3000, duration=3000)])
        self.assertTrue(rows[0]["cumulative"])
        self.assertEqual(rows[0]["reqs"], 12)
        self.assertEqual(rows[0]["avgTps"], 1000)
        models = model_stats([record("codex", out=1000), record("claude", out=500)])
        self.assertEqual(models[0]["share"], 1000 / 1500)
        self.assertEqual(models[0]["avgTps"], 500)

    def test_formatting_and_solid_digits(self):
        self.assertEqual(fmt_tok(1000), "1K")
        self.assertEqual(fmt_tok(2_500_000), "2.5M")
        self.assertEqual(solid_number("1.0", "#fff")[0][0].text, "  █     ████")


class ParserTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def entry(self, path: Path) -> FileEntry:
        stat = path.stat()
        return FileEntry(str(path), stat.st_mtime_ns / 1_000_000, stat.st_size)

    def test_claude_deduplicates_fragments_and_uses_user_anchor(self):
        path = self.root / ".claude" / "projects" / "proj" / "session.jsonl"
        path.parent.mkdir(parents=True)
        rows = [
            {"type": "user", "timestamp": "2026-01-01T00:00:00Z"},
            {"type": "assistant", "timestamp": "2026-01-01T00:00:02Z", "message": {"id": "m1", "model": "claude", "usage": {"input_tokens": 10, "output_tokens": 20}}},
            {"type": "assistant", "timestamp": "2026-01-01T00:00:03Z", "message": {"id": "m1", "model": "claude", "usage": {"input_tokens": 10, "output_tokens": 40}}},
        ]
        path.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
        records = parse_claude(str(self.root), self.entry(path))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].outTok, 40)
        self.assertEqual(records[0].durMs, 2000)

    def test_codex_uses_token_count_anchor_and_skips_cumulative_rows(self):
        path = self.root / "session.jsonl"
        rows = [
            {"type": "session_meta", "timestamp": "2026-01-01T00:00:00Z", "payload": {"cwd": "p"}},
            {"type": "turn_context", "timestamp": "2026-01-01T00:00:00Z", "payload": {"turn_id": "t1", "model": "gpt"}},
            {"type": "event_msg", "timestamp": "2026-01-01T00:00:01Z", "payload": {"type": "token_count"}},
            {"type": "token_usage_record", "timestamp": "2026-01-01T00:00:03Z", "payload": {"thread_id": "s1", "turn_id": "t1", "usage": {"input_tokens": 20, "cached_input_tokens": 5, "output_tokens": 30}}},
            {"type": "token_usage_record", "timestamp": "2026-01-01T00:00:04Z", "payload": {"thread_id": "s1"}},
        ]
        path.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
        records = parse_codex(str(self.root), self.entry(path))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].inTok, 15)
        self.assertEqual(records[0].durMs, 2000)

    def test_dsh_reads_cumulative_totals_without_fabricating_requests(self):
        path = self.root / "session-abc.json"
        path.write_text(json.dumps({"record": {
            "identity": {"cwd": "p", "createdAt": 1000},
            "rows": {
                "tokenUsage": {"val": {"totals": {"outputTokens": 200, "uncachedInputTokens": 30}}},
                "sessionStats": {"val": {"decodeMs": 4000, "steps": 7}},
                "modelSelection": {"val": {"lastUsed": {"model": "deepseek"}}},
                "timeContext": {"val": {"lastMessageTime": 5000}},
            },
        }}), encoding="utf-8")
        result = parse_dsh(str(self.root), self.entry(path))[0]
        self.assertEqual(result.sid, "abc")
        self.assertEqual(result.kind, "session")
        self.assertEqual(result.requestCount, 7)
        self.assertEqual(result.durMs, 4000)


class VisualEffectsTests(unittest.TestCase):
    def test_rate_transition_settles_on_exact_target(self):
        fx = VisualEffects()
        self.assertEqual(fx.animated_rate("codex", 100, NOW), 100)
        self.assertEqual(fx.animated_rate("codex", 200, NOW + 10), 100)
        middle = fx.animated_rate("codex", 200, NOW + 10 + RATE_DURATION_MS / 2)
        self.assertTrue(100 < middle < 200)
        self.assertTrue(fx.active(NOW + 100))
        self.assertEqual(fx.animated_rate("codex", 200, NOW + 10 + RATE_DURATION_MS), 200)
        self.assertFalse(fx.active(NOW + 10 + RATE_DURATION_MS))

    def test_stream_requires_new_output_and_then_stops(self):
        fx = VisualEffects()
        fx.observe_records([record("codex", out=1000)], NOW)
        self.assertIsNone(fx.flow("codex", NOW))
        fx.observe_records([record("codex", out=1000)], NOW + 50)
        self.assertIsNone(fx.flow("codex", NOW + 50))
        fx.observe_records([record("codex", out=1500)], NOW + 100)
        self.assertIsNotNone(fx.flow("codex", NOW + 100))
        self.assertIsNone(fx.flow("codex", NOW + 100 + STREAM_DURATION_MS))
        self.assertFalse(fx.active(NOW + 100 + STREAM_DURATION_MS))

    def test_sweep_preserves_layout_and_expires(self):
        fx = VisualEffects()
        fx.trigger("page", NOW)
        self.assertEqual(fx.sweep(NOW, ("page",)), 0)
        self.assertIsNone(fx.sweep(NOW, ("source",)))
        state = AppState(fx=fx)
        records = [record("codex"), record("claude"), record("dsh", kind="session")]
        animated = ["".join(segment.text for segment in line) for line in render_app(records, state, 120, NOW, NOW)]
        settled = ["".join(segment.text for segment in line) for line in render_app(records, state, 120, NOW + PULSE_DURATION_MS, NOW)]
        self.assertEqual(animated, settled)
        self.assertIsNone(fx.sweep(NOW + PULSE_DURATION_MS, ("page",)))


class RenderAndCacheTests(unittest.TestCase):
    def test_render_all_pages_bilingual_and_within_width(self):
        records = [record("codex"), record("claude", out=500), record("dsh", kind="session", out=2000)]
        state = AppState()
        for page in ("overview", "timeline", "models", "requests"):
            state.page = page
            for lang in ("en", "zh"):
                state.lang = lang
                lines = render_app(records, state, 120, NOW, NOW)
                self.assertTrue(lines)
                for line in lines:
                    ansi = render_line(line, 120)
                    plain = re.sub(r"\x1b\[[0-9;]*m", "", ansi)
                    self.assertLessEqual(width(plain), 120)
        state.page = "overview"
        state.lang = "en"
        overview = ["\n".join(segment.text for segment in line) for line in render_app(records, state, 120, NOW, NOW)]
        self.assertTrue(any("ACTIVITY MAP" in line and "MODEL USAGE" in line for line in overview))
        self.assertTrue(any("All-time · no time series" in line for line in overview))

    def test_cache_round_trip_and_incremental_scan(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            store = {"version": 2, "files": {"x": {"mtimeMs": 1, "size": 2, "records": [record().to_dict()]}}}
            save_cache(cache, store)
            self.assertEqual(load_cache(cache)["files"]["x"]["records"][0]["outTok"], 1000)
            root = Path(temporary) / "home"
            (root / ".dsh" / "storages" / "session_projcache" / "sessions").mkdir(parents=True)
            path = root / ".dsh" / "storages" / "session_projcache" / "sessions" / "session-a.json"
            path.write_text(json.dumps({"record": {"identity": {}, "rows": {}}}), encoding="utf-8")
            records, scanned, cached = scan_all(str(root), cache)
            self.assertEqual(len(records), 1)
            self.assertEqual((scanned, cached), (1, 0))
            records, scanned, cached = scan_all(str(root), cache)
            self.assertEqual((scanned, cached), (0, 1))


if __name__ == "__main__":
    unittest.main()
