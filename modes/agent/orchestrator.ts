import { isCancel, text } from "@clack/prompts";
import chalk from "chalk";
import { defaultAgentConfig } from "./types";
import { getAgentModel } from "../../ai";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { stepCountIs, ToolLoopAgent } from "ai";
import { renderTerminalMarkdown } from "../../tui/terminal-md";
import { runApprovalFlow } from "./approval";
import { MemoryStore } from "../../memory/store";

const memory = new MemoryStore();

export async function runAgentMode(){
    console.log(chalk.bold('\n Agent Mode \n'));

    const goal = await text({
        message: "What would you like the agent to do?",
        placeholder: "Concrete task for this codebase..."
    });

    if (isCancel(goal) || !goal.trim()) return;

    const context = memory.getAll();
    memory.add(`User task: ${goal.trim()}`, "event");

    const prompt = `Task:\n${goal.trim()}`;

    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);
    const tools = createAgentTools(executor, memory);

    // -- PLANNER PHASE --
    console.log(chalk.cyan("\\n[Planner] Thinking about how to accomplish this..."));
    const { generateText } = await import("ai");
    const plannerResult = await generateText({
        model: getAgentModel(),
        system: "You are the SomaFlow Planner Agent. Given a user goal and codebase context, output a concise Markdown checklist of steps to accomplish it. Do NOT write code, just the plan.",
        prompt: `Context:\\n${context.length > 0 ? JSON.stringify(context) : "None"}\\n\\nGoal: ${goal.trim()}`
    });
    const plan = plannerResult.text;
    console.log(chalk.cyan("[Planner] Plan generated:\\n") + renderTerminalMarkdown(plan));

    // -- EXECUTOR PHASE --
    const executorPrompt = `Task:\\n${goal.trim()}\\n\\nFollow this plan:\\n${plan}`;

    const agent = new ToolLoopAgent({
        model: getAgentModel(),
        stopWhen: stepCountIs(40),
        instructions: [
            "You are SomaFlow Executor Agent.",
            "Follow the provided plan step-by-step.",
            context.length > 0 ? `Previous memory:\\n${JSON.stringify(context)}` : "",
            `Workspace root: ${config.codebasePath}`,
            "All mutations are staged until approval.",            
        ].join("\\n"),
        tools,
    });

    const result = await agent.generate({
        prompt: executorPrompt,
        onStepFinish: ({ toolCalls }) => {
            for (const tc of toolCalls) {
                const preview = JSON.stringify(tc.input).slice(0, 160);
                console.log(
                    chalk.green("  ✓"),
                    chalk.bold(String(tc.toolName)),
                    chalk.dim(preview + (preview.length >= 160 ? "..." : ""))
                );
            }
        },
    });

    if (result.text?.trim()) console.log(renderTerminalMarkdown(result.text));

    const ok = await runApprovalFlow(tracker);
    if (!ok) return executor.clearStaging();

    const { errors } = executor.applyApprovedFromTracker();

    if (errors.length) {
        console.log(chalk.red("\nSome operations reported errors:\n"));
        for (const e of errors) console.log(chalk.red(`  • ${e}`));
    } else {
        console.log(chalk.green('\n✓ Applied.\n'));
    }

    executor.clearStaging();
}
