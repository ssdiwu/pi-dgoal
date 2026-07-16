import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";

export const SUBPROCESS_FORCE_KILL_TIMEOUT_MS = 5_000;

// 复刻官方 subagent 示例：bun 虚拟脚本不能作为 child entry 复用。
export function getPiInvocation(extraArgs: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...extraArgs] };
  }
  const execName = process.execPath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  return isGenericRuntime ? { command: "pi", args: extraArgs } : { command: process.execPath, args: extraArgs };
}

function canKillProcessGroup() {
  return process.platform !== "win32";
}

export type SpawnManagedSubprocess = (command: string, args: string[], cwd: string, stdin?: "ignore" | "pipe") => ChildProcess;

function spawnManagedSubprocessImpl(command: string, args: string[], cwd: string, stdin: "ignore" | "pipe" = "ignore") {
  return spawn(command, args, {
    cwd,
    shell: false,
    stdio: [stdin, "pipe", "pipe"],
    detached: canKillProcessGroup(),
  });
}

let spawnManagedSubprocess: SpawnManagedSubprocess = spawnManagedSubprocessImpl;

export function spawnIsolatedPi(command: string, args: string[], cwd: string, stdin: "ignore" | "pipe" = "ignore"): ChildProcess {
  return spawnManagedSubprocess(command, args, cwd, stdin);
}

// 测试专用：替换隔离子进程 spawn，保持生产行为不变。
export function __setSpawnManagedSubprocessForTest(spawnImpl: SpawnManagedSubprocess | undefined): void {
  spawnManagedSubprocess = spawnImpl ?? spawnManagedSubprocessImpl;
}

export function __resetSpawnManagedSubprocessForTest(): void {
  spawnManagedSubprocess = spawnManagedSubprocessImpl;
}

function sendManagedSignal(proc: ChildProcess, signal: NodeJS.Signals) {
  if (canKillProcessGroup() && typeof proc.pid === "number") {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      // The process group may already be gone; fall back to the direct child.
    }
  }
  try {
    proc.kill(signal);
  } catch {
    // Ignore already-exited races.
  }
}

export function terminateIsolatedPi(proc: ChildProcess, forceKillDelayMs = SUBPROCESS_FORCE_KILL_TIMEOUT_MS) {
  sendManagedSignal(proc, "SIGTERM");
  return setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) sendManagedSignal(proc, "SIGKILL");
  }, forceKillDelayMs);
}
