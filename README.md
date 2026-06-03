<div align="center">

# 🌊 SomaFlow

**A modular, multi-mode AI agent orchestrator — built natively with Bun and TypeScript.**

Run it in your terminal. Deploy it as a Telegram bot. Switch execution personas on the fly.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## What is SomaFlow?

SomaFlow is an open-source AI agent orchestrator that lets you route LLM interactions through four distinct behavioral modes — each with its own system prompt, context isolation, and execution logic. It runs natively via [Bun](https://bun.sh) for near-instant startup, supports a local terminal UI for debugging, and integrates directly with Telegram for deployment.

Think of it as a lightweight, hackable backbone for building opinionated AI agents — not a monolithic framework, but a set of composable parts you can extend.

---

## Features

- **⚡ Native speed** — powered by Bun for sub-100ms cold starts and TypeScript throughout
- **🧠 Four execution modes** — swap agent personas and system prompts without restarting
- **🖥️ Terminal UI** — debug and monitor agent behavior locally before deploying
- **💬 Telegram integration** — ship your agent as a bot with minimal configuration
- **🔌 LLM-provider agnostic** — works with OpenRouter, OpenAI, Anthropic, or any OpenAI-compatible endpoint
- **📦 Modular architecture** — each mode is an isolated module; fork, replace, or extend independently

---

## Project Structure

```
SomaFlow/
├── ai/             # Core LLM integration: token streaming, OpenClaw engine, provider routing
├── modes/          # Four behavioral mode modules — system prompts + execution logic
│   ├── mode1/
│   ├── mode2/
│   ├── mode3/
│   └── mode4/
├── tui/            # Terminal UI for local debugging and agent monitoring
├── index.ts        # Entry point — launches TUI or bot depending on environment
├── .env.example    # Environment variable template
└── bun.lockb
```

---

## The Four Modes

| Command | Mode | Description |
|---|---|---|
| `/mode1` | **Action** | Brief one-sentence explanation of Mode 1 behavior. |
| `/mode2` | **Context** | Brief one-sentence explanation of Mode 2 behavior. |
| `/mode3` | **Tool** | Brief one-sentence explanation of Mode 3 behavior. |
| `/mode4` | **Creative** | Brief one-sentence explanation of Mode 4 behavior. |

> Each mode is fully self-contained in `modes/`. To customize behavior, edit its system prompt or execution logic independently — no other modes are affected.

---

## Prerequisites

- [Bun](https://bun.sh) `>= 1.0` installed
- An API key from an LLM provider (OpenRouter, OpenAI, Anthropic, etc.)
- A Telegram Bot token from [@BotFather](https://t.me/botfather) *(only needed for bot deployment)*

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-username/SomaFlow.git
cd SomaFlow
```

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials:

```env
# Required for Telegram bot deployment
TELEGRAM_BOT_TOKEN=your_telegram_token_here

# Required: LLM provider API key
OPENROUTER_API_KEY=your_llm_provider_key_here

# Optional: override the default model
# MODEL=openai/gpt-4o
```

### 4. Run

**Local terminal (recommended for development):**

```bash
bun run index.ts
```

**Telegram bot mode** is activated automatically when `TELEGRAM_BOT_TOKEN` is present in your environment.

---

## Usage

### Terminal Interface

The TUI spins up an interactive session in your terminal. Use it to test mode switching, inspect token streams, and debug agent behavior before deploying.

### Telegram Commands

Once your bot is live, interact using:

```
/mode1   Switch to Action mode
/mode2   Switch to Context mode
/mode3   Switch to Tool mode
/mode4   Switch to Creative mode
```

---

## Configuration

SomaFlow is configured entirely through environment variables. See `.env.example` for all supported options.

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | API key for your LLM provider |
| `TELEGRAM_BOT_TOKEN` | Bot only | Token from @BotFather |
| `MODEL` | ❌ | Override the default model (e.g. `openai/gpt-4o`) |

---

## Contributing

Contributions are welcome and encouraged. SomaFlow is intentionally modular so you can improve one part without touching others.

**Good places to start:**

- Add a new execution mode in `modes/`
- Improve token streaming in `ai/`
- Add support for a new LLM provider
- Extend the TUI with new monitoring panels
- Fix a bug or improve error handling

**Workflow:**

1. Fork the repo and create a feature branch (`git checkout -b feat/my-change`)
2. Make your changes and add tests if applicable
3. Open a pull request with a clear description of what changed and why

Please open an issue first for larger changes so we can discuss the approach before you invest time in it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## Roadmap

- [ ] Web UI alongside the TUI
- [ ] Persistent conversation memory
- [ ] Discord integration
- [ ] Plugin system for tool-use modes
- [ ] Docker deployment template

Have an idea? [Open an issue](https://github.com/your-username/SomaFlow/issues).

---

## License

MIT — see [LICENSE](LICENSE) for details. Free to use, modify, and distribute.

---

<div align="center">
  <sub>Built with 🌊 by the SomaFlow contributors</sub>
</div>