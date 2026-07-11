#!/usr/bin/env python3
"""确定性验证候选回退 smoke 的认证最小化与 SIGTERM 清理。"""
import json
import os
import signal
import subprocess
import sys
import stat
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SMOKE = ROOT / "test" / "test-auditor-fallback-smoke.py"
PREFIXES = (
    "pi-dgoal-fallback-agent.*",
    "pi-dgoal-fallback-smoke-work.*",
    "pi-dgoal-fallback-rpc.*",
)
EXPECTED_AUTH_PROVIDERS = {"zai-coding-cn", "minimax-cn"}


class AuditorFallbackSmokeCleanupTest(unittest.TestCase):
    def test_sigterm_cleans_minimal_auth_copy_and_process_group(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-dgoal-fallback-cleanup-test.") as tmp:
            root = Path(tmp)
            home = root / "home"
            agent_home = home / ".pi" / "agent"
            agent_home.mkdir(parents=True)
            (agent_home / "auth.json").write_text(json.dumps({
                "zai-coding-cn": {"key": "real-zai-key"},
                "minimax-cn": {"key": "minimax-key"},
                "unrelated-provider": {"key": "must-not-copy"},
            }), encoding="utf-8")
            fake_pi = root / "fake-pi.py"
            fake_pid_path = root / "fake-pi.pid"
            fake_pi.write_text(
                "#!/usr/bin/env python3\nimport os\nimport time\nfrom pathlib import Path\nPath(os.environ['FAKE_PI_PID_FILE']).write_text(str(os.getpid()))\ntime.sleep(60)\n",
                encoding="utf-8",
            )
            fake_pi.chmod(0o700)
            before = temporary_dirs()
            env = os.environ | {"HOME": str(home), "PI_DGOAL_SMOKE_PI": str(fake_pi), "FAKE_PI_PID_FILE": str(fake_pid_path)}
            proc = subprocess.Popen([sys.executable, str(SMOKE)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                agent_dir = wait_for_new_agent_dir(before, timeout=5)
                auth_path = agent_dir / "auth.json"
                copied_auth = json.loads(auth_path.read_text(encoding="utf-8"))
                self.assertEqual(set(copied_auth), EXPECTED_AUTH_PROVIDERS)
                self.assertEqual(copied_auth["zai-coding-cn"]["key"], "invalid-smoke-key")
                self.assertEqual(stat.S_IMODE(auth_path.stat().st_mode), 0o600)
                fake_pid = int(wait_for_file(fake_pid_path, timeout=5).read_text(encoding="utf-8"))
                proc.send_signal(signal.SIGTERM)
                self.assertEqual(proc.wait(timeout=10), 128 + signal.SIGTERM)
                self.assertEqual(temporary_dirs() - before, set())
                self.assertFalse(process_exists(fake_pid))
            finally:
                if proc.poll() is None:
                    proc.kill()
                proc.communicate(timeout=5)
                for directory in temporary_dirs() - before:
                    # 测试失败时也不让临时认证副本遗留。
                    import shutil
                    shutil.rmtree(directory, ignore_errors=True)


def temporary_dirs() -> set[Path]:
    temp_root = Path(tempfile.gettempdir())
    return {directory for prefix in PREFIXES for directory in temp_root.glob(prefix) if directory.is_dir()}


def wait_for_new_agent_dir(before: set[Path], timeout: float) -> Path:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        candidates = [directory for directory in temporary_dirs() - before if directory.name.startswith("pi-dgoal-fallback-agent.")]
        if candidates:
            return candidates[0]
        time.sleep(0.05)
    raise AssertionError("smoke 未创建临时认证目录")


def wait_for_file(file_path: Path, timeout: float) -> Path:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if file_path.exists():
            return file_path
        time.sleep(0.05)
    raise AssertionError(f"未等到文件: {file_path}")


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


if __name__ == "__main__":
    unittest.main()
