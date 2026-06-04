import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { select, confirm, isCancel } from "@clack/prompts";
import { spawn } from "child_process";
import type { LanguageModel } from "ai";
import chalk from "chalk";

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
    
    child.on("error", () => {
      resolve(false);
    });

    child.unref();

    // Wait a couple seconds for it to start
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


const ONLINE_CATALOG = [
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini       (fast · cheap)" },
  { value: "openai/gpt-4o", label: "GPT-4o            (powerful)" },
  { value: "anthropic/claude-3-5-sonnet", label: "Claude 3.5 Sonnet (smart)" },
  { value: "google/gemini-flash-1.5", label: "Gemini Flash 1.5  (fast)" },
  { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B   (open · capable)" },
  { value: "openrouter/free", label: "OpenRouter Free   (any free model)" },
];

/**
 * Interactive model resolver. Runs once at startup:
 *  1. Pings Ollama — if up, offers Local vs Online
 *  2. For local: shows a picker of installed Ollama models
 *  3. For online: shows a curated OpenRouter catalog
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
        { value: "local", label: "🖥️  Local  — Ollama (private, offline)" },
        { value: "online", label: "🌐  Online — OpenRouter (cloud, API key required)" },
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

  const ollama = createOpenAICompatible({
    name: "ollama",
    baseURL: `${OLLAMA_BASE}/v1`,
  });

  console.log(chalk.green(`\n  ✓ Local model ready: ${chosen}\n`));
  return ollama(chosen as string);
}


async function pickOnlineModel(): Promise<LanguageModel> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const envModel = process.env.OPENROUTER_DEFAULT_MODEL;

  const options = [
    ...ONLINE_CATALOG,
    ...(envModel && !ONLINE_CATALOG.find((m) => m.value === envModel)
      ? [{ value: envModel, label: `${envModel}  (from .env)` }]
      : []),
  ];

  const chosen = await select({
    message: "Pick an online model:",
    options,
  });
  if (isCancel(chosen)) process.exit(0);

  if (!apiKey) {
    console.log(chalk.red("  OPENROUTER_API_KEY is not set in .env — requests will fail.\n"));
  }

  const provider = createOpenRouter({ apiKey: apiKey ?? "" });
  console.log(chalk.green(`\n  ✓ Online model ready: ${chosen}\n`));
  return provider(chosen as string);
}
