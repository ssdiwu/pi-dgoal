#!/usr/bin/env python3
"""真实模型候选链运行时回退 smoke。

临时复制认证配置，仅把审核主候选 zai-coding-cn 的 key 改为无效值：
预检仍识别该模型，运行时 401 后必须切到 MiniMax 备用候选。
phase_check / goal_check 的 details 必须含 fallback 尝试轨迹。

用法：python3 test/test-auditor-fallback-smoke.py
⚠️ 消耗真实 token，需网络与已配置 provider；临时认证副本退出即删除。
可用 PI_DGOAL_SMOKE_PI 覆盖 Pi 运行时。
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EXT_PATH = ROOT / "index.ts"

# 动态加载 test-ai-smoke.py 的 Pi 解析与 RpcSession（文件名含连字符，无法直接 import）
import importlib.util
import sys as _sys
_spec = importlib.util.spec_from_file_location("test_ai_smoke", ROOT / "test" / "test-ai-smoke.py")
_mod = importlib.util.module_from_spec(_spec)
_sys.modules["test_ai_smoke"] = _mod
_spec.loader.exec_module(_mod)
resolve_pi_executable = _mod.resolve_pi_executable
RpcSession = _mod.RpcSession
handle_ui_request = _mod.handle_ui_request

UI_NO_REPLY_METHODS = {"notify", "setStatus", "setWidget", "setTitle", "set_editor_text"}
EXPECTED_FILE = "hello.txt"
EXPECTED_CONTENT = "Hello from fallback smoke"
SMOKE_GOAL = (
    f"在当前目录创建 {EXPECTED_FILE}，写入内容：{EXPECTED_CONTENT}，并独立验证内容完全一致。"
    "这是候选回退 smoke：请用 goal_plan 按「实现」「验证」两个有独立验收条件的 phase 组织。"
    "每个 task 用 plan_update 推进，并带可复验证据标 done；每阶段 task 全部 done 后调用 phase_check，approved 后再 plan_update 标 phase done。"
    "全部 phase done 后调用 goal_check，approved 后 plan_update(target=goal,status=done) 收口。"
    "只能通过 /dgoal 启动闸门；goal_plan 确认前不得直接创建文件。"
)
TOTAL_TIMEOUT = 900
READ_TIMEOUT = 6
IDLE_AFTER_AGENT_END = 20

# 主候选有非空但无效的 key：get_available_models 仍可识别它，真实请求会 401。
# 备用候选与主 agent 都使用有效的 MiniMax，确保真实 fallback 可复验。
PRIMARY_MODEL = "zai-coding-cn/glm-4.7"
BACKUP_MODEL = "minimax-cn/MiniMax-M3"
FALLBACK_CONFIG = {
    "$comment": "smoke：ZAI 主候选运行时 401 后回退 MiniMax。",
    "phaseAuditorModels": [PRIMARY_MODEL, BACKUP_MODEL],
    "goalAuditorModels": [PRIMARY_MODEL, BACKUP_MODEL],
}


def start_runtime_fallback_session(work_dir: str, agent_dir: str) -> RpcSession:
    """以临时 agent dir 启动主 agent；主 agent 固定用有效 MiniMax。"""
    env = os.environ.copy()
    node_paths = ["/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules"]
    existing = env.get("NODE_PATH")
    env["NODE_PATH"] = ":".join([*node_paths, existing] if existing else node_paths)
    env["PI_CODING_AGENT_DIR"] = agent_dir
    proc = subprocess.Popen(
        [
            resolve_pi_executable(), "-ne", "-e", str(EXT_PATH), "-ns", "-np",
            "--mode", "rpc", "--no-session", "--model", BACKUP_MODEL,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=env,
        cwd=work_dir,
        start_new_session=True,
    )
    # RpcSession 保留 tmp_dir 字段仅为 driver 兼容；复用 agent_dir，外层 finally 统一清理。
    return RpcSession(proc=proc, tmp_dir=agent_dir, work_dir=work_dir)


def close_runtime_fallback_session(session: RpcSession) -> str:
    """终止 Pi 及其审核子进程，不阻塞读取可能被子进程继承的 stderr pipe。"""
    proc = session.proc
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=5)
    except ProcessLookupError:
        pass
    except Exception:
        # 清理不得因进程已退出或平台异常阻断外层临时目录回收。
        pass

    if proc.stderr is None:
        return ""
    try:
        os.set_blocking(proc.stderr.fileno(), False)
        chunks: list[bytes] = []
        while True:
            try:
                chunk = os.read(proc.stderr.fileno(), 8192)
            except BlockingIOError:
                break
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks).decode(errors="replace").strip()
    finally:
        proc.stderr.close()


def run_smoke(session: RpcSession, result: dict[str, Any]) -> None:
    deadline = time.time() + TOTAL_TIMEOUT
    last_agent_end_at: float | None = None
    done_ok = False
    ui_state = type("UiState", (), {"goal_activated": False})()

    session.send({"id": "smoke-prompt", "type": "prompt", "message": f"/dgoal {SMOKE_GOAL}"})

    while time.time() < deadline:
        if session.eof or not session.proc_alive():
            return

        event = session.read_event()
        if event is None:
            if last_agent_end_at is not None and (time.time() - last_agent_end_at) >= IDLE_AFTER_AGENT_END:
                return
            continue

        etype = event.get("type")

        if etype == "extension_ui_request":
            method = event.get("method")
            if method not in UI_NO_REPLY_METHODS:
                last_agent_end_at = None
            # 复用 test-ai-smoke.py 的 handle_ui_request（已验证的启动闸门回复逻辑）
            err = handle_ui_request(session, event, ui_state)  # type: ignore[arg-type]
            result["goal_activated"] = bool(ui_state.goal_activated)
            if err:
                result["error"] = err
                return
            continue

        if etype == "tool_execution_update":
            name = event.get("toolName") or ""
            partial_result = event.get("partialResult") or {}
            details = partial_result.get("details") if isinstance(partial_result, dict) else None
            if name in ("phase_check", "goal_check") and isinstance(details, dict) and details.get("transition") == "candidate_fallback":
                result.setdefault("candidate_fallback_updates", []).append({
                    "tool": name,
                    "auditorModel": details.get("auditorModel"),
                    "nextAuditorModel": details.get("nextAuditorModel"),
                    "transition": details.get("transition"),
                    "auditorAttempts": details.get("auditorAttempts"),
                })
            continue

        if etype == "tool_execution_end":
            name = event.get("toolName") or ""
            if name in _mod.PUBLIC_TOOLS:
                tc = result.setdefault("tool_calls", {}).setdefault(name, {"count": 0, "errors": 0})
                tc["count"] += 1
                is_err = bool(event.get("isError"))
                if is_err:
                    tc["errors"] += 1
                details = (event.get("result") or {}).get("details") or {}
                print(f"[smoke] tool {name} #{tc['count']} isError={is_err}", file=sys.stderr, flush=True)

                # 收集 phase_check / goal_check 的审核轨迹
                if name in ("phase_check", "goal_check") and not is_err:
                    attempts = details.get("auditorAttempts")
                    auditor_model = details.get("auditorModel")
                    candidates_exhausted = details.get("auditorCandidatesExhausted")
                    if attempts:
                        result.setdefault("auditor_traces", []).append({
                            "tool": name,
                            "auditorModel": auditor_model,
                            "auditorAttempts": attempts,
                            "candidatesExhausted": candidates_exhausted,
                        })

                if name == "plan_update" and not is_err and details.get("completed") is True and details.get("status") == "done":
                    done_ok = True
                    result["goal_completed"] = True
                    result["error"] = None
            continue

        if etype == "agent_end":
            result["agent_ends"] = result.get("agent_ends", 0) + 1
            last_agent_end_at = time.time()
            if done_ok:
                return
            continue

        last_agent_end_at = None

    result["error"] = result.get("error") or f"总超时 {TOTAL_TIMEOUT}s"


def run_smoke_main(work_dir: str, agent_dir: str) -> int:
    result: dict[str, Any] = {"tool_calls": {}, "agent_ends": 0, "auditor_traces": []}
    session: RpcSession | None = None
    start = time.time()
    try:
        source_auth = Path.home() / ".pi" / "agent" / "auth.json"
        source_auth_data = json.loads(source_auth.read_text(encoding="utf-8"))
        # 只给 smoke 所需的两个 provider 复制认证，避免异常终止时泄漏无关凭据。
        auth = {provider: source_auth_data[provider] for provider in ("zai-coding-cn", "minimax-cn")}
        auth["zai-coding-cn"]["key"] = "invalid-smoke-key"
        auth_path = Path(agent_dir) / "auth.json"
        auth_fd = os.open(auth_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(auth_fd, "w", encoding="utf-8") as auth_file:
            json.dump(auth, auth_file)
        # 候选链放在临时受信任项目路径；agent dir 仅承载临时认证副本。
        project_pi_dir = Path(work_dir) / ".pi"
        project_pi_dir.mkdir(parents=True)
        (project_pi_dir / "pi-dgoal.json").write_text(json.dumps(FALLBACK_CONFIG, ensure_ascii=False, indent=2), encoding="utf-8")

        print(f"[smoke] 隔离工作目录: {work_dir}", file=sys.stderr, flush=True)
        print(f"[smoke] 候选链配置: {FALLBACK_CONFIG['phaseAuditorModels']}", file=sys.stderr, flush=True)
        print(f"[smoke] ⚠️ 消耗真实 token（临时认证和工作目录均会清理）", file=sys.stderr, flush=True)

        session = start_runtime_fallback_session(work_dir, agent_dir)
        run_smoke(session, result)
    except Exception as exc:
        result["error"] = f"driver 异常: {exc!r}"
    finally:
        result["duration"] = time.time() - start
        if session is not None:
            try:
                result["stderr_tail"] = close_runtime_fallback_session(session)
            except Exception as exc:
                result["stderr_tail"] = f"close 异常: {exc!r}"
                result["error"] = result.get("error") or result["stderr_tail"]

    # 产物核验
    file_path = Path(work_dir) / EXPECTED_FILE
    result["file_exists"] = file_path.exists()
    if result["file_exists"]:
        try:
            result["file_content"] = file_path.read_text(encoding="utf-8").rstrip("\n")
        except Exception as exc:
            result["file_content"] = f"<读取失败: {exc!r}>"

    # 候选链回退核验
    traces = result.get("auditor_traces", [])
    result["has_traces"] = len(traces) > 0
    result["backup_model_used"] = any(t.get("auditorModel") == BACKUP_MODEL for t in traces)
    result["primary_fallback"] = any(
        any(a.get("modelId") == PRIMARY_MODEL and a.get("outcome") == "fallback" for a in t.get("auditorAttempts", []))
        for t in traces
    )
    result["candidate_fallback_seen"] = any(
        update.get("auditorModel") == PRIMARY_MODEL
        and update.get("nextAuditorModel") == BACKUP_MODEL
        and update.get("transition") == "candidate_fallback"
        for update in result.get("candidate_fallback_updates", [])
    )
    def has_complete_fallback(trace: dict[str, Any]) -> bool:
        attempts = trace.get("auditorAttempts", [])
        return (
            any(a.get("modelId") == PRIMARY_MODEL and a.get("outcome") == "fallback" for a in attempts)
            and any(a.get("modelId") == BACKUP_MODEL and a.get("outcome") == "approved" for a in attempts)
        )
    result["phase_fallback_count"] = sum(
        trace.get("tool") == "phase_check" and has_complete_fallback(trace)
        for trace in traces
    )
    result["goal_fallback_seen"] = any(
        trace.get("tool") == "goal_check" and has_complete_fallback(trace)
        for trace in traces
    )

    payload = json.dumps(result, ensure_ascii=False, indent=2)
    print(payload)

    # 判定
    passed = (
        result.get("goal_completed") is True
        and result.get("has_traces") is True
        and result.get("backup_model_used") is True
        and result.get("primary_fallback") is True
        and result.get("candidate_fallback_seen") is True
        and result.get("phase_fallback_count", 0) >= 2
        and result.get("goal_fallback_seen") is True
        and result.get("file_exists") is True
        and result.get("file_content") == EXPECTED_CONTENT
    )
    if not passed:
        print("\n[smoke] 失败诊断：", file=sys.stderr)
        if not result.get("goal_completed"):
            print("  - plan_update 未完成 goal", file=sys.stderr)
        if not result.get("has_traces"):
            print("  - 无审核轨迹（auditorAttempts）", file=sys.stderr)
        if not result.get("backup_model_used"):
            print("  - 备用模型未被采用", file=sys.stderr)
        if not result.get("primary_fallback"):
            print("  - 无主候选 fallback 尝试轨迹", file=sys.stderr)
        if not result.get("candidate_fallback_seen"):
            print("  - 未捕获 candidate_fallback 进度事件", file=sys.stderr)
        if result.get("phase_fallback_count", 0) < 2:
            print(f"  - 完成回退的 phase 建检少于两次: {result.get('phase_fallback_count', 0)}", file=sys.stderr)
        if not result.get("goal_fallback_seen"):
            print("  - 目标终审未留下完整回退轨迹", file=sys.stderr)
        if not result.get("file_exists"):
            print("  - 产物文件不存在", file=sys.stderr)
        if result.get("file_content") != EXPECTED_CONTENT:
            print(f"  - 产物内容不符: {result.get('file_content')!r}", file=sys.stderr)
        if result.get("error"):
            print(f"  - error: {result['error']}", file=sys.stderr)

    return 0 if passed else 1


def main() -> int:
    work_dir = tempfile.mkdtemp(prefix="pi-dgoal-fallback-smoke-work.")
    agent_dir = tempfile.mkdtemp(prefix="pi-dgoal-fallback-agent.")

    def exit_for_signal(signum: int, _frame: Any) -> None:
        # 将外部终止转为可展开 finally 的 SystemExit，保证认证副本不遗留。
        raise SystemExit(128 + signum)

    previous_handlers = {sig: signal.signal(sig, exit_for_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        return run_smoke_main(work_dir, agent_dir)
    finally:
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
        # 覆盖启动、运行、关闭、产物核验及 SIGINT/SIGTERM 的所有退出路径。
        shutil.rmtree(agent_dir, ignore_errors=True)
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())