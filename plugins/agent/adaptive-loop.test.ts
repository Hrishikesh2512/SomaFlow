import { describe, expect, test } from "bun:test";
import { ToolLoopAgent, stepCountIs } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { streamRun } from "./adaptive-loop";

function mockModel(reply: string) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: reply },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ] as never,
      }),
    }),
  });
}

describe("streamRun", () => {
  test("returns final text and assistant response messages for history", async () => {
    const agent = new ToolLoopAgent({ model: mockModel("Hello there."), stopWhen: stepCountIs(3), tools: {} });
    const out = await streamRun(agent, { messages: [{ role: "user", content: "hi" }] });
    expect(out.text).toBe("Hello there.");
    expect(out.aborted).toBe(false);
    expect(out.messages.length).toBeGreaterThan(0);
    expect(out.messages[0]?.role).toBe("assistant");
  });

  test("handles an aborted signal gracefully without throwing", async () => {
    const agent = new ToolLoopAgent({ model: mockModel("ignored"), stopWhen: stepCountIs(3), tools: {} });
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await streamRun(agent, { messages: [{ role: "user", content: "go" }], abortSignal: ctrl.signal });
    expect(out.aborted).toBe(true);
  });
});
