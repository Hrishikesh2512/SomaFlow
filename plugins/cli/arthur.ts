import { text, isCancel, confirm } from "@clack/prompts";
import chalk from "chalk";
import { getAgentModel, resolveModel, setActiveModel } from "../../src/ai";
import { defaultAgentConfig } from "../agent/types";
import { ActionTracker } from "../agent/action-tracker";
import { ToolExecutor } from "../agent/tool-executor";
import { createAgentTools } from "../agent/agent-tools";
import { renderTerminalMarkdown } from "../../src/tui/terminal-md";
import { runApprovalFlow } from "../agent/approval";
import { MemoryStore } from "../../src/memory/store";
import { saveConfig, getConfig } from "../../src/core/config/onboarding";
import type { SomaConfig } from "../../src/core/config/onboarding";
import { startTelegramBot, stopTelegramBot, isTelegramRunning } from "../telegram/bot";
import { undoLast, getHistory } from "../../src/history/index";
import { formatCompactRepoMap } from "../../src/repomap/formatter";

const memory = new MemoryStore();

const PROMPT_STYLE = chalk.hex("#9b77e8").bold;
const INFO_STYLE = chalk.hex("#6c5fc7").dim;
const ARTHUR_STYLE = chalk.hex("#c4b5fd");

const getHelpText = (agentName: string) => `
${chalk.bold(agentName + " Slash Commands")}

  ${PROMPT_STYLE("/cd <path>")}   Change Arthur's active workspace directory
  ${PROMPT_STYLE("/model")}       Switch the AI model interactively
  ${PROMPT_STYLE("/telegram")}    Toggle the Telegram bot on or off
  ${PROMPT_STYLE("/status")}      Show current model, Telegram, and workspace info
  ${PROMPT_STYLE("/undo")}        Undo Arthur's last file modification or creation
  ${PROMPT_STYLE("/history")}     Show the last 10 actions Arthur performed
  ${PROMPT_STYLE("/clear")}       Clear ${agentName}'s short-term memory
  ${PROMPT_STYLE("/help")}        Show this help message
  ${PROMPT_STYLE("/exit")}        Quit SomaFlow
`;

async function handleSlashCommand(input: string, config: SomaConfig, activeWorkspace: string): Promise<{ exit?: boolean; configChanged?: boolean; changeWorkspace?: string }> {
  const cmd = input.trim();
  const lowerCmd = cmd.toLowerCase();
  const agentName = config.agentName || "Arthur";

  if (lowerCmd === "/help") {
    console.log(getHelpText(agentName));
    return {};
  }

  if (lowerCmd.startsWith("/cd ")) {
    const newPath = cmd.replace(/^\/cd\s+/i, "").trim();
    if (!newPath) {
      console.log(chalk.yellow("  Please provide a path: /cd <path>\n"));
      return {};
    }
    const path = require("node:path");
    const fs = require("node:fs");
    const resolvedPath = path.resolve(activeWorkspace, newPath);
    if (!fs.existsSync(resolvedPath)) {
      console.log(chalk.red(`  Directory not found: ${resolvedPath}\n`));
      return {};
    }
    console.log(chalk.green(`  ✓ Changed workspace to: ${resolvedPath}\n`));
    return { changeWorkspace: resolvedPath };
  }

  if (lowerCmd === "/exit") {
    console.log(chalk.dim("\nGoodbye.\n"));
    return { exit: true };
  }

  if (lowerCmd === "/clear") {
    memory.clear?.();
    console.log(INFO_STYLE("  Memory cleared.\n"));
    return {};
  }

  if (lowerCmd === "/undo") {
    console.log(undoLast(activeWorkspace));
    return {};
  }

  if (lowerCmd === "/history") {
    console.log(getHistory());
    return {};
  }

  if (lowerCmd === "/status") {
    const telegramStatus = isTelegramRunning()
      ? chalk.green("● running")
      : chalk.dim("○ stopped");

    console.log(`
${chalk.bold(agentName + " Status")}
  ${chalk.dim("Model")}      ${chalk.cyan(config.model)}
  ${chalk.dim("Workspace")}  ${chalk.cyan(activeWorkspace)}
  ${chalk.dim("Telegram")}   ${telegramStatus}
  ${chalk.dim("User")}       ${chalk.cyan(config.displayName)}
`);
    return {};
  }

  if (lowerCmd === "/model") {
    console.log(INFO_STYLE("  Opening model picker...\n"));
    const newModel = await resolveModel();
    setActiveModel(newModel);
    console.log(chalk.green("  ✓ Model switched.\n"));
    return {};
  }

  if (lowerCmd === "/telegram") {
    if (isTelegramRunning()) {
      const stop = await confirm({ message: "Telegram bot is running. Stop it?" });
      if (!isCancel(stop) && stop) {
        stopTelegramBot();
        console.log(chalk.yellow("  Telegram bot stopped.\n"));
      }
    } else {
      if (!config.telegram?.botToken) {
        console.log(chalk.red("  No Telegram credentials configured. Re-run onboarding to add them.\n"));
        return {};
      }
      console.log(INFO_STYLE("  Starting Telegram bot...\n"));
      await startTelegramBot(config.telegram.botToken, config.telegram.ownerId);
      console.log(chalk.green("  ✓ Telegram bot started.\n"));

      // Persist autoStart preference
      config.telegram.autoStart = true;
      await saveConfig(config);
    }
    return { configChanged: true };
  }

  console.log(chalk.yellow(`  Unknown command: ${input}. Type /help for options.\n`));
  return {};
}

export async function runArthurCli(initialWorkspace?: string) {
  const config = (await getConfig()) as SomaConfig;
  const agentName = config.agentName || "Arthur";
  let activeWorkspace = initialWorkspace || config.defaultWorkspace || process.cwd();

  console.log(ARTHUR_STYLE(
    `  ┌─────────────────────────────────────────┐\n` +
    `  │  ${agentName.padEnd(37, " ")}│\n` +
    `  │  Your Autonomous Coding Agent           │\n` +
    `  │  Type a task, or /help for commands     │\n` +
    `  └─────────────────────────────────────────┘\n`
  ));

  while (true) {
    const input = await text({
      message: PROMPT_STYLE(`${agentName} →`),
      placeholder: "Describe a task, or type /help",
    });

    if (isCancel(input)) {
      console.log(chalk.dim("\nGoodbye.\n"));
      break;
    }

    const raw = (input as string).trim();
    if (!raw) continue;

    // Handle slash commands
    if (raw.startsWith("/")) {
      const result = await handleSlashCommand(raw, config, activeWorkspace);
      if (result.exit) break;
      if (result.changeWorkspace) {
        activeWorkspace = result.changeWorkspace;
      }
      continue;
    }

    // Normal task — run Arthur agent
    await runArthurTask(raw, agentName, activeWorkspace);
  }
}

async function runArthurTask(goal: string, agentName: string, activeWorkspace: string) {
  const context = memory.getAll();
  memory.add(`User task: ${goal}`, "event");

  const config = defaultAgentConfig();
  config.codebasePath = activeWorkspace;
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const tools = createAgentTools(executor, memory);

  // Planner phase
  console.log(chalk.hex("#9b77e8").dim(`\n  [${agentName}] Planning...\n`));
  let plan = "";
  try {
    const { generateText } = await import("ai");
    const planResult = await generateText({
      model: getAgentModel(),
      system:
        `You are ${agentName}, SomaFlow's autonomous coding agent. ` +
        "Given a user goal and codebase context, output a concise Markdown checklist of steps. " +
        "Be direct and practical. Do NOT write code yet, just the plan.",
      prompt: `Context:\n${context.length > 0 ? JSON.stringify(context) : "None"}\n\nGoal: ${goal}`,
    });
    plan = planResult.text;
    console.log(chalk.hex("#9b77e8").dim(`[${agentName}] Plan:\n`) + renderTerminalMarkdown(plan));
  } catch (err: any) {
    console.log(chalk.red(`\n  ✗ API Error during planning phase.`));
    console.log(chalk.dim(`  Details: ${err?.message || err}\n  Please check your API key and balance, or use /model to switch models.\n`));
    return;
  }

  // Executor phase
  const { ToolLoopAgent, stepCountIs } = await import("ai");
  const executorPrompt = `Task:\n${goal}\n\nFollow this plan:\n${plan}`;

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(10),
    instructions: [
      `You are ${agentName}, SomaFlow's autonomous coding agent.`,
      "Be concise, direct, and professional.",
      "Follow the provided plan step-by-step.",
      context.length > 0 ? `Previous memory:\n${JSON.stringify(context)}` : "",
      `Workspace root: ${config.codebasePath}`,
      "All file mutations are staged until the user approves them.",
      formatCompactRepoMap(),
    ].filter(Boolean).join("\n"),
    tools,
  });

  try {
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

    if (result.text?.trim()) console.log("\n" + renderTerminalMarkdown(result.text));
  } catch (err: any) {
    console.log(chalk.red(`\n  ✗ API Error during execution phase.`));
    console.log(chalk.dim(`  Details: ${err?.message || err}\n  Please check your API key and balance, or use /model to switch models.\n`));
    return;
  }

  // Approval
  const ok = await runApprovalFlow(tracker);
  if (!ok) return executor.clearStaging();

  const { errors } = executor.applyApprovedFromTracker();
  if (errors.length) {
    console.log(chalk.red("\nSome operations had errors:\n"));
    for (const e of errors) console.log(chalk.red(`  • ${e}`));
  } else {
    console.log(chalk.green("\n  ✓ Done.\n"));
  }

  // Auto-correction loop
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    console.log(chalk.hex("#9b77e8").dim(`\n  [${agentName}] Auto-checking quality (pass ${attempt + 1}/${MAX_RETRIES})...`));
    const eslintOut = executor.runImmediateShell("bunx eslint .");
    const tscOut = executor.runImmediateShell("bunx tsc --noEmit");
    const hasErrors = eslintOut.includes("error") || tscOut.includes("error TS");
    if (!hasErrors) {
      console.log(chalk.green("  ✓ Quality checks passed.\n"));
      break;
    }
    console.log(chalk.yellow(`  ⚠ Errors found — ${agentName} is auto-fixing...\n`));

    const fixTracker = new ActionTracker();
    const fixExecutor = new ToolExecutor(fixTracker, config);
    const fixAgent = new ToolLoopAgent({
      model: getAgentModel(),
      stopWhen: stepCountIs(5),
      instructions: [
        `You are ${agentName}, auto-fixing quality errors in SomaFlow.`,
        "Do NOT change logic or add features. ONLY fix TS/Lint errors.",
        `Workspace root: ${config.codebasePath}`,
        formatCompactRepoMap(),
        "All file mutations are staged until approval.",
      ].filter(Boolean).join("\n"),
      tools: createAgentTools(fixExecutor, memory),
    });

    const fixResult = await fixAgent.generate({
      prompt: `Fix these errors:\n\n[ESLint]\n${eslintOut}\n\n[TypeScript]\n${tscOut}`,
      onStepFinish: ({ toolCalls }) => {
        for (const tc of toolCalls) {
          console.log(chalk.magenta("  🔧"), chalk.bold(String(tc.toolName)));
        }
      },
    });
    if (fixResult.text?.trim()) console.log(renderTerminalMarkdown(fixResult.text));

    if (fixTracker.getPendingMutations().length === 0) break;
    const fixOk = await runApprovalFlow(fixTracker);
    if (!fixOk) { fixExecutor.clearStaging(); break; }
    fixExecutor.applyApprovedFromTracker();
    fixExecutor.clearStaging();
  }

  executor.clearStaging();
}
