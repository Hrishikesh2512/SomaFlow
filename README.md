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
git clone https://github.com/your-username/SomaFlow.git
cd SomaFlow
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and configure your keys:

```env
# Required: LLM provider API key
OPENROUTER_API_KEY=your_key_here

# Required for Telegram bot deployment
TELEGRAM_BOT_TOKEN=your_token_here

# Optional: override the default model
# MODEL=anthropic/claude-3-opus
```

### 3. Run the Agent

**Local Terminal UI (Recommended for coding):**

```bash
bun run index.ts
```
*(Inside the TUI, select "Agent" mode to start the autonomous coding loop).*

**Telegram Bot:**
Activated automatically when `TELEGRAM_BOT_TOKEN` is present.

---

## Usage Example

Once the agent is running in the terminal, just give it a prompt:

> *"Refactor `auth.ts` to use JWT instead of sessions, add proper error handling, run the test suite, and fix any type errors you cause."*

SomaFlow will:
1. Parse the codebase.
2. Stage the changes.
3. Run ESLint and TypeScript.
4. Auto-fix errors.
5. Present a unified diff and a Reviewer critique for your approval.

---

## Contributing

SomaFlow is highly modular. You can easily add new tools to `modes/agent/agent-tools.ts` or tweak the auto-correction loop in `modes/agent/orchestrator.ts`. 

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