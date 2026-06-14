import { text, isCancel, confirm } from "@clack/prompts";
import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { resolveModel, setActiveModel } from "../../src/ai";
import { defaultAgentConfig } from "../agent/types";
import { Session } from "../agent/adaptive-loop";
import { initMcp } from "../../src/mcp/client";
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
  ${PROMPT_STYLE("/new")}         Start a fresh conversation thread (keep memory)
  ${PROMPT_STYLE("/compact")}     Summarize the conversation so far to free up context
  ${PROMPT_STYLE("/clear")}       Clear ${agentName}'s memory and conversation thread
  ${PROMPT_STYLE("/help")}        Show this help message
  ${PROMPT_STYLE("/exit")}        Quit SomaFlow
`;

async function handleSlashCommand(input: string, config: SomaConfig, activeWorkspace: string): Promise<{ exit?: boolean; configChanged?: boolean; changeWorkspace?: string; resetSession?: boolean; compact?: boolean }> {
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

  if (lowerCmd === "/new") {
    console.log(INFO_STYLE("  Started a fresh conversation thread.\n"));
    return { resetSession: true };
  }

  if (lowerCmd === "/compact") {
    return { compact: true };
  }

  if (lowerCmd === "/clear") {
    memory.clear?.();
    console.log(INFO_STYLE("  Memory and conversation thread cleared.\n"));
    return { resetSession: true };
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
    `  │  A continuing conversation — /help       │\n` +
    `  └─────────────────────────────────────────┘\n`
  ));

  const mcp = await initMcp();

  const makeSession = (workspace: string): Session => {
    const cfg = defaultAgentConfig();
    cfg.codebasePath = workspace;
    const repoMap = formatCompactRepoMap();
    return new Session({
      config: cfg,
      memory,
      context: memory.getAll(),
      agentName,
      extraSystem: repoMap ? [repoMap] : [],
      extraTools: mcp.tools,
    });
  };

  let session = makeSession(activeWorkspace);

  try {
    while (true) {
      const input = await text({
        message: PROMPT_STYLE(`${agentName} →`),
        placeholder: session.turnCount === 0 ? "Describe a task, or type /help" : "Follow up, correct, or start a new task",
      });

      if (isCancel(input)) {
        console.log(chalk.dim("\nGoodbye.\n"));
        break;
      }

      const raw = (input as string).trim();
      if (!raw) continue;

      if (raw.startsWith("/")) {
        const result = await handleSlashCommand(raw, config, activeWorkspace);
        if (result.exit) break;
        if (result.changeWorkspace) {
          activeWorkspace = result.changeWorkspace;
          session = makeSession(activeWorkspace); // new workspace → fresh thread
        } else if (result.resetSession) {
          session.reset();
        } else if (result.compact) {
          await session.compact();
        }
        continue;
      }

      await session.runTurn(raw);
    }
  } finally {
    await mcp.close();
  }
}
