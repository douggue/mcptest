"""Clip types for Find moments, and the past-performance summary.  Run:  python -m unittest discover tests

The AI is replaced by canned answers (good and malformed), so no key or network is needed.
Set CUTROOM_EXTRA_TRANSCRIPT to another word-timed JSON transcript to run the rule checks on it too.
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("CUTROOM_DATA", tempfile.mkdtemp(prefix="cutroom_test_"))

from server import agency_core  # noqa: E402
from server.studio import ai, cliptypes, moments, transcribe  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "sample_words.json"


def load_words(path: Path) -> list[dict]:
    return transcribe.import_file(path.name, path.read_bytes())["words"]


def transcripts() -> list[list[dict]]:
    out = [load_words(FIXTURE)]
    extra = os.environ.get("CUTROOM_EXTRA_TRANSCRIPT")
    if extra:
        out.append(load_words(Path(extra)))
    return out


class Shape:
    """Checks that hold for every clip type, whoever picked the clips."""

    def assert_sane(self, test: unittest.TestCase, words: list[dict], clips: list[dict]) -> None:
        starts = {round(w["start"], 3) for w in words}
        ends = {round(w["end"], 3) for w in words}
        first, last = words[0]["start"], words[-1]["end"]
        for c in clips:
            test.assertGreaterEqual(c["in"], first - 1e-6)
            test.assertLessEqual(c["out"], last + 1e-6)
            test.assertLess(c["in"], c["out"])
            for s in c.get("segments") or []:
                test.assertIn(round(s["start"], 3), starts, "segment starts on a word")
                test.assertIn(round(s["end"], 3), ends, "segment ends on a word")
            segs = c.get("segments") or []
            for a, b in zip(segs, segs[1:]):
                test.assertLess(a["end"], b["start"], "segments in order and apart")
            test.assertTrue(c["hook_title"])


class RulesWithoutKey(unittest.TestCase, Shape):
    def setUp(self):
        self.patch = mock.patch.object(ai, "available", return_value=False)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()

    def test_highlights_unchanged(self):
        for words in transcripts():
            a = cliptypes.find(words, "highlights", 3, 8, 15)
            b = moments.find_moments(words, 3, 8, 15)
            self.assertEqual(a, b)

    def test_series_parts_meet(self):
        for words in transcripts():
            r = cliptypes.find(words, "series", 3, 8, 15)
            clips = r["clips"]
            self.assertEqual(r["engine"], "rules")
            # as many parts as fit the minimum length: 37 s at 8-15 s a part is three parts
            self.assertGreaterEqual(len(clips), min(3, int((words[-1]["end"] - words[0]["start"]) // 8)))
            for k, c in enumerate(clips):
                self.assertTrue(c["hook_title"].startswith(f"Part {k + 1}: "))
                self.assertEqual(c["part"], k + 1)
            for a, b in zip(clips, clips[1:]):
                self.assertEqual(a["out"], b["in"], "adjacent parts share the cut point")
            self.assertEqual(clips[0]["in"], words[0]["start"])

    def test_topic_only_on_topic(self):
        words = load_words(FIXTURE)
        clips = cliptypes.find(words, "topic", 5, 8, 15, "sleep")["clips"]
        self.assertTrue(clips)
        for c in clips:
            text = " ".join(w["text"].lower() for w in words if c["in"] <= w["start"] < c["out"])
            self.assertIn("sleep", text)
        r = cliptypes.find(words, "topic", 5, 8, 15, "volcanoes")
        self.assertEqual(r["clips"], [])
        self.assertIn("mentions that topic", r["note"])

    def test_recap_one_clip_in_order(self):
        for words in transcripts():
            clips = cliptypes.find(words, "recap", 6, 10, 20)["clips"]
            self.assertEqual(len(clips), 1)
            self.assert_sane(self, words, clips)
            c = clips[0]
            kept = sum(s["end"] - s["start"] for s in c["segments"])
            self.assertLessEqual(kept, 20 * 1.15)
            self.assertEqual(c["in"], c["segments"][0]["start"])
            self.assertEqual(c["out"], c["segments"][-1]["end"])

    def test_trailer_keeps_the_ending_back(self):
        for words in transcripts():
            clips = cliptypes.find(words, "trailer", 6, 8, 15)["clips"]
            self.assertEqual(len(clips), 1)
            self.assert_sane(self, words, clips)
            limit = words[0]["start"] + (words[-1]["end"] - words[0]["start"]) * 2 / 3
            self.assertLessEqual(clips[0]["out"], limit + 1e-6)

    def test_instructions_need_ai(self):
        r = cliptypes.find(load_words(FIXTURE), "recap", 1, 10, 20, instructions="only the funny bits")
        self.assertIn("only followed with AI", r["note"])

    def test_empty_transcript(self):
        self.assertEqual(cliptypes.find([], "series")["clips"], [])


SERIES_GOOD = {"series_title": "S", "parts": [
    {"start_line": 0, "end_line": 2, "hook_title": "Caffeine before bed", "teaser": "how", "title": "One", "description": "", "hashtags": ["sleep"]},
    {"start_line": 3, "end_line": 4, "hook_title": "Part 2: Sleep score", "teaser": "fix", "title": "Two", "description": "", "hashtags": []},
    {"start_line": 5, "end_line": 7, "hook_title": "The fix", "teaser": "", "title": "", "description": "", "hashtags": []}]}
SERIES_BAD = {"series_title": "S", "parts": [
    {"start_line": 4, "end_line": 2, "hook_title": "Part 9: Later", "teaser": "", "title": "", "description": "", "hashtags": []},
    {"start_line": -3, "end_line": 1, "hook_title": "Start", "teaser": "x", "title": "Part 1 - Start", "description": "", "hashtags": []},
    {"start_line": 1, "end_line": 500, "hook_title": "End", "teaser": "", "title": "", "description": "", "hashtags": []},
    {"hook_title": "no lines"}]}


def match(a, b, h="M"):
    return {"start_line": a, "end_line": b, "hook_title": h, "reason": "r", "score_hook": 180, "score_flow": 70,
            "score_value": -5, "score_trend": 60, "title": h, "description": "", "hashtags": ["sleep"]}


def ranges(key, *pairs):
    return {key: [{"start_line": a, "end_line": b, "point": "p"} for a, b in pairs], "hook_title": "Hook", "reason": "r",
            "title": "T", "description": "d", "hashtags": ["x"]}


class WithAI(unittest.TestCase, Shape):
    def run_with(self, answer, kind, *args, **kw):
        with mock.patch.object(ai, "available", return_value=True), \
                mock.patch.object(ai, "ask_json", side_effect=answer if callable(answer) else (lambda *a, **k: answer)) as ask:
            words = load_words(FIXTURE)
            return words, cliptypes.find(words, kind, *args, **kw), ask

    def test_series_good(self):
        words, r, _ = self.run_with(SERIES_GOOD, "series", 3, 8, 15)
        self.assertEqual(r["engine"], "ai")
        titles = [c["hook_title"] for c in r["clips"]]
        self.assertEqual(titles[1], "Part 2: Sleep score")
        self.assertTrue(all(t.startswith(f"Part {i + 1}: ") for i, t in enumerate(titles)))
        for a, b in zip(r["clips"], r["clips"][1:]):
            self.assertEqual(a["out"], b["in"])

    def test_series_bad_is_made_contiguous(self):
        words, r, _ = self.run_with(SERIES_BAD, "series", 5, 8, 15)
        clips = r["clips"]
        self.assertEqual(r["engine"], "ai")
        self.assertEqual(clips[0]["in"], words[0]["start"])
        for k, c in enumerate(clips):
            self.assertTrue(c["hook_title"].startswith(f"Part {k + 1}: "))
            self.assertNotIn("Part 9", c["hook_title"])
            self.assertLessEqual(c["out"] - c["in"], 15 * 1.15 + 2)
        for a, b in zip(clips, clips[1:]):
            self.assertEqual(a["out"], b["in"])
        self.assertLessEqual(clips[-1]["out"], words[-1]["end"])

    def test_topic_drops_overlaps_and_junk(self):
        answer = {"topic_matches": [match(3, 4, "A"), match(4, 6, "Overlaps A"), match(99, 120, "Past the end"), {"start_line": 1}]}
        words, r, _ = self.run_with(answer, "topic", 5, 8, 15, "sleep")
        self.assertEqual([c["hook_title"] for c in r["clips"]], ["A"])
        self.assertEqual(r["clips"][0]["score"]["hook"], 100)
        self.assertEqual(r["clips"][0]["score"]["value"], 0)

    def test_topic_none_is_fine(self):
        words, r, _ = self.run_with({"topic_matches": []}, "topic", 5, 8, 15, "volcanoes")
        self.assertEqual((r["engine"], r["clips"]), ("ai", []))

    def test_recap_good(self):
        words, r, ask = self.run_with(ranges("recap_ranges", (0, 0), (4, 4), (7, 7)), "recap", 1, 10, 25)
        self.assertEqual(r["engine"], "ai")
        self.assertEqual(len(r["clips"]), 1)
        self.assertEqual(len(r["clips"][0]["segments"]), 3)
        self.assert_sane(self, words, r["clips"])
        self.assertIn("ONE short recap", ask.call_args[0][0])

    def test_recap_bad_ranges(self):
        words, r, _ = self.run_with(ranges("recap_ranges", (6, 7), (0, 0), (0, 1), (40, 60), (1, 1)), "recap", 1, 10, 20)
        c = r["clips"][0]
        self.assert_sane(self, words, r["clips"])
        self.assertLessEqual(sum(s["end"] - s["start"] for s in c["segments"]), 20 * 1.15)

    def test_trailer_never_reaches_the_end(self):
        words, r, _ = self.run_with(ranges("trailer_beats", (0, 0), (2, 2), (4, 4), (7, 7)), "trailer", 1, 10, 25)
        c = r["clips"][0]
        self.assertLessEqual(c["out"], words[-1]["end"] * 0.85)
        self.assert_sane(self, words, r["clips"])

    def test_unusable_answer_falls_back(self):
        words, r, _ = self.run_with({"recap_ranges": [{"start_line": "x"}]}, "recap", 1, 10, 20)
        self.assertEqual(r["engine"], "rules")
        self.assertEqual(len(r["clips"]), 1)

    def test_ai_error_falls_back(self):
        def fail(*a, **k):
            raise ai.AIUnavailable("down")
        words, r, _ = self.run_with(fail, "series", 3, 8, 15)
        self.assertEqual(r["engine"], "rules")
        self.assertIn("down", r["note"])

    def test_instructions_and_performance_reach_the_prompt(self):
        perf = {"count": 6, "top": [{"title": "Big", "seconds": 31.0, "views": 90000}], "bottom": [{"title": "Small", "seconds": None, "views": 12}],
                "top_quarter_median_seconds": 31.0}
        words, r, ask = self.run_with(SERIES_GOOD, "series", 3, 8, 15, instructions="Keep it calm", performance=perf)
        user = ask.call_args[0][1]
        self.assertIn("Keep it calm", user)
        self.assertIn('"Big" (31s): 90,000 views', user)
        self.assertIn("median length of 31 seconds", user)

    def test_highlights_prompt_unchanged_without_extras(self):
        seen = []
        answer = {"clips": [{"start_line": 0, "end_line": 1, "hook_title": "H", "reason": "r", "score_hook": 1, "score_flow": 1,
                             "score_value": 1, "score_trend": 1, "title": "t", "description": "d", "hashtags": []}]}
        def ask(system, user, schema, **k):
            seen.append(user)
            return answer
        words = load_words(FIXTURE)
        with mock.patch.object(ai, "available", return_value=True), mock.patch.object(ai, "ask_json", side_effect=ask):
            a = cliptypes.find(words, "highlights", 3, 8, 15)
            b = moments.find_moments(words, 3, 8, 15)
        self.assertEqual(a, b)
        self.assertEqual(seen[0], seen[1])
        self.assertNotIn("Instructions", seen[0])


class ApplyRanges(unittest.TestCase):
    def test_words_outside_are_removed_and_segments_match(self):
        words = load_words(FIXTURE)
        lines = moments.sentences(words)
        segs = [{"start": lines[0]["start"], "end": lines[0]["end"]}, {"start": lines[4]["start"], "end": lines[4]["end"]}]
        spec = {"in": segs[0]["start"], "out": segs[1]["end"],
                "words": [dict(w) for w in words if segs[0]["start"] - 0.05 <= w["start"] and w["end"] <= segs[1]["end"] + 0.05]}
        cliptypes.apply_ranges(spec, segs)
        self.assertEqual(len(spec["segments"]), 2)
        self.assertEqual(spec["ranges"], [{"start": round(s["start"], 3), "end": round(s["end"], 3)} for s in segs])
        self.assertAlmostEqual(spec["segments"][0]["start"], segs[0]["start"], places=3)
        self.assertAlmostEqual(spec["segments"][1]["end"], segs[1]["end"], places=3)
        kept = [w for w in spec["words"] if not w.get("removed")]
        self.assertTrue(all(any(s["start"] - 0.05 <= w["start"] <= s["end"] for s in segs) for w in kept))
        self.assertTrue(any(w.get("removed") for w in spec["words"]))


class PerformanceSummary(unittest.TestCase):
    def videos(self):
        return [{"key": f"export:e{i}", "title": f"Clip {i}", "duration": 10 + i * 5} for i in range(12)]

    def post(self, i, views, status="posted"):
        return {"id": f"p{i}", "video_key": f"export:e{i}", "status": status, "views": views}

    def test_too_few_posts(self):
        posts = [self.post(i, 100 * (i + 1)) for i in range(4)] + [self.post(5, 0), self.post(6, 999, "planned")]
        self.assertIsNone(agency_core.performance_summary(posts, self.videos()))

    def test_best_worst_and_median(self):
        posts = [self.post(i, 1000 * (i + 1)) for i in range(12)] + [{"id": "x", "video_title": "Typed title", "status": "paid", "views": 5}]
        s = agency_core.performance_summary(posts, self.videos())
        self.assertEqual(s["count"], 13)
        self.assertEqual([p["title"] for p in s["top"]], ["Clip 11", "Clip 10", "Clip 9", "Clip 8", "Clip 7"])
        self.assertEqual(s["bottom"][0], {"title": "Typed title", "seconds": None, "views": 5})
        self.assertEqual(len(s["bottom"]), 5)
        # top quarter = 3 posts: Clip 11 (65s), Clip 10 (60s), Clip 9 (55s)
        self.assertEqual(s["top_quarter_median_seconds"], 60.0)

    def test_small_sets_do_not_overlap(self):
        posts = [self.post(i, 10 * (i + 1)) for i in range(5)]
        s = agency_core.performance_summary(posts, self.videos())
        self.assertEqual(len(s["top"]) + len(s["bottom"]), 4)
        self.assertFalse({p["title"] for p in s["top"]} & {p["title"] for p in s["bottom"]})

    def test_note_is_empty_without_data(self):
        self.assertEqual(cliptypes.extra_note("", None), "")


if __name__ == "__main__":
    unittest.main()
