import chalk from "chalk";
import { z } from "zod";
import { generateText, stepCountIs, tool, ToolLoopAgent } from "ai";
import type { ModelMessage, StreamTextResult, ToolSet } from "ai";
import type { AgentConfig, ActionLog } from "./types";
import { getAgentModel } from "../../src/ai";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { renderTerminalMarkdown } from "../../src/tui/terminal-md";
import { composeBeforeAfter, formatPatch } from "./diff-view";
import { runApprovalFlow } from "./approval";
import type { MemoryStore } from "../../src/memory/store";

/** Build a single unified diff of all currently-staged file mutations. */
function stagedPatch(tracker: ActionTracker): string {
  const byPath = new Map<string, ActionLog[]>();
  for (const a of tracker.getPendingMutations()) {
    if (a.type === "tool_execute" || a.type === "folder_create") continue;
    if (!byPath.has(a.path)) byPath.set(a.path, []);
    byPath.get(a.path)!.push(a);
  }
  const patches: string[] = [];
  for (const [p, acts] of byPath) {
    const sorted = acts.sort((x, y) => x.timestamp.getTime() - y.timestamp.getTime());
    const { before, after } = composeBeforeAfter(sorted);
    patches.push(formatPatch(p, before, after));
  }
  return patches.join("\n\n");
}

/** Flatten a message's content to plain text for sizing/summarizing. */
function msgText(m: ModelMessage): string {
  const c: unknown = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return JSON.stringify(part);
      })
      .join(" ");
  }
  return JSON.stringify(c);
}

/** Rough token estimate (~4 chars/token) — enough to decide when to compact. */
export function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += m.role.length + msgText(m).length;
  return Math.ceil(chars / 4);
}

/**
 * Decide how to split history for compaction: summarize an older `prefix`, keep
 * a recent `suffix`. The split always lands on a user-message boundary so no
 * assistant/tool-call pair is orphaned (which providers reject). Returns null
 * when there's nothing worth compacting.
 */
export function planCompaction(
  messages: ModelMessage[],
  recentBudgetTokens: number,
): { prefix: ModelMessage[]; suffix: ModelMessage[] } | null {
  const userIdx = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  if (userIdx.length < 2) return null;

  // Smallest user boundary whose suffix fits the budget → keep as much recent as fits.
  let split = -1;
  for (const idx of userIdx) {
    if (estimateTokens(messages.slice(idx)) <= recentBudgetTokens) {
      split = idx;
      break;
    }
  }
  if (split === -1) split = userIdx[userIdx.length - 1]!; // even the last turn exceeds budget
  if (split <= 0) return null;

  return { prefix: messages.slice(0, split), suffix: messages.slice(split) };
}

function serializeMessages(msgs: ModelMessage[]): string {
  return msgs.map((m) => `### ${m.role}\n${msgText(m)}`).join("\n\n");
}

type StreamInput = ({ prompt: string } | { messages: ModelMessage[] }) & {
  abortSignal?: AbortSignal;
};

interface Streamable<T extends ToolSet> {
  stream(opts: StreamInput): Promise<StreamTextResult<T, never>>;
}

function isAbort(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "AbortError" || /abort/i.test(String((e as Error)?.message ?? e));
}

export interface StreamOutcome {
  text: string;
  messages: ModelMessage[];
  aborted: boolean;
}

/**
 * Stream an agent run to the terminal, rendering reasoning, narration, and tool
 * activity live. Supports cancellation via abortSignal and returns the response
 * messages so the caller can extend the conversation.
 */
export async function streamRun<T extends ToolSet>(
  agent: Streamable<T>,
  input: StreamInput,
  toolIcon = chalk.green("  ⚙"),
): Promise<StreamOutcome> {
  let res: StreamTextResult<T, never>;
  try {
    res = await agent.stream(input);
  } catch (e) {
    if (isAbort(e)) return { text: "", messages: [], aborted: true };
    throw e;
  }

  let reasoning = false;
  let wroteText = false;
  let aborted = false;
  try {
    for await (const part of res.fullStream) {
      switch (part.type) {
        case "abort":
          aborted = true;
          break;
        case "reasoning-delta":
          if (!reasoning) { process.stdout.write(chalk.dim("\n  thinking: ")); reasoning = true; }
          process.stdout.write(chalk.dim(part.text));
          break;
        case "reasoning-end":
          if (reasoning) { process.stdout.write("\n"); reasoning = false; }
          break;
        case "text-delta":
          if (reasoning) { process.stdout.write("\n"); reasoning = false; }
          process.stdout.write(part.text);
          wroteText = true;
          break;
        case "tool-call": {
          if (wroteText || reasoning) { process.stdout.write("\n"); wroteText = false; reasoning = false; }
          const preview = JSON.stringify(part.input ?? {}).slice(0, 160);
          process.stdout.write(
            `${toolIcon} ${chalk.bold(String(part.toolName))} ${chalk.dim(preview + (preview.length >= 160 ? "..." : ""))}\n`,
          );
          break;
        }
        case "tool-error":
          process.stdout.write(
            `${chalk.red("  ✗")} ${chalk.bold(String(part.toolName))} ${chalk.red(String(part.error).slice(0, 200))}\n`,
          );
          break;
        case "error":
          process.stdout.write(`\n${chalk.red("Error: ")}${String(part.error).slice(0, 300)}\n`);
          break;
      }
      if (aborted) break;
    }
  } catch (e) {
    if (isAbort(e)) aborted = true;
    else throw e;
  }
  if (wroteText || reasoning) process.stdout.write("\n");

  let messages: ModelMessage[] = [];
  let text = "";
  try { messages = (await res.response).messages as ModelMessage[]; } catch { /* aborted */ }
  try { text = (await res.text).trim(); } catch { /* aborted */ }
  return { text, messages, aborted };
}

/** A live, mutable plan the agent maintains and renders as it learns. */
export function makePlanTool() {
  return tool({
    description:
      "Record or revise your working plan as a checklist. Call this once you've investigated enough to plan, " +
      "and again whenever the plan changes or a step's status changes. Always pass the FULL updated list. " +
      "Statuses: 'pending', 'in_progress' (exactly one at a time), 'done'.",
    inputSchema: z.object({
      steps: z
        .array(
          z.object({
            content: z.string().describe("Short imperative description of the step"),
            status: z.enum(["pending", "in_progress", "done"]).default("pending"),
          }),
        )
        .describe("The complete, updated checklist"),
    }),
    execute: async ({ steps }) => {
      const lines = steps.map((s) => {
        const box =
          s.status === "done" ? chalk.green("[x]")
          : s.status === "in_progress" ? chalk.yellow("[»]")
          : chalk.dim("[ ]");
        const label = s.status === "done" ? chalk.dim(s.content) : s.content;
        return `  ${box} ${label}`;
      });
      process.stdout.write("\n" + chalk.cyan("Plan") + "\n" + lines.join("\n") + "\n");
      return "Plan updated.";
    },
  });
}

const subAgentSystem = (codebasePath: string): string =>
  [
    "You are a SomaFlow sub-agent: a focused worker spawned to handle ONE well-scoped subtask in isolation.",
    "You CANNOT see the main conversation — work only from the instructions you are given. If they are insufficient, do your best and say so in your summary.",
    "Investigate with read_file, grep_content, and the semantic tools (find_definition, find_references, get_type, search_symbol) before changing anything. Never edit a file you haven't read.",
    "Prefer edit_file for changes. All file mutations are STAGED for the user's approval (shared with the main agent) — nothing is written to disk by you.",
    "Verify with get_diagnostics where relevant.",
    `Workspace root: ${codebasePath}`,
    "When done, reply with a concise but complete summary of what you found or changed — this summary is your ONLY output back to the main agent, so include anything it needs (file paths, symbols, decisions).",
  ].join("\n");

/** Tools available to a sub-agent — same as the main agent minus `task` (no recursion). */
export function subAgentToolSet(executor: ToolExecutor, memory: MemoryStore) {
  return { ...createAgentTools(executor, memory), update_plan: makePlanTool() };
}

/**
 * The `task` tool: delegate a focused subtask to a fresh sub-agent that reasons
 * in an isolated context but shares this workspace and staging. Keeps the main
 * conversation small. Sub-agents cannot spawn further sub-agents.
 */
export function makeTaskTool(
  executor: ToolExecutor,
  memory: MemoryStore,
  config: AgentConfig,
  getModel: typeof getAgentModel = getAgentModel,
) {
  return tool({
    description:
      "Delegate a focused, well-scoped subtask to a fresh sub-agent with its own clean context. Use for deep investigations or self-contained changes so the main conversation stays focused. The sub-agent shares your workspace and staging (its edits are staged for the same approval) but reasons in isolation and returns only a summary. Provide COMPLETE, standalone instructions — it cannot see this conversation.",
    inputSchema: z.object({
      description: z.string().describe("Short label for the subtask (a few words)"),
      prompt: z.string().describe("Complete, self-contained instructions for the sub-agent"),
    }),
    execute: async ({ description, prompt }) => {
      const sub = new ToolLoopAgent({
        model: getModel(),
        stopWhen: stepCountIs(40),
        instructions: subAgentSystem(config.codebasePath),
        tools: subAgentToolSet(executor, memory),
      });
      process.stdout.write(chalk.blue(`\n  ↳ sub-agent: `) + chalk.bold(description) + "\n");
      const out = await streamRun(sub, { prompt }, chalk.blue("    ·"));
      process.stdout.write(chalk.blue(`  ↳ sub-agent done: `) + chalk.dim(description) + "\n");
      return out.text || "(sub-agent finished without a summary)";
    },
  });
}

function buildSystem(opts: {
  codebasePath: string;
  context: unknown[];
  agentName?: string;
  extra?: string[];
}): string {
  const who = opts.agentName
    ? `You are ${opts.agentName}, SomaFlow's autonomous coding agent, operating directly in the user's repository.`
    : "You are SomaFlow, an autonomous coding agent operating directly in the user's repository.";
  return [
    who,
    "",
    "You are in an ongoing conversation with the user. They can give follow-up instructions, corrections, and new tasks across turns; keep earlier context in mind and let them steer.",
    "",
    "Work in a single adaptive loop — do NOT lock yourself into a plan made before reading the code:",
    "1. INVESTIGATE first. Use read_file, grep_content, get_repo_map and list_files, plus the semantic tools — find_definition, find_references, get_type, search_symbol — to understand the actual code before changing anything. Never edit a file you haven't read. Use find_references to see the blast radius before changing any shared function or type.",
    "2. PLAN with the update_plan tool once you understand the task, and REVISE it whenever you learn something that changes the approach. Keep exactly one step 'in_progress'.",
    "3. ACT incrementally: make a change, then verify it. Mark steps 'done' as you finish them.",
    "4. VERIFY your work with get_diagnostics (it reflects your staged edits, before they're applied) and run_tests before declaring done. If something fails, fix it and re-check.",
    "5. If the task is genuinely ambiguous or needs an irreversible decision, call ask_user instead of guessing.",
    "",
    "Delegation: for a deep, self-contained piece of work (a focused investigation or an isolated change), use the task tool to hand it to a sub-agent. It works in its own clean context and returns a summary, which keeps this conversation focused. Give it complete, standalone instructions.",
    "",
    "Editing rules:",
    "- Prefer edit_file (batch find/replace) for changing existing files; use replace_in_file for a single edit and modify_file only for whole-file rewrites or brand-new content.",
    "- Match on a few distinctive lines with enough surrounding context to be unique; whitespace/indentation need not be exact, but the text must be.",
    "- read_file reflects your own staged (un-applied) edits, so you can read back what you just changed.",
    "- All file mutations are STAGED and shown to the user for approval — nothing touches disk until they approve.",
    "",
    `Workspace root: ${opts.codebasePath}`,
    ...(opts.extra ?? []),
    opts.context.length > 0 ? `Relevant memory from earlier:\n${JSON.stringify(opts.context)}` : "",
    "When finished with a turn, give a brief summary of what you changed and why.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface SessionOptions {
  config: AgentConfig;
  memory: MemoryStore;
  context: unknown[];
  /** Optional agent persona name (e.g. "Arthur"). */
  agentName?: string;
  /** Extra system-prompt lines (e.g. a compact repo map). */
  extraSystem?: string[];
  /** Additional tools to expose to the agent (e.g. tools from MCP servers). */
  extraTools?: ToolSet;
  /** Max tool-loop steps per turn (default 60). */
  stepBudget?: number;
  /** Estimated-token size at which history is auto-compacted (default 60000). */
  compactThresholdTokens?: number;
  /** Estimated tokens of recent history to keep verbatim when compacting (default 20000). */
  recentWindowTokens?: number;
}

/**
 * A steerable, multi-turn coding session. Conversation history persists across
 * turns, so the user can give follow-ups, corrections, and new tasks with full
 * context. Each turn streams live and can be interrupted with Ctrl-C.
 */
export class Session {
  private history: ModelMessage[] = [];
  private readonly instructions: string;
  private readonly compactThreshold: number;
  private readonly recentWindow: number;

  constructor(private readonly opts: SessionOptions) {
    this.instructions = buildSystem({
      codebasePath: opts.config.codebasePath,
      context: opts.context,
      agentName: opts.agentName,
      extra: opts.extraSystem,
    });
    this.compactThreshold = opts.compactThresholdTokens ?? 60000;
    this.recentWindow = opts.recentWindowTokens ?? 20000;
  }

  get turnCount(): number {
    return this.history.filter((m) => m.role === "user").length;
  }

  /** Approximate token size of the current conversation. */
  get estimatedTokens(): number {
    return estimateTokens(this.history);
  }

  /** Clear the conversation thread (start a fresh context). */
  reset(): void {
    this.history = [];
  }

  /**
   * Summarize older turns into a compact note, keeping recent turns verbatim.
   * Auto-invoked after each turn once history grows past the threshold; can also
   * be triggered manually. Returns true if anything was compacted.
   */
  async compact(): Promise<boolean> {
    const plan = planCompaction(this.history, this.recentWindow);
    if (!plan) {
      console.log(chalk.dim("  Nothing to compact yet.\n"));
      return false;
    }
    const before = this.estimatedTokens;
    let summary: string;
    try {
      const res = await generateText({
        model: getAgentModel(),
        system:
          "You are compacting a coding session to save context. Write a concise but COMPLETE summary that preserves everything load-bearing: " +
          "the user's goals and any explicit instructions or preferences, key decisions and why, files created/modified and their current state, " +
          "what is done vs still pending, and any unresolved questions. Be specific — name files, functions, and symbols. " +
          "This summary REPLACES the older messages, so omit nothing the agent would need to continue correctly.",
        prompt: `Conversation so far:\n\n${serializeMessages(plan.prefix)}`,
      });
      summary = res.text.trim();
    } catch {
      console.log(chalk.dim("  (Compaction unavailable — summarizer call failed; keeping full history.)\n"));
      return false;
    }

    this.history = [
      { role: "user", content: `[Summary of earlier conversation — older messages were compacted to save context]\n\n${summary}` },
      ...plan.suffix,
    ];
    console.log(
      chalk.dim(`\n  ⊙ Compacted conversation: ~${before} → ~${this.estimatedTokens} est. tokens.\n`),
    );
    return true;
  }

  private async compactIfNeeded(): Promise<void> {
    if (this.estimatedTokens >= this.compactThreshold) {
      await this.compact();
    }
  }

  /** Run one user turn end-to-end: stream → self-review → approval → auto-fix. */
  async runTurn(userInput: string): Promise<void> {
    const { config, memory } = this.opts;
    memory.add(`User: ${userInput}`, "event");

    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);
    const tools = {
      ...createAgentTools(executor, memory),
      update_plan: makePlanTool(),
      task: makeTaskTool(executor, memory, config),
      ...(this.opts.extraTools ?? {}),
    };
    const agent = new ToolLoopAgent({
      model: getAgentModel(),
      stopWhen: stepCountIs(this.opts.stepBudget ?? 60),
      instructions: this.instructions,
      tools,
    });

    const turnMessages: ModelMessage[] = [
      ...this.history,
      { role: "user", content: userInput },
    ];

    // ── ADAPTIVE LOOP (streamed, interruptible) ──────────────────────────────
    console.log(chalk.cyan("\n[Agent] Working...") + chalk.dim("  (Ctrl-C to interrupt)\n"));
    const ctrl = new AbortController();
    const onSigint = () => ctrl.abort();
    process.on("SIGINT", onSigint);
    let outcome: StreamOutcome;
    try {
      outcome = await streamRun(agent, { messages: turnMessages, abortSignal: ctrl.signal });
    } catch (err) {
      printApiError(err);
      return;
    } finally {
      process.off("SIGINT", onSigint);
    }
    turnMessages.push(...outcome.messages);

    if (outcome.aborted) {
      console.log(chalk.yellow("\n⏸  Interrupted. Reviewing whatever was staged so far.\n"));
    } else {
      await this.selfReview(agent, userInput, tracker, turnMessages);
    }

    // ── APPROVAL ──────────────────────────────────────────────────────────────
    const ok = await runApprovalFlow(tracker);
    if (ok) {
      const { errors } = executor.applyApprovedFromTracker();
      if (errors.length) {
        console.log(chalk.red("\nSome operations reported errors:\n"));
        for (const e of errors) console.log(chalk.red(`  • ${e}`));
      } else {
        console.log(chalk.green("\n✓ Applied.\n"));
        if (!outcome.aborted) await this.autoFix(config, memory);
      }
    }
    executor.clearStaging();

    // Commit this turn (including any self-review exchange) to the thread,
    // then auto-compact if the conversation has grown too large.
    this.history = turnMessages;
    await this.compactIfNeeded();
  }

  private async selfReview<T extends ToolSet>(
    agent: Streamable<T>,
    userInput: string,
    tracker: ActionTracker,
    turnMessages: ModelMessage[],
  ): Promise<void> {
    const patch = stagedPatch(tracker);
    if (!patch.trim()) return;

    console.log(chalk.cyan("\n[Reviewer] Critiquing the staged diff..."));
    let critique: string;
    try {
      const review = await generateText({
        model: getAgentModel(),
        system:
          "You are a strict senior code reviewer. Review the staged diff for the given task. " +
          "Report concrete problems: bugs, missing edge cases, broken imports/exports, type errors, or unmet requirements. " +
          "Be terse. If the diff fully and correctly satisfies the task, reply with exactly 'LGTM' and nothing else.",
        prompt: `Task:\n${userInput}\n\nStaged diff:\n${patch}`,
      });
      critique = review.text.trim();
    } catch {
      console.log(chalk.dim("  (Reviewer unavailable — skipping self-review)\n"));
      return;
    }

    if (/^lgtm\b/i.test(critique)) {
      console.log(chalk.green("  ✓ Reviewer: LGTM\n"));
      return;
    }

    console.log(chalk.yellow("▼ Reviewer found issues ▼\n") + renderTerminalMarkdown(critique) + "\n");
    console.log(chalk.cyan("[Reviser] Addressing reviewer feedback...\n"));
    const reviseMsgs: ModelMessage[] = [
      ...turnMessages,
      {
        role: "user",
        content:
          `A reviewer flagged issues with your staged changes:\n\n${critique}\n\n` +
          "Address them by editing the staged files. Only fix what the reviewer raised; do not start unrelated work.",
      },
    ];
    const revision = await streamRun(agent, { messages: reviseMsgs }, chalk.magenta("  ✎"));
    turnMessages.push(reviseMsgs[reviseMsgs.length - 1]!, ...revision.messages);
  }

  private async autoFix(config: AgentConfig, memory: MemoryStore): Promise<void> {
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const probe = new ToolExecutor(new ActionTracker(), config);
      console.log(chalk.cyan(`\n[Auto-Check] ESLint auto-fix + typecheck (attempt ${attempt + 1}/${MAX_RETRIES})...`));

      probe.runImmediateShell("bunx eslint --fix .");
      const eslintOutput = probe.runImmediateShell("bunx eslint .");
      const tscOutput = probe.runImmediateShell("bunx tsc --noEmit");

      const lintErrors = parseInt(eslintOutput.match(/\((\d+)\s+error/)?.[1] ?? "0", 10);
      const hasLintErrors = lintErrors > 0;
      const hasTscErrors = tscOutput.includes("error TS");

      if (!hasLintErrors && !hasTscErrors) {
        console.log(chalk.green("  ✓ Code quality checks passed — no errors.\n"));
        return;
      }

      console.log(chalk.yellow(`  ⚠ Found errors (Lint: ${hasLintErrors}, TS: ${hasTscErrors}). Auto-correcting...\n`));

      const fixTracker = new ActionTracker();
      const fixExecutor = new ToolExecutor(fixTracker, config);
      const fixAgent = new ToolLoopAgent({
        model: getAgentModel(),
        stopWhen: stepCountIs(20),
        instructions: [
          `You are ${this.opts.agentName ?? "SomaFlow"}'s Auto-Fix Agent.`,
          "The previous code changes introduced TypeScript or ESLint errors.",
          "Fix ONLY the errors shown below. Do not change unrelated code.",
          `Workspace root: ${config.codebasePath}`,
          ...(this.opts.extraSystem ?? []),
          "All mutations are staged until approval.",
        ].filter(Boolean).join("\n"),
        tools: createAgentTools(fixExecutor, memory),
      });

      await streamRun(
        fixAgent,
        { prompt: `Fix these errors:\n\n[ESLint Output]\n${eslintOutput}\n\n[TypeScript Output]\n${tscOutput}` },
        chalk.magenta("  🔧"),
      );

      if (fixTracker.getPendingMutations().length === 0) {
        console.log(chalk.dim("  No fixes proposed. Stopping auto-correction.\n"));
        return;
      }

      const fixOk = await runApprovalFlow(fixTracker);
      if (!fixOk) {
        fixExecutor.clearStaging();
        return;
      }

      const fixApply = fixExecutor.applyApprovedFromTracker();
      if (fixApply.errors.length) {
        console.log(chalk.red("  Auto-fix apply errors:"));
        for (const e of fixApply.errors) console.log(chalk.red(`    • ${e}`));
      } else {
        console.log(chalk.green("  ✓ Auto-fix applied.\n"));
      }
      fixExecutor.clearStaging();
    }
  }
}

/** Single-shot convenience wrapper around a one-turn Session. */
export async function runAdaptiveTask(opts: SessionOptions & { goal: string }): Promise<void> {
  const session = new Session(opts);
  await session.runTurn(opts.goal);
}

function printApiError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(chalk.red(`\n  ✗ API error.`));
  console.log(
    chalk.dim(`  Details: ${msg}\n  Check your API key and balance, or use /model to switch models.\n`),
  );
}
