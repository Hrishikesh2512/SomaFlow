import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { estimateTokens, planCompaction } from "./adaptive-loop";

const user = (s: string): ModelMessage => ({ role: "user", content: s });
const asst = (s: string): ModelMessage => ({ role: "assistant", content: s });

describe("estimateTokens", () => {
  test("scales with content length", () => {
    const small = estimateTokens([user("hi")]);
    const big = estimateTokens([user("x".repeat(4000))]);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeGreaterThanOrEqual(1000); // ~4 chars/token
  });
});

describe("planCompaction", () => {
  test("returns null when there are fewer than two turns", () => {
    expect(planCompaction([user("only one")], 10)).toBeNull();
    expect(planCompaction([user("u"), asst("a")], 10)).toBeNull();
  });

  test("splits on a user boundary, keeping recent turns within budget", () => {
    const history: ModelMessage[] = [
      user("turn 1 " + "a".repeat(4000)),
      asst("reply 1 " + "b".repeat(4000)),
      user("turn 2 " + "c".repeat(4000)),
      asst("reply 2 " + "d".repeat(4000)),
      user("turn 3 short"),
      asst("reply 3 short"),
    ];
    // keep ~the last turn only (budget small enough to exclude turns 1-2)
    const plan = planCompaction(history, 200);
    expect(plan).not.toBeNull();
    // suffix must begin at a user message (no orphaned tool/assistant pairs)
    expect(plan!.suffix[0]?.role).toBe("user");
    // recent turn is preserved verbatim
    expect(plan!.suffix.some((m) => typeof m.content === "string" && m.content.includes("turn 3 short"))).toBe(true);
    // older bulky turns go to the prefix to be summarized
    expect(plan!.prefix.some((m) => typeof m.content === "string" && m.content.includes("turn 1"))).toBe(true);
    // every message is accounted for, in order
    expect(plan!.prefix.length + plan!.suffix.length).toBe(history.length);
  });

  test("keeps at least the final turn even when it alone exceeds the budget", () => {
    const history: ModelMessage[] = [
      user("old turn"),
      asst("old reply"),
      user("huge turn " + "z".repeat(8000)),
      asst("huge reply " + "z".repeat(8000)),
    ];
    const plan = planCompaction(history, 100);
    expect(plan).not.toBeNull();
    expect(plan!.suffix[0]?.role).toBe("user");
    expect(plan!.suffix[0]?.content).toContain("huge turn");
    expect(plan!.prefix.some((m) => m.content === "old turn")).toBe(true);
  });
});
