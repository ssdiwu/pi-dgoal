import { beforeEach, describe, expect, test } from "bun:test";
import { stream as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { stream as streamOpenAI } from "@earendil-works/pi-ai/api/openai-responses";
import dgoal, { __resetGoalForTest } from "../index.ts";

const handlers: Record<string, (event: any, ctx: any) => any> = {};
const tools: any[] = [];
dgoal({
  registerTool: (tool: any) => tools.push(tool), registerCommand: () => {},
  on: (name: string, handler: any) => { handlers[name] = handler; },
  events: { emit: () => {} },
} as never);

function unionCount(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + unionCount(item), 0);
  const schema = value as Record<string, unknown>;
  return (Array.isArray(schema.type) || Array.isArray(schema.anyOf) ? 1 : 0)
    + Object.values(schema).reduce<number>((sum, item) => sum + unionCount(item), 0);
}

async function capturePayload(api: "anthropic-messages" | "openai-responses", selectedApi: string = api) {
  const model = {
    id: api === "anthropic-messages" ? "claude-sonnet-4-5" : "gpt-5", name: "offline fixture",
    api, provider: api === "anthropic-messages" ? "anthropic" : "openai", baseUrl: "https://offline.invalid",
    reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024,
    compat: api === "anthropic-messages" ? { supportsStrictTools: true } : { supportsStrictMode: true },
  };
  let before: any;
  let after: any;
  let networkCalls = 0;
  const stream = api === "anthropic-messages" ? streamAnthropic : streamOpenAI;
  const result = await stream(model as never, {
    systemPrompt: "test", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools,
  }, {
    apiKey: "offline-test-key", env: {},
    fetch: async () => { networkCalls += 1; throw new Error("network forbidden"); },
    onPayload: async (payload: unknown) => {
      before = structuredClone(payload);
      after = await handlers.before_provider_request?.({ payload }, { model: { ...model, api: selectedApi } }) ?? payload;
      throw new Error("offline payload captured");
    },
  } as never).result();
  expect(networkCalls).toBe(0);
  expect(result.errorMessage).toContain("offline payload captured");
  expect(before).toBeDefined();
  return { before, after };
}

describe("provider request compatibility without network or credentials", () => {
  beforeEach(__resetGoalForTest);

  test("Anthropic sends all nine dgoal tools without strict sampling's global union limit", async () => {
    const { before, after } = await capturePayload("anthropic-messages");
    expect(before.tools).toHaveLength(9);
    expect(before.tools.every((tool: any) => tool.strict === true)).toBe(true);
    expect(unionCount(before.tools)).toBeGreaterThan(16);
    expect(after.tools.every((tool: any) => tool.strict !== true)).toBe(true);
    for (let index = 0; index < before.tools.length; index += 1) {
      expect(after.tools[index].input_schema).toEqual(before.tools[index].input_schema);
      expect(after.tools[index].name).toBe(before.tools[index].name);
    }
  });

  test("OpenAI Responses keeps strict tool parameters unchanged", async () => {
    const { before, after } = await capturePayload("openai-responses");
    expect(before.tools.every((tool: any) => tool.strict === true)).toBe(true);
    expect(after).toEqual(before);
  });

  test("a virtual selection routed to Anthropic adapts the actual provider payload", async () => {
    const { before, after } = await capturePayload("anthropic-messages", "pi-virtual");
    expect(before.tools.every((tool: any) => tool.strict === true)).toBe(true);
    expect(after.tools.every((tool: any) => tool.strict !== true)).toBe(true);
    expect(after.tools.map((tool: any) => tool.input_schema)).toEqual(before.tools.map((tool: any) => tool.input_schema));
  });

  test("a virtual selection routed to OpenAI preserves Responses and Completions shapes", async () => {
    const { before, after } = await capturePayload("openai-responses", "pi-virtual");
    expect(after).toEqual(before);
    const parameters = { type: "object", properties: { phaseId: { anyOf: [{ type: "null" }, { type: "number" }] } } };
    const payload = { tools: [{ type: "function", function: { name: "phase_check", strict: true, parameters } }], messages: [] };
    expect(await handlers.before_provider_request?.({ payload }, { model: { api: "pi-virtual" } }) ?? payload).toEqual(payload);
    // Selection metadata may be stale even for a non-virtual custom route. The
    // provider's OpenAI shape must remain authoritative in that case as well.
    expect(await handlers.before_provider_request?.({ payload: before }, { model: { api: "anthropic-messages" } }) ?? before).toEqual(before);
  });

  test("Anthropic adaptation leaves other tools and caller payload untouched", async () => {
    const foreign = { name: "other_extension", strict: true, input_schema: { type: "object", properties: { value: { anyOf: [{ type: "null" }, { type: "string" }] } } } };
    const own = { name: "work_update", strict: true, input_schema: { type: "object", properties: { value: { anyOf: [{ type: "null" }, { type: "number" }] } } }, cache_control: { type: "ephemeral" } };
    const payload = { tools: [foreign, own], messages: [] };
    const original = structuredClone(payload);
    const adapted = await handlers.before_provider_request?.({ payload }, { model: { api: "anthropic-messages" } }) ?? payload;
    expect(adapted.tools[0]).toEqual(foreign);
    expect(adapted.tools[1].strict).not.toBe(true);
    expect(adapted.tools[1].input_schema).toEqual(own.input_schema);
    expect(adapted.tools[1].cache_control).toEqual(own.cache_control);
    expect(payload).toEqual(original);
  });

  test("a dgoal name without an Anthropic object input_schema is left untouched", async () => {
    for (const input_schema of [undefined, null, [], "object", { type: "string" }]) {
      const payload = { tools: [{ name: "work_update", strict: true, input_schema }] };
      expect(await handlers.before_provider_request?.({ payload }, { model: { api: "anthropic-messages" } }) ?? payload).toEqual(payload);
    }
  });
});
