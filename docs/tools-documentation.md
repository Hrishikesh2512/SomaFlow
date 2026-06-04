# 🛠️ SomaFlow Tools Documentation

SomaFlow is equipped with a comprehensive suite of **30 specialized tools** that empower the agent to navigate, analyze, modify, and execute tasks across your entire workspace.

This document details every tool available to the **Executor Agent**.

---

## 📂 File I/O (8 Tools)
Tools for interacting directly with the filesystem. All mutating actions are staged and require user approval.

| Tool Name | Description | Staged? |
| :--- | :--- | :---: |
| `read_file` | Reads the entire contents of a text file. Automatically truncates large files. | ❌ |
| `read_file_lines` | Reads a specific line range (e.g. lines 50–100). Essential for saving context tokens. | ❌ |
| `summarize_file` | Spawns an LLM process in the background to read a large file and return a dense 150-word technical summary of its exports and purpose. | ❌ |
| `create_file` | Stages the creation of a new file with specified content. | ✅ |
| `modify_file` | Stages an exact string replacement within an existing file. | ✅ |
| `replace_in_file` | Stages the complete replacement of a file's entire content. | ✅ |
| `delete_file` | Stages the deletion of a specific file. | ✅ |
| `create_folder` | Stages the creation of a new directory. | ✅ |

---

## 🔍 Search & Analysis (5 Tools)
Tools for finding code, symbols, and exploring the architecture.

| Tool Name | Description | Staged? |
| :--- | :--- | :---: |
| `list_files` | Lists files in a specific directory (non-recursive). | ❌ |
| `search_files` | Recursively searches for files matching a glob pattern (e.g. `**/*.ts`). | ❌ |
| `grep_content` | Ripgrep-style string matching across the entire workspace. Returns exact matches with ±3 lines of context. | ❌ |
| `search_symbol` | Looks up definitions of classes, functions, interfaces, or variables across the codebase. | ❌ |
| `analyze_codebase` | Returns a high-level summary of the workspace's structure, top-level directories, and `package.json` scripts. | ❌ |

---

## 💻 Execution & Verification (8 Tools)
Tools for running code, testing, formatting, and background processes.

| Tool Name | Description | Staged? |
| :--- | :--- | :---: |
| `execute_shell` | Stages a terminal command (e.g. `rm -rf dist` or `npm run build`). | ✅ |
| `git_execute` | Smart Git wrapper. If the command is read-only (`git status`, `git log`), it runs immediately. If it mutates state (`git commit`, `git checkout`), it is staged for approval. | ⚠️ |
| `spawn_background_task` | Spawns a detached background process (like a heavy test suite or server build). Returns a `taskId` and frees up the agent instantly. | ❌ |
| `check_background_task` | Reads the current log output of a spawned background task using its `taskId`. | ❌ |
| `run_tests` | Immediately runs `bun test` in the terminal and returns the results. | ❌ |
| `run_formatter` | Immediately runs `bunx prettier --write` on a specific file or directory. | ❌ |
| `install_dependency` | Stages a `bun add <pkg>` command for approval. | ✅ |
| `run_typecheck` | Immediately runs `bunx tsc --noEmit` and returns all TypeScript errors. | ❌ |

---

## 🌐 Web & External (2 Tools)
Tools for connecting to the outside world for research and API testing.

| Tool Name | Description | Staged? |
| :--- | :--- | :---: |
| `web_search` | Performs a DuckDuckGo search to find external documentation, recent updates, or troubleshooting steps. | ❌ |
| `fetch_url` | Makes an HTTP GET/POST request to a URL. Automatically parses JSON or plain text. Truncates massive responses. | ❌ |

---

## 🧠 Memory & Context (4 Tools)
Tools for persisting knowledge across sessions and avoiding context token exhaustion.

| Tool Name | Description | Staged? |
| :--- | :--- | :---: |
| `add_memory` | Saves a fact, decision, or user preference into `memory.json`. | ❌ |
| `search_memory` | Retrieves previously stored memories based on a semantic query. | ❌ |
| `remove_memory` | Deletes an outdated or incorrect memory by its ID. | ❌ |
| `summarize_memory` | When the memory log gets too large, the agent uses this tool to call an LLM to compress all memories into a single dense paragraph, replacing the old list. | ❌ |

---

## 🧩 Skills & Interaction (3 Tools)
Tools for communicating with the user and reading predefined operational playbooks.

| Tool Name | Description | Staged? |
| :--- | :--- | :---: |
| `ask_user` | Pauses execution to prompt the user with a clarifying question. Essential for resolving ambiguity. | ✅ |
| `list_skills` | Lists all predefined "Skills" (custom markdown instructions) available in the `.somaflow/skills/` directory. | ❌ |
| `read_skill` | Reads the detailed instructions of a specific skill to learn how to perform a specialized workflow. | ❌ |

---

> **Note on "Staged" tools:** Any tool marked as ✅ (Staged) will not modify your filesystem or execute state-changing commands immediately. Instead, they are placed in a queue. Once the agent is finished working, the orchestrator groups all staged changes, generates unified diffs, runs the **Reviewer Agent** to critique them, and prompts you in the terminal for final approval.
