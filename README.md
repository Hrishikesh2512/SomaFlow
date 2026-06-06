# SomaFlow (Arthur)

SomaFlow is an extensible, autonomous AI coding platform designed to supercharge your development workflow. At its core runs **Arthur**, an intelligent AI agent capable of planning, executing terminal commands, editing code, and auto-fixing errors — all under your supervision.

Built completely around a modular **Plugin Engine**, SomaFlow lets you customize your agent, communicate via a beautiful Terminal UI, or even chat with Arthur from your phone via Telegram.

---

## 🌟 Key Features

- **Autonomous Agent (Arthur)**: Give Arthur a goal, and he will write a plan, explore your codebase, and execute changes. 
- **User Approval Flow**: Safety first. Arthur stages all file modifications and terminal commands for your explicit approval before executing them.
- **Smart Auto-Fixing**: After completing a task, Arthur automatically runs `eslint` and `tsc` on your codebase. If he breaks anything, he spins up an auto-fix loop to resolve the errors before handing control back to you.
- **Multi-Provider Support**: Natively supports **OpenRouter**, **OpenAI**, **Anthropic**, and **Google Gemini**. You can also fall back to local offline models via **Ollama**.
- **Telegram Bot Integration**: Start Arthur in the background and chat with your codebase on the go via Telegram.
- **Modular Plugin System**: Every feature (the CLI, the Telegram bot, the Agent itself) is a plugin. You can easily write and install new plugins to expand Arthur's capabilities.
- **Interactive CLI & Slash Commands**: Change models on the fly with `/model`, toggle Telegram with `/telegram`, check agent status with `/status`, and clear memory with `/clear`.

---

## 📂 Architecture & Project Structure

The project has recently undergone a major infrastructure redesign, moving to a highly modular plugin-based architecture.

```text
SomaFlow/
├── src/
│   ├── ai/            # Multi-provider model resolution & Vercel AI SDK wrappers
│   ├── core/          # Plugin Manager engine & Smart Onboarding logic
│   ├── memory/        # Short-term/long-term memory store for the agent
│   └── tui/           # Terminal UI utilities and Markdown rendering
├── plugins/           # Core features built as independent plugins
│   ├── agent/         # The Arthur AI (ToolExecutor, ActionTracker, Prompts)
│   ├── cli/           # The interactive terminal shell & Slash Commands
│   ├── telegram/      # Telegram background service
│   └── wakeup/        # Boot sequence, banner, and auto-start logic
├── scripts/           # Dev tools (`create-plugin`, `install-plugin`)
└── index.ts           # Main executable entry point
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **[Bun](https://bun.sh/)** installed on your system.
- API Keys for your preferred LLM provider (OpenRouter, OpenAI, Anthropic, or Google) OR **Ollama** installed for local models.

### 2. Clone & Install
```bash
git clone https://github.com/Hrishikesh2512/SomaFlow.git
cd SomaFlow
bun install
```

### 3. Wake Up Arthur
```bash
bun run index.ts wakeup
# or if linked globally:
somaflow wakeup
```

The very first time you boot SomaFlow, you will be greeted by the **Smart Onboarding Flow**:
1. Name your agent (Default: Arthur).
2. Tell Arthur what to call you.
3. Select which API providers you have keys for using an interactive checkbox menu.
4. Set your default model.
5. (Optional) Provide your Telegram Bot credentials to enable background Telegram access.

---

## 💻 Usage

Once Arthur is awake, you are dropped into the interactive command loop. 

**Normal Tasks:**
Just type what you want to do:
> `Arthur → Refactor the user authentication logic in src/auth.ts to use JWTs.`
Arthur will generate a plan, execute it, and ask for your approval.

**Slash Commands:**
- `/model` - Interactively switch your active AI model (e.g., jump from Claude to GPT-4o).
- `/telegram` - Start or stop the Telegram background bot.
- `/status` - View current active model, user info, and workspace directory.
- `/clear` - Wipe Arthur's short-term context memory.
- `/help` - View available commands.
- `/exit` - Safely shut down SomaFlow.

---

## 🔌 Writing Plugins

SomaFlow is built to be extended. You can scaffold a new plugin instantly using the built-in script:

```bash
bun run create-plugin my-plugin
```

This will create a new directory in `plugins/my-plugin` with a boilerplate structure. Once you are done building your plugin, enable it by running:

```bash
bun run install-plugin my-plugin
```

---

## 🛠️ Built With
- **[Bun](https://bun.sh/)** - Extremely fast JavaScript runtime.
- **[Vercel AI SDK](https://sdk.vercel.ai/docs)** - Unified LLM interface.
- **[Clack](https://clack.cc/)** - Beautiful, effortless terminal prompts.
- **[Telegraf](https://telegraf.js.org/)** - Telegram bot framework.
