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


class SmokeResultPassedTest(unittest.TestCase):
    """负向回归：终审 rejected（isError=false 但 audited!=true）不得误判为通过。"""

    def _base_result(self) -> SMOKE.SmokeResult:
        r = SMOKE.SmokeResult(tmp_dir="/tmp", work_dir="/tmp", duration=0.0)
        r.goal_activated = True
        r.file_exists = True
        r.file_content = SMOKE.EXPECTED_CONTENT
        for name in SMOKE.REQUIRED_TOOLS:
            r.tool_calls[name] = SMOKE.ToolCall(count=1, errors=0)
        return r

    def test_passed_when_final_audit_approved(self) -> None:
        r = self._base_result()
        r.done_audited = True
        self.assertTrue(r.passed())

    def test_failed_when_final_audit_not_approved(self) -> None:
        # 终审 rejected/aborted 同样 isError=false，但 audited!=true → 不得通过
        r = self._base_result()
        r.done_audited = False
        self.assertFalse(r.passed())


if __name__ == "__main__":
    unittest.main()
