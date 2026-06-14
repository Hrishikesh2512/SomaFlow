import { tool } from "ai";
import { z } from "zod";
import type { ToolExecutor } from "./tool-executor";
import type { MemoryStore } from "../../src/memory/store";
import { createMemoryTools } from "../../src/memory/tools";
import { repoMapStore } from "../../src/repomap/store";
import { formatDetailedRepoMap } from "../../src/repomap/formatter";

export function createAgentTools(executor: ToolExecutor, memory: MemoryStore) {
  return {
    ...createMemoryTools(memory),
    read_file: tool({
      description:
        "Read a text file from the workspace. Use a path relative to the project root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path: p }) => executor.readFile(p),
    }),

    read_file_lines: tool({
      description:
        "Read specific lines from a file. Returns numbered lines. Much cheaper than reading the whole file for large files.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
        startLine: z.number().int().min(1).describe("First line to read (1-indexed)"),
        endLine: z.number().int().min(1).describe("Last line to read (inclusive)"),
      }),
      execute: async ({ path: p, startLine, endLine }) =>
        executor.readFileLines(p, startLine, endLine),
    }),

    summarize_file: tool({
      description: "Get a high-level AI summary of a file's contents, exports, and purpose. Much cheaper than reading the whole file.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path: p }) => executor.summarizeFile(p),
    }),

    create_file: tool({
      description:
        "Stage creation of a new file (not written until the user approves).",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path: p, content }) => executor.createFile(p, content),
    }),

    modify_file: tool({
      description:
        "Stage a full-file replacement for an existing file (pending approval).",
      inputSchema: z.object({
        path: z.string(),
        content: z.string().describe("Complete new file contents"),
      }),
      execute: async ({ path: p, content }) => executor.modifyFile(p, content),
    }),

    replace_in_file: tool({
      description:
        "Stage a single find/replace in an existing file (pending approval). Matching is exact first, then falls back to ignoring leading/trailing whitespace and re-indenting. By default the target must match one place; set replaceAll to change every occurrence. For several edits to one file, prefer edit_file.",
      inputSchema: z.object({
        path: z.string(),
        targetContent: z.string().describe("String to be replaced"),
        replacementContent: z.string().describe("New content to replace with"),
        replaceAll: z.boolean().optional().default(false).describe("Replace every occurrence instead of requiring a unique match"),
      }),
      execute: async ({ path: p, targetContent, replacementContent, replaceAll }) =>
        executor.replaceInFile(p, targetContent, replacementContent, replaceAll),
    }),

    edit_file: tool({
      description:
        "Stage multiple find/replace edits to a single file in one atomic operation (pending approval). Edits apply in order, each seeing the result of the previous. If any edit fails to match, the whole batch is rejected and nothing is staged. Matching is exact first, then whitespace/indentation-flexible. This is the preferred tool for changing existing files.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
        edits: z
          .array(
            z.object({
              oldText: z.string().describe("Text to find (must be non-empty and differ from newText)"),
              newText: z.string().describe("Replacement text"),
              replaceAll: z.boolean().optional().default(false).describe("Replace every occurrence of oldText"),
            }),
          )
          .min(1)
          .describe("Ordered list of edits to apply"),
      }),
      execute: async ({ path: p, edits }) => executor.editFile(p, edits),
    }),

    delete_file: tool({
      description: "Stage deletion of a file (pending approval).",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.deleteFile(p),
    }),

    create_folder: tool({
      description:
        "Stage creation of a directory tree (pending approval). Uses mkdir -p on apply.",
      inputSchema: z.object({
        path: z.string().describe("Relative directory path"),
      }),
      execute: async ({ path: p }) => executor.createFolder(p),
    }),

    list_files: tool({
      description: "List files and directories under a path.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) =>
        executor.listFiles(p, recursive),
    }),

    search_files: tool({
      description:
        'Find files matching a glob pattern (e.g. "*.ts", "**/*.md"). Optional content substring filter.',
      inputSchema: z.object({
        root: z.string().describe("Directory to search, relative to root"),
        pattern: z
          .string()
          .describe("Glob-like pattern using * and ** (forward slashes)"),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) =>
        executor.searchFiles(root, pattern, content_contains),
    }),

    grep_content: tool({
      description:
        "Search for a text string across all files in the workspace, returning matching lines with surrounding context (like ripgrep). Use this for debugging errors or finding usages.",
      inputSchema: z.object({
        query: z.string().describe("The exact text to search for"),
        root: z.string().optional().default(".").describe("Directory to search in"),
        contextLines: z.number().int().optional().default(3).describe("Number of context lines above and below each match"),
      }),
      execute: async ({ query, root, contextLines }) =>
        executor.grepContent(query, root, contextLines),
    }),

    analyze_codebase: tool({
      description:
        "Summarize structure: file counts, size, extensions. Read-only.",
      inputSchema: z.object({
        path: z.string().default("."),
      }),
      execute: async ({ path: p }) => executor.analyzeCodebase(p),
    }),

    execute_shell: tool({
      description:
        "Queue a shell command to run in the workspace after user approval. Use with care.",
      inputSchema: z.object({
        command: z.string().describe("Single command; runs with shell: true"),
      }),
      execute: async ({ command }) => executor.queueShell(command),
    }),

    spawn_background_task: tool({
      description: "Spawn a shell command in the background (detached). Returns a Task ID to check logs later. Useful for long-running processes (e.g. servers, huge builds).",
      inputSchema: z.object({
        command: z.string().describe("Command to run in background"),
      }),
      execute: async ({ command }) => executor.spawnBackgroundTask(command),
    }),

    check_background_task: tool({
      description: "Read the current log output of a background task by its ID.",
      inputSchema: z.object({
        taskId: z.string().describe("Task ID returned from spawn_background_task"),
      }),
      execute: async ({ taskId }) => executor.checkBackgroundTask(taskId),
    }),

    ask_user: tool({
      description:
        "Pause execution to ask the user a clarifying question and wait for their typed reply, which is returned to you. Use when the task is ambiguous or you need a decision before proceeding. Prefer asking over guessing on irreversible choices.",
      inputSchema: z.object({
        question: z.string().describe("The question to ask the user"),
      }),
      execute: async ({ question }) => executor.askUser(question),
    }),

    web_search: tool({
      description: "Search the web for information (e.g., documentation, errors, general queries).",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => executor.webSearch(query),
    }),

    fetch_url: tool({
      description: "Fetch the content of a URL and convert it to clean Markdown. Results are cached for 24 hours.",
      inputSchema: z.object({
        url: z.string().describe("The full URL to fetch"),
      }),
      execute: async ({ url }) => executor.fetchUrl(url),
    }),

    fetch_docs: tool({
      description: "Fetch documentation for an npm package or any URL. Converts to Markdown and caches for 24h. Always cite the source in your response.",
      inputSchema: z.object({
        packageOrUrl: z.string().describe("npm package name (e.g. 'zod') or full URL (e.g. 'https://zod.dev')"),
      }),
      execute: async ({ packageOrUrl }) => executor.fetchDocs(packageOrUrl),
    }),

    // ─── Git tools ──────────────────────────────────────────────────────────

    git_status: tool({
      description: "Get the current git status (staged, unstaged, untracked files). Immediate read-only.",
      inputSchema: z.object({}),
      execute: async () => executor.gitStatus(),
    }),

    git_diff: tool({
      description: "Show the git diff for the entire workspace or a specific file. Immediate read-only.",
      inputSchema: z.object({
        file: z.string().optional().describe("Optional: specific file path to diff"),
      }),
      execute: async ({ file }) => executor.gitDiff(file),
    }),

    git_log: tool({
      description: "Show the last N git commits as a one-line log. Immediate read-only.",
      inputSchema: z.object({
        n: z.number().int().min(1).max(50).optional().default(10).describe("Number of commits to show"),
      }),
      execute: async ({ n }) => executor.gitLog(n),
    }),

    git_commit: tool({
      description: "Stage all changes and commit with a message. Queued for user approval.",
      inputSchema: z.object({
        message: z.string().describe("The commit message"),
      }),
      execute: async ({ message }) => executor.gitCommit(message),
    }),

    git_create_branch: tool({
      description: "Create and switch to a new git branch. Queued for user approval. Blocked on protected branches (main, master).",
      inputSchema: z.object({
        name: z.string().describe("The new branch name"),
      }),
      execute: async ({ name }) => executor.gitCreateBranch(name),
    }),

    git_checkout: tool({
      description: "Switch to an existing git branch. Queued for approval. Will refuse if working tree is dirty.",
      inputSchema: z.object({
        branch: z.string().describe("Branch name to check out"),
      }),
      execute: async ({ branch }) => executor.gitCheckout(branch),
    }),

    git_push: tool({
      description: "Push the current branch to a remote. Queued for user approval.",
      inputSchema: z.object({
        remote: z.string().optional().default("origin").describe("Remote name (default: origin)"),
        branch: z.string().optional().describe("Branch name (defaults to current branch)"),
      }),
      execute: async ({ remote, branch }) => executor.gitPush(remote, branch),
    }),

    git_stash: tool({
      description: "Stash current working tree changes. Queued for user approval.",
      inputSchema: z.object({
        message: z.string().optional().describe("Optional stash message"),
      }),
      execute: async ({ message }) => executor.gitStash(message),
    }),

    // ─── Repo Map tools ─────────────────────────────────────────────────────

    get_repo_map: tool({
      description: "Get a detailed repo map listing all files and their exported symbols, classes, and functions. Use to understand project structure.",
      inputSchema: z.object({
        filter: z.string().optional().describe("Optional: comma-separated file paths or names to filter"),
      }),
      execute: async ({ filter }) => {
        const files = filter ? filter.split(",").map((s) => s.trim()) : undefined;
        return formatDetailedRepoMap(files);
      },
    }),

    query_repo_map: tool({
      description: "Search the repo index for a specific symbol name, file name, or keyword. Returns matching files and their symbols.",
      inputSchema: z.object({
        query: z.string().describe("Symbol or file name to search for"),
      }),
      execute: async ({ query }) => {
        const matches = repoMapStore.query(query);
        if (!matches.length) return `No matches found for: "${query}"\nTry get_repo_map to see all files.`;
        return matches.map((f) => {
          const syms = f.symbols.map((s) => `  - [${s.kind}] ${s.name} (line ${s.line})`).join("\n");
          return `## ${f.path}\n${syms || "  (no symbols)"}`;
        }).join("\n\n");
      },
    }),

    // ─── Other tools ─────────────────────────────────────────────────────────

    run_typecheck: tool({
      description: "Run the TypeScript compiler (tsc --noEmit) to check for errors immediately. Use this to verify code before finishing.",
      inputSchema: z.object({}),
      execute: async () => executor.runImmediateShell("bunx tsc --noEmit"),
    }),

    run_tests: tool({
      description: "Run the project test suite (bun test) immediately and return the results. Use this to verify code changes don't break tests.",
      inputSchema: z.object({
        filter: z.string().optional().describe("Optional test file or pattern to filter"),
      }),
      execute: async ({ filter }) => {
        const cmd = filter ? `bun test ${filter}` : "bun test";
        return executor.runImmediateShell(cmd);
      },
    }),

    run_formatter: tool({
      description: "Run a code formatter (prettier) on a specific file or directory. Executes immediately.",
      inputSchema: z.object({
        path: z.string().describe("File or directory to format"),
      }),
      execute: async ({ path: p }) =>
        executor.runImmediateShell(`bunx prettier --write "${p}"`),
    }),

    install_dependency: tool({
      description: "Queue installation of an npm/bun package (pending user approval). Example: 'zod', 'chalk@5'.",
      inputSchema: z.object({
        packageName: z.string().describe("Package name, optionally with version (e.g. 'zod', 'chalk@5')"),
        dev: z.boolean().optional().default(false).describe("Install as devDependency"),
      }),
      execute: async ({ packageName, dev }) => {
        const flag = dev ? " --dev" : "";
        return executor.queueShell(`bun add ${packageName}${flag}`);
      },
    }),

    search_symbol: tool({
      description: "Find where a symbol (class, function, variable, interface, type) is declared across the workspace. Uses the TypeScript language service for accurate, semantic results (falls back to regex if needed).",
      inputSchema: z.object({
        symbolName: z.string(),
      }),
      execute: async ({ symbolName }) => executor.searchSymbolSemantic(symbolName),
    }),

    find_definition: tool({
      description: "Semantic go-to-definition: resolve a symbol by name to its true declaration location(s) using the TypeScript language service. More accurate than text search for understanding where something comes from.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name to resolve"),
        fromFile: z.string().optional().describe("Optional file to disambiguate which symbol you mean"),
      }),
      execute: async ({ symbol, fromFile }) => executor.findDefinition(symbol, fromFile),
    }),

    find_references: tool({
      description: "Semantic find-all-references: list every place a symbol is used across the workspace (call sites, imports, the declaration). Use this before renaming or changing a function's signature to see the blast radius.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name to find references for"),
        fromFile: z.string().optional().describe("Optional file to disambiguate which symbol you mean"),
      }),
      execute: async ({ symbol, fromFile }) => executor.findReferences(symbol, fromFile),
    }),

    get_type: tool({
      description: "Get the resolved type signature and documentation for a symbol (like hovering over it in an editor). Use to learn a function's real parameters/return type instead of guessing.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name to inspect"),
        fromFile: z.string().optional().describe("Optional file to disambiguate which symbol you mean"),
      }),
      execute: async ({ symbol, fromFile }) => executor.getTypeInfo(symbol, fromFile),
    }),

    get_diagnostics: tool({
      description: "Get TypeScript type/syntax errors for a file (or the whole workspace) via the language service. This reflects your STAGED, un-applied edits, so use it to verify changes BEFORE asking for approval — faster and more precise than run_typecheck.",
      inputSchema: z.object({
        file: z.string().optional().describe("Optional relative file path; omit to check the whole workspace"),
      }),
      execute: async ({ file }) => executor.getDiagnostics(file),
    }),

    list_skills: tool({
      description:
        "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
      inputSchema: z.object({}),
      execute: async () => executor.listSkills(),
    }),

    read_skill: tool({
      description:
        "Read a SKILL.md file. Path must be absolute and under skill roots, or use a path returned by list_skills.",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.readSkill(p),
    }),
  };
}