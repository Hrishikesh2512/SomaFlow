<div align="center">

<img src="assets/splash.png" width="80%" alt="SomaFlow" />

<br/><br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-f472b6?style=flat-square)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square&logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Agents](https://img.shields.io/badge/agents-4-64ffda?style=flat-square)]()
[![Tools](https://img.shields.io/badge/tools-25+-64ffda?style=flat-square)]()

</div>

<br/>

```
give it a task.
it plans → codes → reviews its own diff → fixes type errors → asks you to approve.
nothing touches your filesystem until you say so.
```

<br/>

## what it actually does

SomaFlow takes a task description and turns it into reviewed, linted, type-checked code: staged for your approval before anything is written to disk. Not a chatbot. Not autocomplete. A single adaptive agent loop that investigates the code, plans as it learns, edits, verifies, and fixes itself — streaming its reasoning and tool calls live.

Runs as a Terminal UI locally or a Telegram bot remotely. Cold starts in under 100ms on Bun.

<br/>

## the loop

One adaptive agent — it reads the code *before* it plans, revises the plan as it learns, and verifies its own work. Then it critiques its own diff and gets a chance to fix it before you ever see it.

```
                         ┌──────────────────────────────────┐
                         │          ADAPTIVE AGENT          │
   task ───────────────▶ │  investigate → plan → act →      │ ◀── re-plans as it learns
                         │  verify (tsc / tests) → repeat   │
                         │  25+ tools · fs/git/shell · web  │
                         └────────────────┬─────────────────┘
                                          │ staged diff
                                 ┌────────▼─────────┐
                                 │  self-review →   │  reads its own diff,
                                 │  revise          │  critiques, fixes
                                 └────────┬─────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │ approval UI · git-style diff   │
                          │ you decide → apply             │
                          └───────────────┬───────────────┘
                                          │ on apply
                                 ┌────────▼─────────┐
                                 │  auto-fix loop   │  eslint + tsc,
                                 │  (up to 2x)      │  self-corrects
                                 └──────────────────┘
```

The whole run streams to your terminal as it happens — reasoning, the live plan checklist, and each tool call — instead of blocking until it's done. And it's a **continuing conversation**: history persists across turns, so you can give follow-ups, corrections, and new tasks with full context, hit **Ctrl-C** to interrupt mid-run and steer, or `/new` to start a fresh thread. Long sessions **auto-compact** — older turns are summarized to stay within the context window (or trigger it yourself with `/compact`).

<br/>

**agent in action: planning a task in real time:**

<div align="center">
  <img src="assets/agent-planning.png" width="90%" alt="SomaFlow agent planning output" />
</div>

<br/>

## tool suite

| category | tools |
|----------|-------|
| MCP | connect external Model Context Protocol servers; their tools load in as `mcp__<server>__<tool>` |
| delegation | spawn focused sub-agents (own clean context, shared workspace/staging) for isolated subtasks |
| filesystem | read, atomic multi-edit (whitespace-tolerant find/replace), delete, create files & folders |
| search & AST | ripgrep-style search, file listing, repo map |
| code intelligence | TypeScript language-service go-to-definition, find-all-references, type/hover, workspace symbol search |
| git & shell | read-only exec, queued mutating commands, background detached tasks |
| context | AI file summarization, session memory compression |
| verification | language-service diagnostics (sees staged edits), `bunx tsc --noEmit`, `eslint --fix`, `bun test` |

<br/>

## auto-correction loop

before you ever see the output:

```
staged changes
    │
    ├── eslint --fix          (style, silently)
    ├── tsc --noEmit          (catch type errors)
    │
    └── errors found?
            │
            ├── yes → spawn Auto-Fix Agent (max 2 attempts)
            └── no  → surface diff for approval
```

it does not ask you to fix its mistakes. it tries to fix them itself first.

<br/>

## getting started

**prerequisites:** Bun `>= 1.0`, an LLM provider API key (OpenRouter, OpenAI, Anthropic, Gemini)

```bash
git clone https://github.com/Hrishikesh2512/SomaFlow.git
cd SomaFlow
bun install
bun run index.ts        # onboarding wizard runs on first launch
```

first run drops you into an interactive setup: name your agent, pick your model, configure Telegram if you want it:

<div align="center">
  <img src="assets/onboarding.png" width="85%" alt="SomaFlow first-time setup wizard" />
</div>

<br/>

generates `~/.somaflow.json` with your preferences. after that:

```bash
bun run index.ts agent      # autonomous coding agent
bun run index.ts chat       # standard chat mode
bun run index.ts telegram   # start telegram bot listener
bun run index.ts --help     # all commands
```

<br/>

## connecting MCP servers

Drop a `.somaflow/mcp.json` in your project (or `~/.somaflow/mcp.json`, or point `SOMAFLOW_MCP_CONFIG` at any file). Standard MCP format:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "github":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." } }
  }
}
```

On launch, SomaFlow connects each server and exposes its tools to the agent as `mcp__<server>__<tool>`. No config = no MCP, zero overhead.

<br/>

## project structure

```
SomaFlow/
├── ai/             LLM integration, token streaming, Vercel AI SDK
├── memory/         persistent context, session memory, summarization
├── modes/
│   ├── agent/      orchestrator, executor, tracker, approval UI
│   ├── telegram/   bot routing and handlers
│   ├── plan/       planning mode
│   └── chat/       standard conversational mode
├── tui/            terminal UI, markdown rendering
└── index.ts
```

<br/>

## plugin ecosystem

```bash
bun run install-plugin <git-repo-url>   # install community plugin
bun run create-plugin                   # scaffold your own
```

plugins live in `./plugins/`. fully modular: add tools to the agent or build new modes entirely.

<br/>

## contributing

fork → `git checkout -b feat/my-change` → PR. see [CONTRIBUTING.md](CONTRIBUTING.md).

<br/>

## license

MIT. use it, fork it, ship it.

<br/>

<div align="center">
  <sub>built with 🌊 by the SomaFlow contributors</sub>
</div>
