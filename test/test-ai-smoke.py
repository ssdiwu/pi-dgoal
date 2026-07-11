#!/usr/bin/env python3
"""
AI 驱动 smoke：真实模型 × 隔离环境跑通多 phase dgoal 全工具链。

与 test-extension-rpc.py（离线、仅断言加载/命令注册）区别：
  - 不设 PI_OFFLINE（需联网调真实模型 + 建检/终审子进程也调模型）
  - Popen cwd 设为临时工作目录（主 agent 与 dgoal_check 子进程同 cwd）
  - 扩展 UI 回复以通过启动闸门：select 取 options[0]=confirmStart、confirm true、editor cancelled
  - 多轮事件循环，追踪 dgoal_* 工具调用与 agent_end

⚠️ 成本：消耗真实 token，需网络与已配置的 pi provider（API key）。不在 CI 跑。

成功判据（全部满足）：
  1. dgoal_propose / dgoal_plan / dgoal_check / dgoal_done 均被调用且 isError=false
  2. 目标文件产物（hello.txt）存在且内容正确
  3. 启动闸门 select 被正确回复（goal 进入 active）
  4. dgoal_done 终审 approved（result.details.audited=true）；rejected/aborted 同样 isError=false，不算通过

用法：
  python3 test/test-ai-smoke.py
  npm run test:smoke
"""
from __future__ import annotations

import json
import os
import select
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EXT_PATH = ROOT / "index.ts"


def resolve_pi_executable(root: Path = ROOT, env: dict[str, str] | None = None) -> str:
    """Pick the host Pi runtime rather than npm's potentially stale local dev dependency.

    Returns an absolute path when a host `pi` is found; raises if neither an
    override nor a host `pi` is available, so we never silently fall back to the
    stale `node_modules/.bin/pi` that npm injects into PATH.
    """
    source_env = os.environ if env is None else env
    override = source_env.get("PI_DGOAL_SMOKE_PI", "").strip()
    if override:
        return override

    local_bin = (root / "node_modules" / ".bin").resolve()
    path_entries = source_env.get("PATH", "").split(os.pathsep)
    host_path = os.pathsep.join(entry for entry in path_entries if Path(entry or ".").resolve() != local_bin)
    resolved = shutil.which("pi", path=host_path)
    if not resolved:
        raise RuntimeError(
            "未找到宿主 Pi 运行时（已排除项目 node_modules/.bin/pi）。“"
            "请用 PI_DGOAL_SMOKE_PI 显式指定，或确保宿主 pi 在 PATH 中。"
        )
    return resolved

# 不需要回复的 fire-and-forget UI 方法（rpc.md:996）
UI_NO_REPLY_METHODS = {"notify", "setStatus", "setWidget", "setTitle", "set_editor_text"}

# 全工具链硬性必需（空 phase 无法建检 → agent 必然调 dgoal_plan 推进 task，见 index.ts:767）
REQUIRED_TOOLS = ["dgoal_propose", "dgoal_plan", "dgoal_check", "dgoal_done"]

# 终止判定：agent_end 后连续 N 秒无新事件，视为 agent 自然停止（dgoal_done 成功返回 terminate:true 不再续跑）
IDLE_AFTER_AGENT_END = 20
# 单次读事件超时
READ_TIMEOUT = 6
# 总超时（含主 agent 多轮 + 每次 dgoal_check/done 的建检子进程 LLM 调用）
TOTAL_TIMEOUT = 900

EXPECTED_FILE = "hello.txt"
EXPECTED_CONTENT = "Hello from dgoal smoke"

# 轻引导两阶段（实现 + 验证），让 agent 自然组织多 phase；phases 仍由 agent 自己 propose
SMOKE_GOAL = (
    f"在当前目录创建 {EXPECTED_FILE}，写入内容：{EXPECTED_CONTENT}。"
    "然后独立验证文件内容与上述要求完全一致。请只调用一次 dgoal_propose，按「实现」「验证」两个阶段组织 plan，"
    "严格按 phase 数组顺序完成：每个 task 做完用 dgoal_plan 推进状态，每阶段 task 全部终态后调用 dgoal_check 建检，"
    "读取并遵循每次 dgoal_check 的结果；不要重复提案，不要跳过未通过或仍 pending 的 phase。"
    "只有当所有 phase 都已被 dgoal_check 明确通过且 plan 中没有 pending phase 时，才调用一次 dgoal_done 结束。"
)


@dataclass
class ToolCall:
    count: int = 0
    errors: int = 0


@dataclass
class SmokeResult:
    tmp_dir: str
    work_dir: str
    duration: float
    tool_calls: dict[str, ToolCall] = field(default_factory=dict)
    goal_activated: bool = False
    file_exists: bool = False
    file_content: str | None = None
    agent_ends: int = 0
    events_seen: int = 0
    done_audited: bool = False  # dgoal_done 终审 approved（details.audited=true）
    error: str | None = None
    stderr_tail: str = ""

    def required_tools_ok(self) -> bool:
        return all(
            name in self.tool_calls and self.tool_calls[name].errors == 0 and self.tool_calls[name].count > 0
            for name in REQUIRED_TOOLS
        )

    def file_ok(self) -> bool:
        return self.file_exists and self.file_content == EXPECTED_CONTENT

    def passed(self) -> bool:
        return self.error is None and self.goal_activated and self.required_tools_ok() and self.file_ok() and self.done_audited

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed(),
            "error": self.error,
            "duration_sec": round(self.duration, 1),
            "tmp_dir": self.tmp_dir,
            "work_dir": self.work_dir,
            "goal_activated": self.goal_activated,
            "tool_calls": {
                name: {"count": tc.count, "errors": tc.errors}
                for name, tc in sorted(self.tool_calls.items())
            },
            "required_tools": REQUIRED_TOOLS,
            "required_tools_ok": self.required_tools_ok(),
            "file": {
                "expected": EXPECTED_FILE,
                "exists": self.file_exists,
                "content_match": self.file_content == EXPECTED_CONTENT,
                "actual": self.file_content,
            },
            "agent_ends": self.agent_ends,
            "events_seen": self.events_seen,
            "done_audited": self.done_audited,
            "stderr_tail": self.stderr_tail[-2000:],
        }


@dataclass
class RpcSession:
    proc: subprocess.Popen[str]
    tmp_dir: str
    work_dir: str
    eof: bool = False

    @classmethod
    def start(cls, work_dir: str) -> "RpcSession":
        tmp_dir = tempfile.mkdtemp(prefix="pi-dgoal-ai-smoke.")
        env = os.environ.copy()
        # 不设 PI_CODING_AGENT_DIR：AI smoke 需用户真实 provider 凭据。隔离靠下面的 -ne/-ns/-np。
        # （设空目录会把凭据一起隔离，pi 拿不到 API key 卡在网络层。）
        # 让子进程能解析到 pi 主程序模块
        node_paths = ["/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules"]
        existing = env.get("NODE_PATH")
        env["NODE_PATH"] = ":".join([*node_paths, existing] if existing else node_paths)

        proc = subprocess.Popen(
            # -ne 禁用扩展发现 + -e 只加载本扩展；-ns/-np 禁用 skill/prompt 发现 → 真隔离
            [resolve_pi_executable(), "-ne", "-e", str(EXT_PATH), "-ns", "-np", "--mode", "rpc", "--no-session"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
            cwd=work_dir,
        )
        return cls(proc=proc, tmp_dir=tmp_dir, work_dir=work_dir)

    def send(self, obj: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def read_event(self, timeout: float = READ_TIMEOUT) -> dict[str, Any] | None:
        assert self.proc.stdout is not None
        readable, _, _ = select.select([self.proc.stdout], [], [], timeout)
        if not readable:
            return None
        line = self.proc.stdout.readline()
        if not line:
            self.eof = True  # pi 关闭 stdout（退出/崩溃）
            return None
        return json.loads(line.rstrip("\n"))

    def proc_alive(self) -> bool:
        return self.proc.poll() is None

    def close(self) -> str:
        try:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            pass
        assert self.proc.stderr is not None
        return self.proc.stderr.read().strip()


def handle_ui_request(session: RpcSession, event: dict[str, Any], result: SmokeResult) -> str | None:
    """回复扩展 UI 请求。返回 None=正常处理，返回字符串=致命问题（记 error）。"""
    method = event.get("method")
    request_id = event.get("id")
    if method in UI_NO_REPLY_METHODS:
        # fire-and-forget：notify/setStatus/setWidget/setTitle/set_editor_text，无需回复
        return None
    if method == "confirm":
        # replace/覆盖等确认，统一放行（smoke 全新环境，confirm 仅在 goal 已存在时触发）
        session.send({"type": "extension_ui_response", "id": request_id, "confirmed": True})
        return None
    if method == "select":
        # 启动闸门确认 plan：options[0] 恒为 confirmStart（index.ts buildProposalConfirmationOptions）
        options = event.get("options") or []
        if not options:
            return f"select 请求无 options：{json.dumps(event, ensure_ascii=False)}"
        session.send({"type": "extension_ui_response", "id": request_id, "value": options[0]})
        return None
    if method == "editor":
        # 仅「用户给反馈」分支用 editor；smoke 不给反馈 → cancelled（等同拒绝反馈）
        session.send({"type": "extension_ui_response", "id": request_id, "cancelled": True})
        return None
    if method == "input":
        session.send({"type": "extension_ui_response", "id": request_id, "cancelled": True})
        return None
    return f"未处理的 UI method: {method}"


def run_smoke(session: RpcSession, result: SmokeResult) -> None:
    deadline = time.time() + TOTAL_TIMEOUT
    last_agent_end_at: float | None = None
    done_ok = False  # dgoal_done 终审 approved（details.audited=true）——不可逆成功信号

    session.send({"id": "smoke-prompt", "type": "prompt", "message": f"/dgoal {SMOKE_GOAL}"})

    while time.time() < deadline:
        # pi 关闭 stdout 或进程退出
        if session.eof or not session.proc_alive():
            return

        event = session.read_event()
        if event is None:
            # 无事件：若此前 agent_end 且静默足够久，判定完成
            if last_agent_end_at is not None and (time.time() - last_agent_end_at) >= IDLE_AFTER_AGENT_END:
                return
            continue

        result.events_seen += 1
        etype = event.get("type")

        if etype == "extension_ui_request":
            method = event.get("method")
            # fire-and-forget（notify/setStatus 等）不重置静默计时——agent 完成后它们仍会飘来
            if method not in UI_NO_REPLY_METHODS:
                last_agent_end_at = None
            err = handle_ui_request(session, event, result)
            if err:
                result.error = err
                return
            continue

        if etype == "tool_execution_end":
            name = event.get("toolName") or ""
            if name.startswith("dgoal_"):
                tc = result.tool_calls.setdefault(name, ToolCall())
                tc.count += 1
                is_err = bool(event.get("isError"))
                if is_err:
                    tc.errors += 1
                print(f"[smoke] tool {name} #{tc.count} isError={is_err}", file=sys.stderr, flush=True)
                # dgoal_plan 成功 ⟺ goal 已 active（index.ts 硬约束：plan 只在 active 后工作）
                if name == "dgoal_plan" and not is_err:
                    result.goal_activated = True
                # dgoal_done 需终审 approved（details.audited=true）才算成功；
                # rejected / aborted / auditError 同样 isError=false，不能误判为通过。
                if name == "dgoal_done" and not is_err:
                    details = (event.get("result") or {}).get("details") or {}
                    if details.get("audited") is True:
                        done_ok = True
                        result.done_audited = True
                        result.error = None  # 清掉之前可能的 rejected 记录
                    elif not result.error:
                        result.error = f"dgoal_done 终审未通过（未收到 audited:true，details={details}）"
            continue

        if etype == "agent_end":
            result.agent_ends += 1
            last_agent_end_at = time.time()
            tools_so_far = ",".join(f"{n}×{tc.count}" for n, tc in sorted(result.tool_calls.items())) or "(none)"
            print(f"[smoke] agent_end #{result.agent_ends} | tools: {tools_so_far}", file=sys.stderr, flush=True)
            # dgoal_done 已成功 + agent_end 到达（terminate 生效）→ 完成
            if done_ok:
                return
            continue

        # 其余实质事件（agent_start/turn_*/message_*/tool_execution_start/update）重置静默
        last_agent_end_at = None

    result.error = result.error or f"总超时 {TOTAL_TIMEOUT}s（agent_ends={result.agent_ends}, tools={list(result.tool_calls)})"


def main() -> int:
    work_dir = tempfile.mkdtemp(prefix="pi-dgoal-ai-smoke-work.")
    print(f"[smoke] 隔离工作目录: {work_dir}", file=sys.stderr, flush=True)
    print(f"[smoke] Pi 运行时: {resolve_pi_executable()}（可用 PI_DGOAL_SMOKE_PI 覆盖）", file=sys.stderr, flush=True)
    print(f"[smoke] 目标: /dgoal {SMOKE_GOAL}", file=sys.stderr, flush=True)
    print(f"[smoke] ⚠️ 消耗真实 token（主 agent + 每次建检/终审子进程均调模型），需网络与已配置 provider", file=sys.stderr, flush=True)

    session = RpcSession.start(work_dir)
    result = SmokeResult(tmp_dir=session.tmp_dir, work_dir=work_dir, duration=0.0)
    start = time.time()
    try:
        run_smoke(session, result)
    except Exception as exc:  # noqa: BLE001
        result.error = f"driver 异常: {exc!r}"
    finally:
        result.duration = time.time() - start
        result.stderr_tail = session.close()

    # 产物核验
    file_path = Path(work_dir) / EXPECTED_FILE
    result.file_exists = file_path.exists()
    if result.file_exists:
        try:
            result.file_content = file_path.read_text(encoding="utf-8").rstrip("\n")
        except Exception as exc:  # noqa: BLE001
            result.file_content = f"<读取失败: {exc!r}>"

    payload = result.to_dict()
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    # 失败诊断指引
    if not result.passed():
        print("\n[smoke] 失败诊断：", file=sys.stderr)
        if not result.goal_activated:
            print("  - goal 未激活：检查启动闸门 select 是否被正确回复（options[0]=confirmStart）", file=sys.stderr)
        for name in REQUIRED_TOOLS:
            tc = result.tool_calls.get(name)
            if tc is None:
                print(f"  - {name} 未被调用", file=sys.stderr)
            elif tc.errors:
                print(f"  - {name} 有 {tc.errors} 次错误", file=sys.stderr)
        if not result.file_ok():
            print(f"  - 文件核验失败：exists={result.file_exists} content={result.file_content!r}", file=sys.stderr)

    return 0 if result.passed() else 1


if __name__ == "__main__":
    raise SystemExit(main())
