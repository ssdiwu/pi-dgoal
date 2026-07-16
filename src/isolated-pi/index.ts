// Isolated Pi process argument and stream helpers.

export const AUDITOR_TOOLS = ["read", "grep", "find", "ls", "bash"] as const;

export function buildCheckCliArgs(args: {
  modelId?: string;
  systemPrompt: string;
  task: string;
}): string[] {
  const procArgs = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills", "--tools", AUDITOR_TOOLS.join(",")];
  if (args.modelId) procArgs.push("--model", args.modelId);
  procArgs.push("--system-prompt", args.systemPrompt, args.task);
  return procArgs;
}

export function consumeBufferedLines(
  buffer: string,
  chunk: string,
  onLine: (line: string) => void,
  onActivity?: () => void,
): string {
  onActivity?.();
  const lines = `${buffer}${chunk}`.split("\n");
  const nextBuffer = lines.pop() || "";
  for (const line of lines) onLine(line);
  return nextBuffer;
}

export {
  __resetSpawnManagedSubprocessForTest,
  __setSpawnManagedSubprocessForTest,
  getPiInvocation,
  spawnIsolatedPi,
  SUBPROCESS_FORCE_KILL_TIMEOUT_MS,
  terminateIsolatedPi,
  type SpawnManagedSubprocess,
} from "./process.ts";
export {
  bindAbort as __bindIsolatedPiAbortForTest,
  classifyCheckEvent,
  fingerprintAuditWorkspace,
  runIsolatedPiCheck,
  type IsolatedAuditorErrorInfo,
  type IsolatedCheckLivenessState,
  type IsolatedCheckResult,
  type IsolatedCheckSnapshot,
  type IsolatedCheckUpdate,
  type RunIsolatedPiCheckArgs,
} from "./check.ts";
