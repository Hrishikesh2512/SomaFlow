import { Telegraf } from "telegraf";
import chalk from "chalk";
import { WELCOME } from "./constants";
import { registerHandlers } from "./handlers";

let _bot: Telegraf | null = null;
let _running = false;

export function isTelegramRunning(): boolean {
  return _running;
}

/**
 * Start the Telegram bot using provided token + ownerId.
 * Safe to call multiple times — will no-op if already running.
 */
export async function startTelegramBot(token: string, ownerId: string): Promise<void> {
  if (_running) {
    console.log(chalk.dim("  Telegram bot is already running."));
    return;
  }

  process.env.TELEGRAM_BOT_TOKEN = token;
  process.env.TELEGRAM_OWNER_ID = ownerId;

  _bot = new Telegraf(token);
  registerHandlers(_bot);

  try {
    await _bot.telegram.sendMessage(ownerId, WELCOME, { parse_mode: "Markdown" });
  } catch {
    // Don't crash if welcome message fails
  }

  _bot.launch();
  _running = true;
  console.log(chalk.green("  ✦ Telegram bot started in the background.\n"));

  process.once("SIGINT", stopTelegramBot);
  process.once("SIGTERM", stopTelegramBot);
}

/**
 * Stop the Telegram bot gracefully.
 */
export function stopTelegramBot(): void {
  if (_bot && _running) {
    _bot.stop("SIGINT");
    _bot = null;
    _running = false;
  }
}

/** Legacy interactive entry point (used by wakeup manual mode) */
export async function runTelegramMode(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.TELEGRAM_OWNER_ID;

  if (!token || !ownerId) {
    console.log(chalk.red("  No Telegram credentials found. Run 'somaflow wakeup' and set them up first.\n"));
    return;
  }

  await startTelegramBot(token, ownerId);

  // Block until killed
  await new Promise<void>((resolve) => {
    const stop = () => {
      stopTelegramBot();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}