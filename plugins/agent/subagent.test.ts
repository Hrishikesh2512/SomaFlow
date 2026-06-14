import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { makeTaskTool, subAgentToolSet } from "./adaptive-loop";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { defaultAgentConfig } from "./types";
import { MemoryStore } from "../../src/memory/store";

function textModel(reply: string) {
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

describe("sub-agents", () => {
  test("sub-agent tool set excludes `task` (no recursion) but keeps core tools", () => {
    const ex = new ToolExecutor(new ActionTracker(), defaultAgentConfig());
    const keys = Object.keys(subAgentToolSet(ex, new MemoryStore()));
    expect(keys).not.toContain("task");
    expect(keys).toContain("read_file");
    expect(keys).toContain("edit_file");
    expect(keys).toContain("update_plan");
  });

  test("task tool is well-formed and runs a sub-agent to completion, returning its summary", async () => {
    const config = defaultAgentConfig();
    const ex = new ToolExecutor(new ActionTracker(), config);
    const tool = makeTaskTool(ex, new MemoryStore(), config, () => textModel("Investigated; found 3 call sites."));

    expect(tool.description).toContain("sub-agent");
    expect(tool.execute).toBeDefined();

    const result = await tool.execute!(
      { description: "probe", prompt: "investigate the thing" },
      { toolCallId: "t1", messages: [] },
    );
    expect(result).toBe("Investigated; found 3 call sites.");
  });

  test("sub-agent shares the parent executor's staging", async () => {
    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const ex = new ToolExecutor(tracker, config);
    // Simulate the sub-agent staging an edit via the shared executor.
    ex.createFile("____sub_tmp.ts", "export const z = 1;\n");
    expect(tracker.getPendingMutations().some((a) => a.path === "____sub_tmp.ts")).toBe(true);
  });
});
