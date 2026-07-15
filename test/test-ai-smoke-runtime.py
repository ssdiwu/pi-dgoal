#!/usr/bin/env python3
"""Deterministic tests for the Pi executable chosen by the AI smoke driver."""
from __future__ import annotations

import importlib.util
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

SMOKE_PATH = Path(__file__).with_name("test-ai-smoke.py")
SPEC = importlib.util.spec_from_file_location("ai_smoke", SMOKE_PATH)
assert SPEC and SPEC.loader
SMOKE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SMOKE
SPEC.loader.exec_module(SMOKE)


class ResolvePiExecutableTest(unittest.TestCase):
    def make_executable(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR)

    def test_skips_project_local_pi_in_npm_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            local_bin = root / "node_modules" / ".bin"
            global_bin = Path(tmp) / "global-bin"
            self.make_executable(local_bin / "pi")
            self.make_executable(global_bin / "pi")

            selected = SMOKE.resolve_pi_executable(root=root, env={"PATH": os.pathsep.join([str(local_bin), str(global_bin)])})

            self.assertEqual(selected, str(global_bin / "pi"))

    def test_explicit_override_wins(self) -> None:
        selected = SMOKE.resolve_pi_executable(
            root=Path("/project"),
            env={"PI_DGOAL_SMOKE_PI": "/custom/pi", "PATH": "/other/bin"},
        )

        self.assertEqual(selected, "/custom/pi")

    def test_raises_when_only_stale_local_pi_available(self) -> None:
        # PATH 里只有项目 local .bin/pi（无宿主 pi）时，不得静默回退到它
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            local_bin = root / "node_modules" / ".bin"
            self.make_executable(local_bin / "pi")

            with self.assertRaises(RuntimeError):
                SMOKE.resolve_pi_executable(root=root, env={"PATH": str(local_bin)})


class HandleUiRequestTest(unittest.TestCase):
    class Session:
        def __init__(self) -> None:
            self.sent: list[dict[str, object]] = []

        def send(self, payload: dict[str, object]) -> None:
            self.sent.append(payload)

    def test_marks_goal_active_only_for_dgoal_start_gate(self) -> None:
        session = self.Session()
        result = SMOKE.SmokeResult(tmp_dir="/tmp", work_dir="/tmp", duration=0.0)
        error = SMOKE.handle_ui_request(session, {
            "method": "select",
            "id": "gate",
            "title": "确认 /dgoal 计划？",
            "options": ["确认，开始执行", "拒绝，放弃目标"],
        }, result)
        self.assertIsNone(error)
        self.assertTrue(result.goal_activated)
        self.assertEqual(session.sent[0]["value"], "确认，开始执行")

    def test_rejects_unrelated_select_without_faking_activation(self) -> None:
        session = self.Session()
        result = SMOKE.SmokeResult(tmp_dir="/tmp", work_dir="/tmp", duration=0.0)
        error = SMOKE.handle_ui_request(session, {
            "method": "select", "id": "other", "title": "Choose model", "options": ["A", "B"],
        }, result)
        self.assertIn("非预期 select", error or "")
        self.assertFalse(result.goal_activated)
        self.assertEqual(session.sent, [])


class SmokeResultPassedTest(unittest.TestCase):
    """负向回归：只有最终 plan_update 明确 completed 才算通过。"""

    def _base_result(self) -> SMOKE.SmokeResult:
        r = SMOKE.SmokeResult(tmp_dir="/tmp", work_dir="/tmp", duration=0.0)
        r.goal_activated = True
        r.file_exists = True
        r.file_content = SMOKE.EXPECTED_CONTENT
        for name in SMOKE.REQUIRED_TOOLS:
            r.tool_calls[name] = SMOKE.ToolCall(count=1, errors=0)
        return r

    def test_passed_when_goal_update_completed(self) -> None:
        r = self._base_result()
        r.goal_completed = True
        self.assertTrue(r.passed())

    def test_failed_when_goal_update_not_completed(self) -> None:
        # check rejected/aborted 可以是 isError=false，但没有 completed goal update 仍不得通过。
        r = self._base_result()
        r.goal_completed = False
        self.assertFalse(r.passed())


if __name__ == "__main__":
    unittest.main()
