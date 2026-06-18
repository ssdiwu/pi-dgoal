import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __terminateManagedSubprocessForTest } from "../index.ts";

const isWindows = process.platform === "win32";
let tempDirs: string[] = [];
let spawnedRoots: ChildProcess[] = [];

afterEach(async () => {
  for (const proc of spawnedRoots) {
    if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
      try { process.kill(-proc.pid, "SIGKILL"); } catch {}
      try { proc.kill("SIGKILL"); } catch {}
    }
  }
  spawnedRoots = [];
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("subprocess supervision", () => {
  test.if(!isWindows)("kills the full detached process group so close does not hang on inherited pipes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-dgoal-subprocess-"));
    tempDirs.push(dir);

    const childPath = path.join(dir, "grandchild.cjs");
    const parentPath = path.join(dir, "parent.cjs");

    await fs.writeFile(childPath, "setInterval(() => {}, 1000);\n", "utf8");
    await fs.writeFile(parentPath, [
      'const { spawn } = require("node:child_process");',
      'const path = require("node:path");',
      'spawn(process.execPath, [path.join(__dirname, "grandchild.cjs")], { stdio: ["ignore", "inherit", "inherit"] });',
      'process.on("SIGTERM", () => process.exit(0));',
      'setInterval(() => {}, 1000);',
      "",
    ].join("\n"), "utf8");

    const proc = spawn(process.execPath, [parentPath], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedRoots.push(proc);

    await Bun.sleep(100);
    __terminateManagedSubprocessForTest(proc, 25);

    await waitForClose(proc, 1000);
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
  });
});

function waitForClose(proc: ChildProcess, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`close timeout after ${timeoutMs}ms`)), timeoutMs);
    proc.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    proc.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
