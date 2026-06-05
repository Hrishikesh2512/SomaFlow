import fs from "fs/promises";
import path from "path";
import os from "os";
import { text, confirm, isCancel, intro, outro, select, multiselect } from "@clack/prompts";
import chalk from "chalk";
import { spawn } from "child_process";

const CONFIG_PATH = path.join(os.homedir(), ".somaflow.json");
const OLLAMA_BASE = "http://localhost:11434";

export interface SomaConfig {
    displayName: string;
    agentName?: string;
    defaultWorkspace: string;
    model: string;
    apiKeys: {
        openrouter?: string;
        openai?: string;
        anthropic?: string;
        google?: string;
    };
    telegram?: {
        botToken: string;
        ownerId: string;
        autoStart: boolean;
    };
    enabledPlugins: string[];
}

export async function getConfig(): Promise<SomaConfig | null> {
    try {
        const data = await fs.readFile(CONFIG_PATH, "utf-8");
        return JSON.parse(data) as SomaConfig;
    } catch {
        return null;
    }
}

export async function saveConfig(config: SomaConfig) {
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// ─── Ollama helpers ─────────────────────────────────────────────────────────

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

async function getOllamaModels(): Promise<string[]> {
    try {
        const res = await fetch(`${OLLAMA_BASE}/api/tags`);
        const data = (await res.json()) as { models: { name: string }[] };
        return data.models.map((m) => m.name);
    } catch {
        return [];
    }
}

async function tryStartOllama(): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawn("ollama", ["serve"], {
            stdio: "ignore",
            detached: true,
            windowsHide: true,
        });
        child.on("error", () => resolve(false));
        child.unref();
        setTimeout(async () => {
            resolve(await isOllamaRunning());
        }, 2500);
    });
}

// ─── Main onboarding ─────────────────────────────────────────────────────────

export async function runOnboardingIfNeeded(): Promise<SomaConfig> {
    let config = await getConfig();
    if (config) {
        // Ensure env vars are populated from saved config
        if (config.apiKeys?.openrouter) process.env.OPENROUTER_API_KEY = config.apiKeys.openrouter;
        if (config.apiKeys?.openai) process.env.OPENAI_API_KEY = config.apiKeys.openai;
        if (config.apiKeys?.anthropic) process.env.ANTHROPIC_API_KEY = config.apiKeys.anthropic;
        if (config.apiKeys?.google) process.env.GOOGLE_GENERATIVE_AI_API_KEY = config.apiKeys.google;

        if (config.telegram?.botToken) process.env.TELEGRAM_BOT_TOKEN = config.telegram.botToken;
        if (config.telegram?.ownerId) process.env.TELEGRAM_OWNER_ID = config.telegram.ownerId;
        return config;
    }

    console.clear();
    intro(chalk.bgMagenta.white(" ✦ Welcome to SomaFlow — First Time Setup ✦ "));
    console.log(chalk.dim("You can customize your autonomous AI coding agent. Let's get them ready.\n"));

    // 0. Agent name
    const agentName = await text({
        message: "What do you want to name your agent?",
        placeholder: "Arthur",
        defaultValue: "Arthur",
    });
    if (isCancel(agentName)) process.exit(0);

    // 1. Display name
    const displayName = await text({
        message: `What should ${agentName} call you?`,
        placeholder: "Developer",
        defaultValue: "Developer",
    });
    if (isCancel(displayName)) process.exit(0);

    // 2. Default workspace
    const defaultWorkspace = await text({
        message: "Default workspace path for your projects?",
        placeholder: process.cwd(),
        defaultValue: process.cwd(),
    });
    if (isCancel(defaultWorkspace)) process.exit(0);

    // 3. AI Model setup
    console.log(chalk.cyan("\n┌ AI Backend Setup"));

    const apiKeys: SomaConfig["apiKeys"] = {};
    let model = "";

    const selectedProviders = await multiselect({
        message: "Which AI API providers do you have keys for? (Space to select, Enter to confirm)",
        options: [
            { value: "openrouter", label: "OpenRouter (Recommended)" },
            { value: "anthropic", label: "Anthropic (Claude)" },
            { value: "openai", label: "OpenAI (GPT-4o)" },
            { value: "google", label: "Google (Gemini)" },
        ],
        required: false,
    });
    if (isCancel(selectedProviders)) process.exit(0);

    const providers = selectedProviders as string[];

    if (providers.includes("openrouter")) {
        const key = await text({ message: "Paste your OpenRouter API key:" });
        if (!isCancel(key) && key) {
            apiKeys.openrouter = key as string;
            process.env.OPENROUTER_API_KEY = key as string;
        }
    }
    if (providers.includes("anthropic")) {
        const key = await text({ message: "Paste your Anthropic API key:" });
        if (!isCancel(key) && key) {
            apiKeys.anthropic = key as string;
            process.env.ANTHROPIC_API_KEY = key as string;
        }
    }
    if (providers.includes("openai")) {
        const key = await text({ message: "Paste your OpenAI API key:" });
        if (!isCancel(key) && key) {
            apiKeys.openai = key as string;
            process.env.OPENAI_API_KEY = key as string;
        }
    }
    if (providers.includes("google")) {
        const key = await text({ message: "Paste your Google Generative AI API key:" });
        if (!isCancel(key) && key) {
            apiKeys.google = key as string;
            process.env.GOOGLE_GENERATIVE_AI_API_KEY = key as string;
        }
    }

    const availableOnlineModels: { value: string; label: string }[] = [];

    if (apiKeys.openrouter) {
        availableOnlineModels.push(
            { value: "openrouter/free", label: "[OpenRouter] Free (Any free model)" },
            { value: "openrouter/auto", label: "[OpenRouter] Auto (Best available model)" },
            { value: "openrouter/anthropic/claude-3.5-sonnet", label: "[OpenRouter] Claude 3.5 Sonnet (smart)" },
            { value: "openrouter/openai/gpt-4o", label: "[OpenRouter] GPT-4o (powerful)" },
            { value: "openrouter/openai/gpt-4o-mini", label: "[OpenRouter] GPT-4o Mini (fast/cheap)" },
            { value: "openrouter/google/gemini-flash-1.5", label: "[OpenRouter] Gemini Flash 1.5 (fast)" },
            { value: "openrouter/meta-llama/llama-3.3-70b-instruct", label: "[OpenRouter] Llama 3.3 70B (open/capable)" }
        );
    }
    if (apiKeys.anthropic) {
        availableOnlineModels.push(
            { value: "anthropic/claude-3-5-sonnet-latest", label: "[Anthropic] Claude 3.5 Sonnet" }
        );
    }
    if (apiKeys.openai) {
        availableOnlineModels.push(
            { value: "openai/gpt-4o", label: "[OpenAI] GPT-4o" },
            { value: "openai/gpt-4o-mini", label: "[OpenAI] GPT-4o Mini" }
        );
    }
    if (apiKeys.google) {
        availableOnlineModels.push(
            { value: "google/gemini-1.5-pro", label: "[Google] Gemini 1.5 Pro" },
            { value: "google/gemini-1.5-flash", label: "[Google] Gemini 1.5 Flash" }
        );
    }

    if (availableOnlineModels.length > 0) {
        const onlineModelChoice = await select({
            message: `Which online model should ${agentName} use by default?`,
            options: availableOnlineModels,
        });
        if (isCancel(onlineModelChoice)) process.exit(0);
        model = onlineModelChoice as string;
    }

    // 4. Local Ollama (optional)
    const wantsLocal = await confirm({
        message: "Check for local Ollama models?",
        initialValue: availableOnlineModels.length === 0,
    });
    if (!isCancel(wantsLocal) && wantsLocal) {
        console.log(chalk.dim("  Scanning for Ollama..."));
        let ollamaUp = await isOllamaRunning();
        if (!ollamaUp) {
            const shouldStart = await confirm({
                message: "Ollama not running. Try to start it?",
                initialValue: true,
            });
            if (!isCancel(shouldStart) && shouldStart) {
                ollamaUp = await tryStartOllama();
                console.log(ollamaUp ? chalk.green("  ✓ Ollama started") : chalk.red("  ✗ Could not start Ollama"));
            }
        }

        if (ollamaUp) {
            const localModels = await getOllamaModels();
            if (localModels.length > 0) {
                const localChoice = await select({
                    message: "Ollama models found! Set as primary model?",
                    options: [
                        { value: "__skip__", label: "No, keep current model" },
                        ...localModels.map((m) => ({ value: `ollama/${m}`, label: `🖥  ${m}` })),
                    ],
                });
                if (!isCancel(localChoice) && localChoice !== "__skip__") {
                    model = localChoice as string;
                }
            } else {
                console.log(chalk.dim("  No Ollama models installed."));
            }
        }
    }

    // Fallback model if they somehow didn't select anything
    if (!model) {
        console.log(chalk.yellow(`  No model selected. Defaulting ${agentName} to OpenRouter Claude 3.5 Sonnet.`));
        model = "openrouter/anthropic/claude-3.5-sonnet";
    }

    // 5. Telegram setup
    console.log(chalk.cyan("\n┌ Telegram Setup (optional)"));
    const enableTelegram = await confirm({
        message: `Enable Telegram bot so ${agentName} can work over Telegram?`,
        initialValue: false,
    });
    if (isCancel(enableTelegram)) process.exit(0);

    let telegramConfig: SomaConfig["telegram"] | undefined;

    if (enableTelegram) {
        const botToken = await text({
            message: "Telegram Bot Token (from @BotFather):",
            placeholder: "123456:ABC-...",
        });
        if (isCancel(botToken)) process.exit(0);

        const ownerId = await text({
            message: "Your Telegram numeric user ID (from @userinfobot):",
            placeholder: "123456789",
        });
        if (isCancel(ownerId)) process.exit(0);

        const autoStart = await confirm({
            message: "Auto-start Telegram bot every time SomaFlow launches?",
            initialValue: true,
        });

        telegramConfig = {
            botToken: botToken as string,
            ownerId: ownerId as string,
            autoStart: !isCancel(autoStart) && (autoStart as boolean),
        };

        process.env.TELEGRAM_BOT_TOKEN = telegramConfig.botToken;
        process.env.TELEGRAM_OWNER_ID = telegramConfig.ownerId;
    }

    // 6. Compose & save
    config = {
        displayName: displayName as string,
        agentName: agentName as string,
        defaultWorkspace: defaultWorkspace as string,
        model,
        apiKeys,
        telegram: telegramConfig,
        enabledPlugins: ["wakeup", "cli", "agent", ...(enableTelegram ? ["telegram"] : [])],
    };

    await saveConfig(config);
    outro(chalk.green(`✦ ${agentName} is ready. Config saved to ~/.somaflow.json`));

    return config;
}
