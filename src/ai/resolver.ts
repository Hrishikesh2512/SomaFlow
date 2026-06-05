import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { select, confirm, isCancel } from "@clack/prompts";
import { spawn } from "child_process";
import type { LanguageModel } from "ai";
import chalk from "chalk";
import { getConfig, type SomaConfig } from "../core/config/onboarding";

const OLLAMA_BASE = "http://localhost:11434";

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function startOllama(): Promise<boolean> {
  console.log(chalk.dim("  Attempting to start Ollama..."));
  return new Promise((resolve) => {
    const child = spawn("ollama", ["serve"], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.on("error", () => resolve(false));
    child.unref();
    setTimeout(async () => {
      const up = await isOllamaRunning();
      resolve(up);
    }, 2000);
  });
}

async function getOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    const data = (await res.json()) as { models: { name: string }[] };
    return data.models.map((m) => m.name);
  } catch {
    return [];
  }
}

export function instantiateModel(modelId: string): LanguageModel {
  if (modelId.startsWith("ollama/")) {
    const name = modelId.replace("ollama/", "");
    const ollama = createOpenAICompatible({ name: "ollama", baseURL: `${OLLAMA_BASE}/v1` });
    return ollama(name);
  }
  if (modelId.startsWith("openrouter/")) {
    const name = modelId.replace("openrouter/", "");
    const provider = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY || "" });
    return provider(name);
  }
  if (modelId.startsWith("openai/")) {
    const name = modelId.replace("openai/", "");
    const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });
    return provider(name);
  }
  if (modelId.startsWith("anthropic/")) {
    const name = modelId.replace("anthropic/", "");
    const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
    return provider(name);
  }
  if (modelId.startsWith("google/")) {
    const name = modelId.replace("google/", "");
    const provider = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "" });
    return provider(name);
  }

  // Fallback to OpenRouter
  const provider = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY || "" });
  return provider(modelId);
}

/**
 * Fully automatic model resolution — no interactive prompts.
 * Priority: saved config model → network (if API key) → local Ollama → interactive fallback.
 */
export async function resolveModelAuto(savedModel?: string): Promise<LanguageModel> {
  // 1. If a model was already saved in config, reconstruct it without asking
  if (savedModel) {
    console.log(chalk.dim(`  ✦ Using model: ${savedModel}`));
    return instantiateModel(savedModel);
  }

  // 2. Interactive fallback (nothing auto-detectable)
  console.log(chalk.yellow("  No auto-detectable model found. Let's pick one manually.\n"));
  return resolveModel();
}

/**
 * Interactive model resolver. Runs for the /model command.
 */
export async function resolveModel(): Promise<LanguageModel> {
  let ollamaUp = await isOllamaRunning();

  if (!ollamaUp) {
    const shouldStart = await confirm({
      message: "Ollama is not running. Attempt to start it?",
      initialValue: true,
    });

    if (!isCancel(shouldStart) && shouldStart) {
      ollamaUp = await startOllama();
      if (!ollamaUp) {
        console.log(chalk.red("  Failed to start Ollama."));
      } else {
        console.log(chalk.green("  ✓ Ollama started successfully.\n"));
      }
    }
  }

  let backend: "local" | "online";

  if (ollamaUp) {
    const choice = await select({
      message: "Which AI backend?",
      options: [
        { value: "local", label: "🖥️  Local (Ollama)" },
        { value: "online", label: "🌐  Online (Network Providers)" },
      ],
    });
    if (isCancel(choice)) process.exit(0);
    backend = choice as "local" | "online";
  } else {
    console.log(chalk.dim("  Ollama not detected — defaulting to online.\n"));
    backend = "online";
  }

  return backend === "local" ? pickLocalModel() : pickOnlineModel();
}

async function pickLocalModel(): Promise<LanguageModel> {
  const models = await getOllamaModels();

  if (!models.length) {
    console.log(chalk.yellow("  No Ollama models found. Falling back to online.\n"));
    return pickOnlineModel();
  }

  const chosen = await select({
    message: "Pick a local model:",
    options: models.map((m) => ({ value: m, label: m })),
  });
  if (isCancel(chosen)) process.exit(0);

  console.log(chalk.green(`\n  ✓ Local model ready: ${chosen}\n`));
  return instantiateModel(`ollama/${chosen}`);
}

async function pickOnlineModel(): Promise<LanguageModel> {
  const config = (await getConfig()) as SomaConfig;
  const options: { value: string; label: string }[] = [];

  if (config?.apiKeys?.openrouter) {
    options.push(
      { value: "openrouter/free", label: "[OpenRouter] Free (Any free model)" },
      { value: "openrouter/auto", label: "[OpenRouter] Auto (Recommended)" },
      { value: "openrouter/anthropic/claude-3.5-sonnet", label: "[OpenRouter] Claude 3.5 Sonnet" },
      { value: "openrouter/openai/gpt-4o", label: "[OpenRouter] GPT-4o" },
      { value: "openrouter/google/gemini-flash-1.5", label: "[OpenRouter] Gemini Flash 1.5" }
    );
  }
  if (config?.apiKeys?.anthropic) {
    options.push({ value: "anthropic/claude-3-5-sonnet-latest", label: "[Anthropic] Claude 3.5 Sonnet" });
  }
  if (config?.apiKeys?.openai) {
    options.push(
      { value: "openai/gpt-4o", label: "[OpenAI] GPT-4o" },
      { value: "openai/gpt-4o-mini", label: "[OpenAI] GPT-4o Mini" }
    );
  }
  if (config?.apiKeys?.google) {
    options.push(
      { value: "google/gemini-1.5-pro", label: "[Google] Gemini 1.5 Pro" },
      { value: "google/gemini-1.5-flash", label: "[Google] Gemini 1.5 Flash" }
    );
  }

  if (options.length === 0) {
    options.push({ value: "openrouter/anthropic/claude-3.5-sonnet", label: "OpenRouter (Default fallback)" });
  }

  const chosen = await select({
    message: "Pick an online model:",
    options,
  });
  if (isCancel(chosen)) process.exit(0);

  console.log(chalk.green(`\n  ✓ Online model ready: ${chosen}\n`));
  return instantiateModel(chosen as string);
}
