<div align="center">

# 🌊 SomaFlow

**A state-of-the-art autonomous AI coding agent & orchestrator — built natively with Bun and TypeScript.**

Run it in your terminal. Deploy it as a Telegram bot. Let it write, review, and auto-correct your code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org/)

</div>

---

## What is SomaFlow?

SomaFlow is a highly capable, multi-agent orchestrator designed to act as your personal pair programmer. It doesn't just generate code snippets — it can navigate your file system, stage atomic changes, perform semantic searches, run background tasks, and **auto-correct its own errors** using a multi-agent feedback loop.

Built natively on [Bun](https://bun.sh) for sub-100ms cold starts, it comes with a beautiful Terminal UI (TUI) for local debugging and a Telegram mode for remote execution.

---

## 🔥 Key Features

### 🤖 Multi-Agent Architecture
Instead of relying on a single LLM call, SomaFlow delegates tasks:
1. **Planner Agent:** Creates a markdown-based task checklist (`task.md`) and designs the architecture (`implementation_plan.md`).
2. **Executor Agent:** Navigates the codebase and executes the plan using 25+ tools.
3. **Reviewer Agent:** Critiques the Executor's staged changes via a unified diff before you ever approve them.
4. **Auto-Fix Agent:** Steps in if type-checks or linting fail to automatically repair the code.

### 🛠️ Massive Tool Suite (25+ Tools)
- **Filesystem:** Read lines, edit, replace, delete, create files and folders.
- **Search & AST:** Ripgrep-style semantic search, regex symbol search, and file listing.
- **Git & Shell:** Read-only command execution, queued mutating commands, and background detached tasks.
- **Context Management:** AI-powered file summarization and session memory compression to prevent token bloat.
- **Verification:** Runs `bunx tsc --noEmit`, `eslint --fix`, and `bun test` immediately.

### 🛡️ The Auto-Correction Loop
SomaFlow won't blindly commit broken code. After staging changes:
1. It runs `eslint --fix` quietly to repair style issues.
2. It runs `tsc --noEmit` and grabs any ESLint / TypeScript errors.
3. If errors exist, it spawns an **Auto-Fix Agent** up to 2 times to resolve them before prompting you.

### 🖥️ Interactive Approval UI
Before modifying your filesystem, SomaFlow stages its changes. You get a Git-style diff view in your terminal and a 2-3 sentence AI critique from the Reviewer Agent. You can choose to approve all, review one-by-one, or reject.

---

## Project Structure

```
SomaFlow/
├── ai/             # Core LLM integration, token streaming, Vercel AI SDK
├── memory/         # Persistent context, session memory, and AI summarization
├── modes/          # Four behavioral modes
│   ├── agent/      # The autonomous coding agent (Orchestrator, Executor, Tracker, Approval)
│   ├── telegram/   # Telegram bot mode routing and handlers
│   ├── plan/       # Specialized planning mode
│   └── chat/       # Standard conversational mode
├── tui/            # Terminal UI and Markdown rendering
├── index.ts        # Entry point
└── bun.lockb
```

---

## Prerequisites

- [Bun](https://bun.sh) `>= 1.0` installed
- An API key from an LLM provider (OpenRouter, OpenAI, Anthropic, Gemini, etc.)
- A Telegram Bot token from [@BotFather](https://t.me/botfather) *(only if deploying the bot)*

---

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/Hrishikesh2512/SomaFlow.git
cd SomaFlow
bun install
```

### 2. Configure Environment

On your first run, SomaFlow will guide you through an interactive onboarding wizard to configure your preferred model, API keys, and enable core plugins.

```bash
bun run index.ts
```

*(This will generate a `~/.somaflow.json` configuration file).*

### 3. Usage

After setup, run SomaFlow as a CLI:

```bash
# See all available plugins and commands
bun run index.ts --help

# Launch the autonomous coding agent
bun run index.ts agent

# Start standard chat mode
bun run index.ts chat

# Start the telegram bot background listener
bun run index.ts telegram
```

---

## 🧩 Plugin Ecosystem

SomaFlow is fully extensible via its open plugin platform.

### Installing Community Plugins
```bash
bun run install-plugin <git-repo-url>
```

### Creating Your Own Plugin
```bash
bun run create-plugin
```
This will scaffold a new plugin in the `./plugins/` directory.

---

## Contributing

SomaFlow is highly modular. You can easily add new tools to the Agent plugin or create entirely new plugins.

1. Fork the repo (`git checkout -b feat/my-change`)
2. Make changes
3. Open a PR

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## License

MIT — see [LICENSE](LICENSE) for details. Free to use, modify, and distribute.

<div align="center">
  <sub>Built with 🌊 by the SomaFlow contributors</sub>
</div>