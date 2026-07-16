import { describe, expect, test } from "bun:test";

import { __bindAuditorAbortForTest } from "../index.ts";
import { __bindIsolatedPiAbortForTest } from "../src/isolated-pi/index.ts";

describe("auditor abort listener", () => {
  test("runtime test export is the production isolated-child listener", () => {
    expect(__bindAuditorAbortForTest).toBe(__bindIsolatedPiAbortForTest);
  });

  test("removes the listener after a normally completed audit", () => {
    const controller = new AbortController();
    let abortCalls = 0;
    const unbind = __bindAuditorAbortForTest(controller.signal, () => {
      abortCalls += 1;
    });

    unbind();
    controller.abort();

    expect(abortCalls).toBe(0);
  });

  test("runs immediately without registering when the signal already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    let abortCalls = 0;

    const unbind = __bindAuditorAbortForTest(controller.signal, () => {
      abortCalls += 1;
    });

    expect(abortCalls).toBe(1);
    unbind();
  });
});
