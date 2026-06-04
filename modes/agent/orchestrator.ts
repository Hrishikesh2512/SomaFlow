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

    // -- AUTO-CORRECTION LOOP --
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        console.log(chalk.cyan(`\n[Auto-Check] Running ESLint auto-fix and typecheck (attempt ${attempt + 1}/${MAX_RETRIES})...`));
        
        // Auto-fix simple style errors quietly
        executor.runImmediateShell("bunx eslint --fix .");
        
        // Gather remaining errors
        const eslintOutput = executor.runImmediateShell("bunx eslint .");
        const tscOutput = executor.runImmediateShell("bunx tsc --noEmit");

        // ESLint outputs 'problem' or 'error' if it fails, TS outputs 'error TS'
        const hasLintErrors = eslintOutput.includes("error") || eslintOutput.includes("problem");
        const hasTscErrors = tscOutput.includes("error TS");

        if (!hasLintErrors && !hasTscErrors) {
            console.log(chalk.green("  ✓ Code quality checks passed — no errors.\n"));
            break;
        }

        console.log(chalk.yellow(`  ⚠ Found errors (Lint: ${hasLintErrors}, TS: ${hasTscErrors}). Auto-correcting...\n`));

        const fixTracker = new ActionTracker();
        const fixExecutor = new ToolExecutor(fixTracker, config);
        const fixTools = createAgentTools(fixExecutor, memory);

        const fixAgent = new ToolLoopAgent({
            model: getAgentModel(),
            stopWhen: stepCountIs(20),
            instructions: [
                "You are SomaFlow Auto-Fix Agent.",
                "The previous code changes introduced TypeScript or ESLint errors.",
                "Fix ONLY the errors shown below. Do not change unrelated code.",
                `Workspace root: ${config.codebasePath}`,
                "All mutations are staged until approval.",
            ].join("\n"),
            tools: fixTools,
        });

        const fixResult = await fixAgent.generate({
            prompt: `Fix these errors:\n\n[ESLint Output]\n${eslintOutput}\n\n[TypeScript Output]\n${tscOutput}`,
            onStepFinish: ({ toolCalls }) => {
                for (const tc of toolCalls) {
                    const preview = JSON.stringify(tc.input).slice(0, 160);
                    console.log(
                        chalk.magenta("  🔧"),
                        chalk.bold(String(tc.toolName)),
                        chalk.dim(preview + (preview.length >= 160 ? "..." : ""))
                    );
                }
            },
        });

        if (fixResult.text?.trim()) console.log(renderTerminalMarkdown(fixResult.text));

        const fixPending = fixTracker.getPendingMutations();
        if (fixPending.length === 0) {
            console.log(chalk.dim("  No fixes proposed. Stopping auto-correction.\n"));
            break;
        }

        const fixOk = await runApprovalFlow(fixTracker);
        if (!fixOk) {
            fixExecutor.clearStaging();
            break;
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

    executor.clearStaging();
}
