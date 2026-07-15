#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import select
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
UI_NO_REPLY_METHODS = {"notify", "setStatus", "setWidget", "set_editor_text", "setTitle"}


@dataclass
class RpcSession:
    proc: subprocess.Popen[str]
    tmp_dir: str

    @classmethod
    def start(cls) -> "RpcSession":
        tmp_dir = tempfile.mkdtemp(prefix="pi-dgoal-agent.")
        env = os.environ.copy()
        env["PI_CODING_AGENT_DIR"] = tmp_dir
        env["PI_OFFLINE"] = "1"
        node_paths = ["/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules"]
        existing_node_path = env.get("NODE_PATH")
        env["NODE_PATH"] = ":".join([*node_paths, existing_node_path] if existing_node_path else node_paths)
        proc = subprocess.Popen(
            [
                "pi",
                "-ne",
                "-e",
                str(ROOT / "index.ts"),
                "-e",
                str(ROOT / "test" / "rpc-tool-probe.ts"),
                "-ns",
                "-np",
                "--mode",
                "rpc",
                "--no-session",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )
        return cls(proc=proc, tmp_dir=tmp_dir)

    def send(self, obj: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def read_event(self, timeout: float = 2) -> dict[str, Any] | None:
        assert self.proc.stdout is not None
        readable, _, _ = select.select([self.proc.stdout], [], [], timeout)
        if not readable:
            return None
        line = self.proc.stdout.readline()
        if not line:
            return None
        return json.loads(line.rstrip("\n"))

    def close(self) -> str:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        assert self.proc.stderr is not None
        return self.proc.stderr.read().strip()


def wait_for_response(session: RpcSession, request_id: str, timeout: float) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        event = session.read_event(2)
        if event is None:
            continue
        events.append(event)
        if event.get("type") == "extension_ui_request":
            handle_ui_request(session, event)
            continue
        if event.get("type") == "response" and event.get("id") == request_id:
            return event, events
    raise TimeoutError(f"Timed out waiting for {request_id}; seen={[event.get('type') for event in events]}")


def handle_ui_request(session: RpcSession, event: dict[str, Any]) -> None:
    method = event.get("method")
    request_id = event.get("id")
    if method in UI_NO_REPLY_METHODS:
        return
    if method == "confirm":
        session.send({"type": "extension_ui_response", "id": request_id, "confirmed": True})
        return
    raise RuntimeError(f"Unhandled extension UI method: {method}")


def command_entries(response: dict[str, Any]) -> list[dict[str, Any]]:
    commands = response.get("commands") or response.get("data") or response.get("result") or []
    if isinstance(commands, dict):
        commands = commands.get("commands") or []
    return [command for command in commands if isinstance(command, dict)]


def assert_commands(session: RpcSession) -> dict[str, Any]:
    session.send({"id": "commands", "type": "get_commands"})
    response, _events = wait_for_response(session, "commands", timeout=25)
    if not response.get("success", True):
        raise AssertionError(f"get_commands failed: {response}")
    entries = command_entries(response)
    names = {str(command.get("name")) for command in entries}
    extension_names = {str(command.get("name")) for command in entries if command.get("source") == "extension"}
    if extension_names != {"dgoal"}:
        raise AssertionError(f"expected only the dgoal extension command; got={sorted(extension_names)}")
    return {"extension": sorted(extension_names), "total_commands": len(names)}


def assert_tools(session: RpcSession) -> dict[str, Any]:
    session.send({"id": "state", "type": "get_state"})
    state, events = wait_for_response(session, "state", timeout=25)
    if not state.get("success", False):
        raise AssertionError(f"get_state failed: {state}")

    prefix = "PI_DGOAL_RPC_TOOLS:"
    manifests = [
        str(event.get("message"))[len(prefix):]
        for event in events
        if event.get("type") == "extension_ui_request"
        and event.get("method") == "notify"
        and str(event.get("message", "")).startswith(prefix)
    ]
    if len(manifests) != 1:
        raise AssertionError(f"expected one RPC tool manifest, got={len(manifests)}")
    raw_names = [str(name) for name in json.loads(manifests[0])]
    names = set(raw_names)
    if len(raw_names) != len(names):
        raise AssertionError(f"duplicate tool registration detected: {raw_names}")
    required = {
        "task_plan",
        "phase_plan",
        "goal_plan",
        "plan_create",
        "plan_read",
        "plan_update",
        "phase_check",
        "goal_check",
    }
    retired = {"dgoal_" + suffix for suffix in ("propose", "plan", "check", "done", "pause")}
    missing = sorted(required - names)
    leaked = sorted(retired & names)
    # getAllTools() includes Pi built-ins, so names == required would be a false assertion.
    # Exact extension registration count is covered by three-plan-runtime.test.ts; RPC verifies
    # all eight names survive real host loading, are unique, and no retired public name leaks.
    registered_contract = sorted(required & names)
    if missing or leaked or len(registered_contract) != 8:
        raise AssertionError(f"tool registration mismatch: missing={missing}, retired={leaked}, all={sorted(names)}")
    return {"required": registered_contract, "retired": leaked, "total_tools": len(names)}


def main() -> int:
    session = RpcSession.start()
    try:
        result = {
            "status": "ok",
            "tmp_dir": session.tmp_dir,
            "tools": assert_tools(session),
            "commands": assert_commands(session),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    finally:
        stderr = session.close()
        if stderr:
            print(json.dumps({"stderr": stderr}, ensure_ascii=False, indent=2))
        shutil.rmtree(session.tmp_dir, ignore_errors=True)



if __name__ == "__main__":
    raise SystemExit(main())
