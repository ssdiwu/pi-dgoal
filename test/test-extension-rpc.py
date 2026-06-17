#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import select
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
            ["pi", "-e", str(ROOT), "--mode", "rpc", "--no-session"],
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


def command_names(response: dict[str, Any]) -> set[str]:
    commands = response.get("commands") or response.get("data") or response.get("result") or []
    if isinstance(commands, dict):
        commands = commands.get("commands") or []
    return {str(command.get("name")) for command in commands if isinstance(command, dict)}


def assert_commands(session: RpcSession) -> dict[str, Any]:
    session.send({"id": "commands", "type": "get_commands"})
    response, _events = wait_for_response(session, "commands", timeout=25)
    if not response.get("success", True):
        raise AssertionError(f"get_commands failed: {response}")
    names = command_names(response)
    required = {"dgoal", "dloop"}
    missing = sorted(required - names)
    if missing:
        raise AssertionError(f"missing commands: {missing}; got sample={sorted(names)[:20]}")
    return {"required": sorted(required), "matched": sorted(required & names), "total_commands": len(names)}


def main() -> int:
    session = RpcSession.start()
    try:
        result = {
            "status": "ok",
            "tmp_dir": session.tmp_dir,
            "commands": assert_commands(session),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    finally:
        stderr = session.close()
        if stderr:
            print(json.dumps({"stderr": stderr}, ensure_ascii=False, indent=2))



if __name__ == "__main__":
    raise SystemExit(main())
