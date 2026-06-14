import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isCancel, text } from "@clack/prompts";
import type {AgentConfig, ActionLog} from './types';
import{ActionTracker} from './action-tracker';
import { applyEdits } from "./edit-engine";
import type { FileEdit } from "./edit-engine";
import { CodeIntel } from "../../src/intel/code-intel";
import type { OverlayAccess } from "../../src/intel/code-intel";
import { GitClient } from "../../src/git/client";
import { guardCheckout, guardPush, guardCommit, guardDestructive } from "../../src/git/guards";
import { takeSnapshot } from "../../src/history/index";
import { createSearchProvider, formatSearchResults } from "../../src/web/search";
import { fetchPageAsMarkdown, npmDocsUrl } from "../../src/web/fetcher";


const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
]);

function isProbablyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXT.has(ext) || ext === "";
}

export class ToolExecutor{
  private overlay = new Map<string, string>();
  private deleted = new Set<string>();
  private readonly norm = (rel: string) =>
    path.posix.normalize(rel.split(path.sep).join("/")).replace(/^\.\//, "");

    private readonly git: GitClient;

    constructor(
        private readonly tracker:ActionTracker,
        private readonly config:AgentConfig
    ){
      this.git = new GitClient(config.codebasePath);
    }

  private resolveSafe(rel: string): string {
    // LLMs often hallucinate a leading slash before Windows drive letters (e.g., /C:/)
    const cleanedRel = rel.replace(/^\/([A-Z]:)/i, "$1");
    const abs = path.resolve(this.config.codebasePath, cleanedRel);
    const root = path.resolve(this.config.codebasePath);
    const relCheck = path.relative(root, abs);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      throw new Error(`Path escapes workspace: ${rel}`);
    }
    return abs;
  }

  private excluded(relPath: string): boolean {
    const norm = this.norm(relPath);
    const segments = norm.split("/");
    const base = segments[segments.length - 1] ?? "";

    for (const pat of this.config.excludePatterns) {
      if (pat === "*.log" && base.endsWith(".log")) return true;
      if (pat === ".env*" && base.startsWith(".env")) return true;
      if (pat.includes("*")) continue;
      if (segments.includes(pat) || norm === pat || norm.startsWith(`${pat}/`))
        return true;
    }
    return false;
  }

    private assertNotExcluded(rel: string, op: string): void {
    if (this.excluded(rel)) {
      throw new Error(`${op}: path is excluded by policy: ${rel}`);
    }
  }

  getEffectiveText(rel: string): string | undefined {
    const key = this.norm(rel);
    if (this.deleted.has(key)) return undefined;
    if (this.overlay.has(key)) return this.overlay.get(key);
    const abs = this.resolveSafe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
    return fs.readFileSync(abs, "utf8");
  }

  readFile(rel: string): string {
    this.assertNotExcluded(rel, "read_file");
    const text = this.getEffectiveText(rel);
    if (text === undefined) {
      throw new Error(`File not found: ${rel}`);
    }
    if (new TextEncoder().encode(text).length > this.config.maxFileSizeToRead) {
      throw new Error(`File too large: ${rel}`);
    }
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rel),
      details: { after: text, toolName: "read_file" },
      status: "executed",
    });
    return text;
  }

  async summarizeFile(rel: string): Promise<string> {
    this.assertNotExcluded(rel, "summarize_file");
    const abs = this.resolveSafe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`File not found: ${rel}`);
    }
    const st = fs.statSync(abs);
    // Even for summarization, avoid huge binaries, but allow larger text files.
    if (st.size > 2 * 1024 * 1024) {
      throw new Error(`File too large for summarization: ${rel}`);
    }
    const text = fs.readFileSync(abs, "utf8");
    
    try {
      const { default: getModel } = await import("../../src/ai/ai.config.ts") as any;
      const { generateText } = await import("ai");
      
      const result = await generateText({
        model: getModel.getAgentModel(),
        system: "You are a code summarizer. Your job is to output a concise, technical summary of the provided file. Focus on exports, key classes, and main purpose. Keep it under 150 words.",
        prompt: `File: ${rel}\n\n${text}`
      });

      const summary = result.text.trim();
      this.tracker.log({
        type: "code_analysis",
        path: this.norm(rel),
        details: { after: summary, toolName: "summarize_file" },
        status: "executed",
      });
      return summary;
    } catch (e: any) {
      throw new Error(`Failed to summarize file: ${e.message}`);
    }
  }

  readFileLines(rel: string, startLine: number, endLine: number): string {
    this.assertNotExcluded(rel, "read_file_lines");
    const text = this.getEffectiveText(rel);
    if (text === undefined) {
      throw new Error(`File not found: ${rel}`);
    }
    const allLines = text.split("\n");
    const total = allLines.length;
    const s = Math.max(1, startLine);
    const e = Math.min(total, endLine);
    if (s > e) throw new Error(`Invalid range: ${s}-${e} (file has ${total} lines)`);
    const selected = allLines.slice(s - 1, e);
    const numbered = selected.map((line, i) => `${s + i}: ${line}`).join("\n");
    const header = `[${rel}] Lines ${s}-${e} of ${total}\n`;
    const result = header + numbered;
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rel),
      details: { after: result, toolName: "read_file_lines" },
      status: "executed",
    });
    return result;
  }

  createFile(rel: string, content: string): string {
    if (!this.config.tools.allowFileCreation)
      throw new Error("File creation disabled");
    this.assertNotExcluded(rel, "create_file");
    const key = this.norm(rel);
    const abs = this.resolveSafe(rel);
    if (fs.existsSync(abs) && !this.deleted.has(key)) {
      throw new Error(`create_file: already exists: ${rel}`);
    }
    this.deleted.delete(key);
    this.overlay.set(key, content);
    const snap = takeSnapshot(this.config.codebasePath, rel, content, `create_file: ${rel}`);
    this.tracker.log({
      type: "file_create",
      path: key,
      details: { after: content, snapshotId: snap.id },
      status: "pending",
    });
    return `Staged new file: ${key}`;
  }

  modifyFile(rel: string, content: string): string {
    if (!this.config.tools.allowFileModification)
      throw new Error("File modification disabled");
    this.assertNotExcluded(rel, "modify_file");
    const before = this.getEffectiveText(rel);
    if (before === undefined)
      throw new Error(`modify_file: file not found: ${rel}`);
    const key = this.norm(rel);
    this.overlay.set(key, content);
    const snap = takeSnapshot(this.config.codebasePath, rel, content, `modify_file: ${rel}`);
    this.tracker.log({
      type: "file_modify",
      path: key,
      details: { before, after: content, snapshotId: snap.id },
      status: "pending",
    });
    return `Staged update: ${key}`;
  }

  replaceInFile(
    rel: string,
    targetContent: string,
    replacementContent: string,
    replaceAll = false,
  ): string {
    return this.editFile(rel, [
      { oldText: targetContent, newText: replacementContent, replaceAll },
    ]);
  }

  /**
   * Apply one or more find/replace edits to a file atomically, using the tiered
   * edit engine (exact match, then whitespace/indentation-flexible fallback).
   */
  editFile(rel: string, edits: FileEdit[]): string {
    if (!this.config.tools.allowFileModification)
      throw new Error("File modification disabled");
    this.assertNotExcluded(rel, "edit_file");
    const before = this.getEffectiveText(rel);
    if (before === undefined)
      throw new Error(`edit_file: file not found: ${rel}`);

    const result = applyEdits(before, edits);
    if (!result.ok || result.content === undefined) {
      throw new Error(`edit_file (${rel}): ${result.error}`);
    }
    if (result.content === before) {
      throw new Error(`edit_file (${rel}): edits produced no change`);
    }

    const after = result.content;
    const key = this.norm(rel);
    this.overlay.set(key, after);
    const snap = takeSnapshot(this.config.codebasePath, rel, after, `edit_file: ${rel}`);
    const usedFuzzy = result.strategies?.includes("whitespace");
    this.tracker.log({
      type: "file_modify",
      path: key,
      details: { before, after, snapshotId: snap.id },
      status: "pending",
    });
    return `Staged ${edits.length} edit(s) in: ${key}${usedFuzzy ? " (whitespace-matched)" : ""}`;
  }

  deleteFile(rel: string): string {
    if (!this.config.tools.allowFileModification)
      throw new Error("File deletion disabled");
    this.assertNotExcluded(rel, "delete_file");
    const before = this.getEffectiveText(rel);
    if (before === undefined)
      throw new Error(`delete_file: file not found: ${rel}`);
    const key = this.norm(rel);
    this.overlay.delete(key);
    this.deleted.add(key);
    const snap = takeSnapshot(this.config.codebasePath, rel, undefined, `delete_file: ${rel}`);
    this.tracker.log({
      type: "file_delete",
      path: key,
      details: { before, snapshotId: snap.id },
      status: "pending",
    });
    return `Staged delete: ${key}`;
  }



  createFolder(rel: string): string {
    if (!this.config.tools.allowFolderCreation)
      throw new Error("Folder creation disabled");
    this.assertNotExcluded(rel, "create_folder");
    const key = this.norm(rel);
    this.tracker.log({
      type: "folder_create",
      path: key,
      details: { after: key },
      status: "pending",
    });
    return `Staged folder: ${key}`;
  }  


  listFiles(rel: string, recursive: boolean): string {
    this.assertNotExcluded(rel, "list_files");
    const abs = this.resolveSafe(rel);
    if (!fs.existsSync(abs)) throw new Error(`list_files: not found: ${rel}`);

    const lines: string[] = [];
    const walk = (dir: string, prefix: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        const relP = path.relative(this.config.codebasePath, full);
        if (this.excluded(relP)) continue;
        if (ent.isDirectory()) {
          lines.push(`${prefix}${ent.name}/`);
          if (recursive) walk(full, `${prefix}${ent.name}/`);
        } else {
          lines.push(`${prefix}${ent.name}`);
        }
      }
    };

    if (fs.statSync(abs).isDirectory()) walk(abs, "");
    else lines.push(path.relative(this.config.codebasePath, abs));

    const out = lines.sort().join("\n");
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rel),
      details: { after: out, toolName: "list_files" },
      status: "executed",
    });
    return out || "(empty)";
  }

  searchFiles(
    rootRel: string,
    globPattern: string,
    contentQuery?: string,
  ): string {
    this.assertNotExcluded(rootRel, "search_files");
    const rootAbs = this.resolveSafe(rootRel);
    if (!fs.existsSync(rootAbs))
      throw new Error(`search_files: root not found: ${rootRel}`);

    const results: string[] = [];
    const regexFromGlob = (g: string): RegExp => {
      const escaped = g
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/\\\\]*")
        .replace(/§§/g, ".*")
        .replace(/\?/g, ".");
      return new RegExp(`^${escaped}$`, "i");
    };
    const nameRe = regexFromGlob(globPattern.replace(/\\/g, "/"));

    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const relP = path
          .relative(this.config.codebasePath, full)
          .split(path.sep)
          .join("/");
        if (this.excluded(relP)) continue;
        if (ent.isDirectory()) walk(full);
        else if (nameRe.test(relP) || nameRe.test(ent.name)) {
          if (contentQuery) {
            if (!isProbablyTextFile(full)) continue;
            const text = fs.readFileSync(full, "utf8");
            if (!text.includes(contentQuery)) continue;
          }
          results.push(relP);
        }
      }
    };

    if (fs.statSync(rootAbs).isDirectory()) walk(rootAbs);
    else {
      const relP = path
        .relative(this.config.codebasePath, rootAbs)
        .split(path.sep)
        .join("/");
      results.push(relP);
    }

    const out = [...new Set(results)].sort().join("\n");
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rootRel),
      details: { after: out || "(no matches)", toolName: "search_files" },
      status: "executed",
    });
    return out || "(no matches)";
  }

  // ─── Semantic code intelligence (TypeScript LanguageService) ──────────────────

  private intel?: CodeIntel;

  private absToKey(abs: string): string | undefined {
    const rel = path.relative(this.config.codebasePath, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    return this.norm(rel);
  }

  private ensureIntel(): CodeIntel {
    if (!this.intel) {
      const overlay: OverlayAccess = {
        get: (abs) => {
          const key = this.absToKey(abs);
          if (key === undefined || this.deleted.has(key)) return undefined;
          return this.overlay.get(key);
        },
        isDeleted: (abs) => {
          const key = this.absToKey(abs);
          return key !== undefined && this.deleted.has(key);
        },
        list: () =>
          [...this.overlay.keys()].map((k) => path.resolve(this.config.codebasePath, k)),
      };
      this.intel = new CodeIntel(this.config.codebasePath, overlay);
    }
    return this.intel;
  }

  private logIntel(toolName: string, command: string, after: string): string {
    this.tracker.log({
      type: "code_analysis",
      path: "intel",
      details: { after, toolName, command },
      status: "executed",
    });
    return after;
  }

  findDefinition(symbol: string, fromFile?: string): string {
    return this.logIntel("find_definition", symbol, this.ensureIntel().findDefinition(symbol, fromFile));
  }

  findReferences(symbol: string, fromFile?: string): string {
    return this.logIntel("find_references", symbol, this.ensureIntel().findReferences(symbol, fromFile));
  }

  getTypeInfo(symbol: string, fromFile?: string): string {
    return this.logIntel("get_type", symbol, this.ensureIntel().getType(symbol, fromFile));
  }

  getDiagnostics(file?: string): string {
    return this.logIntel("get_diagnostics", file ?? "(workspace)", this.ensureIntel().getDiagnostics(file));
  }

  /** Semantic symbol search via the LanguageService, falling back to regex. */
  searchSymbolSemantic(symbolName: string): string {
    try {
      const out = this.ensureIntel().searchSymbol(symbolName);
      if (!out.startsWith("No symbol named")) {
        return this.logIntel("search_symbol", symbolName, out);
      }
    } catch {
      /* fall through to regex */
    }
    return this.searchSymbol(symbolName);
  }

  searchSymbol(symbolName: string): string {
    const rootAbs = this.resolveSafe(".");
    const results: string[] = [];
    
    // Very basic regex heuristics for TS/JS files
    const regexes = [
      new RegExp(`(?:class|interface|type|function)\\s+${symbolName}\\b`, "i"),
      new RegExp(`(?:const|let|var)\\s+${symbolName}\\s*=\\s*(?:(?:async\\s+)?\\(|function|=>)`, "i"),
      new RegExp(`(?:const|let|var)\\s+${symbolName}\\s*=\\s*`, "i")
    ];

    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const relP = path.relative(this.config.codebasePath, full).split(path.sep).join("/");
        if (this.excluded(relP)) continue;
        if (ent.isDirectory()) {
          walk(full);
        } else if (isProbablyTextFile(full)) {
          const text = fs.readFileSync(full, "utf8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line && regexes.some(r => r.test(line))) {
              results.push(`${relP}:${i + 1}: ${line.trim()}`);
            }
          }
        }
      }
    };

    walk(rootAbs);

    const out = results.join("\n");
    this.tracker.log({
      type: "code_analysis",
      path: "symbol_search",
      details: { after: out || "(no matches)", toolName: "search_symbol", command: symbolName },
      status: "executed",
    });
    return out || "(no matches)";
  }

  grepContent(query: string, rootRel: string = ".", contextLines: number = 3): string {
    const rootAbs = this.resolveSafe(rootRel);
    if (!fs.existsSync(rootAbs))
      throw new Error(`grep_content: root not found: ${rootRel}`);

    const results: string[] = [];
    const MAX_RESULTS = 50;

    const walk = (dir: string) => {
      if (results.length >= MAX_RESULTS) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (results.length >= MAX_RESULTS) return;
        const full = path.join(dir, ent.name);
        const relP = path.relative(this.config.codebasePath, full).split(path.sep).join("/");
        if (this.excluded(relP)) continue;
        if (ent.isDirectory()) {
          walk(full);
        } else if (isProbablyTextFile(full)) {
          try {
            const text = fs.readFileSync(full, "utf8");
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= MAX_RESULTS) break;
              const line = lines[i];
              if (line && line.includes(query)) {
                const start = Math.max(0, i - contextLines);
                const end = Math.min(lines.length - 1, i + contextLines);
                const snippet: string[] = [`--- ${relP}:${i + 1} ---`];
                for (let j = start; j <= end; j++) {
                  const prefix = j === i ? "> " : "  ";
                  snippet.push(`${prefix}${j + 1}: ${lines[j]}`);
                }
                results.push(snippet.join("\n"));
              }
            }
          } catch { /* skip binary/unreadable */ }
        }
      }
    };

    walk(rootAbs);

    const out = results.join("\n\n");
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rootRel),
      details: { after: out || "(no matches)", toolName: "grep_content", command: query },
      status: "executed",
    });
    return out || "(no matches)";
  }

  analyzeCodebase(rootRel: string): string {
    const rootAbs = this.resolveSafe(rootRel);
    if (!fs.existsSync(rootAbs))
      throw new Error(`analyze_codebase: not found: ${rootRel}`);

    let files = 0;
    let dirs = 0;
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const relP = path.relative(this.config.codebasePath, full);
        if (this.excluded(relP)) continue;
        if (ent.isDirectory()) {
          dirs++;
          walk(full);
        } else {
          files++;
        }
      }
    };
    if (fs.statSync(rootAbs).isDirectory()) walk(rootAbs);
    else files = 1;

    const summary = `Files: ${files} | Directories: ${dirs}`;
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rootRel),
      details: { after: summary, toolName: "analyze_codebase" },
      status: "executed",
    });
    return summary;
  }

  queueShell(command: string): string {
    if (!this.config.tools.allowShellExecution)
      throw new Error("Shell execution disabled");
    this.tracker.log({
      type: "tool_execute",
      path: "shell",
      details: { command, toolName: "execute_shell" },
      status: "pending",
    });
    return `Shell queued: ${command}`;
  }

  async askUser(question: string): Promise<string> {
    const answer = await text({
      message: question,
      placeholder: "Type your answer (or press Enter to skip)...",
    });

    const reply = isCancel(answer) || !answer?.trim()
      ? "(user skipped the question — proceed using your best judgement)"
      : answer.trim();

    this.tracker.log({
      type: "ask_user",
      path: "interaction",
      details: { toolName: "ask_user", command: question, after: reply },
      status: "executed",
    });
    return reply;
  }

  async webSearch(query: string): Promise<string> {
    try {
      const provider = createSearchProvider();
      const results = await provider.search(query, 5);
      const formatted = formatSearchResults(results, query);
      this.tracker.log({
        type: "code_analysis",
        path: "web",
        details: { after: formatted, toolName: "web_search", command: query },
        status: "executed",
      });
      return formatted;
    } catch (e: any) {
      throw new Error(`Web search error: ${e.message}`);
    }
  }

  async fetchDocs(packageOrUrl: string): Promise<string> {
    try {
      // If it looks like a URL, fetch directly. Otherwise treat as npm package name.
      const url = packageOrUrl.startsWith("http")
        ? packageOrUrl
        : npmDocsUrl(packageOrUrl);
      const result = await fetchPageAsMarkdown(url);
      const out = `${result.citation}\n\n${result.markdown}`;
      this.tracker.log({
        type: "code_analysis",
        path: "docs",
        details: { after: out, toolName: "fetch_docs", command: packageOrUrl },
        status: "executed",
      });
      return out;
    } catch (e: any) {
      throw new Error(`fetch_docs error: ${e.message}`);
    }
  }

  async fetchUrl(url: string, _method: string = "GET"): Promise<string> {
    try {
      const result = await fetchPageAsMarkdown(url);
      const out = `${result.citation}\n${result.fromCache ? "(from cache)" : "(freshly fetched)"}\n\n${result.markdown}`;
      this.tracker.log({
        type: "code_analysis",
        path: "fetch",
        details: { after: out, toolName: "fetch_url", command: url },
        status: "executed",
      });
      return out;
    } catch (e: any) {
      throw new Error(`fetch_url error: ${e.message}`);
    }
  }

  runImmediateShell(command: string): string {
    const r = spawnSync(command, {
      shell: true,
      cwd: this.config.codebasePath,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    
    const output = (r.stdout || "") + "\n" + (r.stderr || "");
    this.tracker.log({
      type: "code_analysis",
      path: "shell",
      details: { after: output, toolName: "immediate_shell", command },
      status: "executed",
    });
    return output.trim() || "(no output)";
  }

  spawnBackgroundTask(command: string): string {
    const taskId = randomUUID();
    const logPath = path.join(this.config.codebasePath, `.somaflow-task-${taskId}.log`);
    
    const out = fs.openSync(logPath, "a");
    const err = fs.openSync(logPath, "a");

    const subprocess = spawn(command, [], {
      shell: true,
      cwd: this.config.codebasePath,
      detached: true,
      stdio: ["ignore", out, err],
    });

    subprocess.unref();

    const info = `Background task spawned.\nTask ID: ${taskId}\nLog Path: ${logPath}\nUse 'check_background_task' to read the log.`;
    this.tracker.log({
      type: "code_analysis",
      path: "background_task",
      details: { after: info, toolName: "spawn_background_task", command },
      status: "executed",
    });
    return info;
  }

  checkBackgroundTask(taskId: string): string {
    const logPath = path.join(this.config.codebasePath, `.somaflow-task-${taskId}.log`);
    if (!fs.existsSync(logPath)) {
      throw new Error(`No log found for task ID: ${taskId}`);
    }
    const logContent = fs.readFileSync(logPath, "utf8");
    const output = `--- Log for Task ${taskId} ---\n${logContent || "(empty)"}`;
    this.tracker.log({
      type: "code_analysis",
      path: "background_task",
      details: { after: output, toolName: "check_background_task", command: taskId },
      status: "executed",
    });
    return output;
  }

  skillRoots(): string[] {
    const extra =
      process.env.SKILLS_DIRS?.split(/[;]/)
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    return [
      ...extra,
      path.join(homedir(), ".cursor/skills-cursor"),
      path.join(homedir(), ".claude/skills"),
    ];
  }

  listSkills(): string {
    const lines: string[] = [];
    for (const root of this.skillRoots()) {
      if (!fs.existsSync(root)) continue;
      const walk = (dir: string) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else if (ent.name === "SKILL.md") lines.push(full);
        }
      };
      walk(root);
    }
    const out = lines.sort().join("\n");
    this.tracker.log({
      type: "code_analysis",
      path: "skills",
      details: { after: out || "(none)", toolName: "list_skills" },
      status: "executed",
    });
    return out || "(none)";
  }

  readSkill(skillPath: string): string {
    const abs = path.isAbsolute(skillPath)
      ? path.normalize(skillPath)
      : path.normalize(path.resolve(this.config.codebasePath, skillPath));
    const allowed = this.skillRoots().some((root) => {
      const r = path.resolve(root);
      return abs === r || abs.startsWith(r + path.sep);
    });
    if (!allowed) throw new Error("read_skill: outside skill roots");
    const text = fs.readFileSync(abs, "utf8");
    this.tracker.log({
      type: "code_analysis",
      path: abs,
      details: { after: text, toolName: "read_skill" },
      status: "executed",
    });
    return text;
  }

  applyApprovedFromTracker(): { errors: string[] } {
    const errors: string[] = [];
    const all = [...this.tracker.getActions()];

    for (const a of all.filter(
      (x) => x.type === "folder_create" && x.status === "approved",
    )) {
      try {
        fs.mkdirSync(this.resolveSafe(a.path), { recursive: true });
      } catch (e) {
        errors.push(String(e));
      }
    }

    const fileOps = all
      .filter(
        (a) =>
          (a.type === "file_create" ||
            a.type === "file_modify" ||
            a.type === "file_delete") &&
          a.status === "approved",
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const lastByPath = new Map<string, ActionLog>();
    for (const a of fileOps) lastByPath.set(this.norm(a.path), a);

    for (const [p, a] of lastByPath) {
      try {
        if (a.type === "file_delete")
          fs.rmSync(this.resolveSafe(p), { force: true });
        else {
          const target = this.resolveSafe(p);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, a.details.after ?? "", "utf8");
        }
      } catch (e) {
        errors.push(String(e));
      }
    }

    for (const a of all.filter(
      (x) => x.type === "tool_execute" && x.status === "approved",
    )) {
      const cmd = a.details.command;
      if (!cmd) continue;
      const r = spawnSync(cmd, {
        shell: true,
        cwd: this.config.codebasePath,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      if (r.status && r.status !== 0)
        errors.push(`shell exit ${r.status}: ${cmd}`);
    }

    return { errors };
  }

  clearStaging():void{
    this.overlay.clear()
    this.deleted.clear()
  }

  // ─── Git methods ────────────────────────────────────────────────────────────

  gitStatus(): string {
    return this.git.status();
  }

  gitDiff(file?: string): string {
    return this.git.diff(file);
  }

  gitLog(n = 10): string {
    return this.git.log(n);
  }

  gitCommit(message: string): string {
    const guard = guardCommit(this.git);
    if (!guard.ok) throw new Error(guard.reason);
    const cmd = `git add -A && git commit -m ${JSON.stringify(message)}`;
    return this.queueShell(cmd);
  }

  gitCreateBranch(name: string): string {
    const guard = guardDestructive(name);
    if (!guard.ok) throw new Error(guard.reason);
    return this.queueShell(`git checkout -b ${JSON.stringify(name)}`);
  }

  gitCheckout(branch: string): string {
    const guard = guardCheckout(this.git, branch);
    if (!guard.ok) throw new Error(guard.reason);
    return this.queueShell(`git checkout ${JSON.stringify(branch)}`);
  }

  gitPush(remote = "origin", branch?: string): string {
    const guard = guardPush(this.git);
    if (!guard.ok) throw new Error(guard.reason);
    const b = branch ?? this.git.currentBranch();
    return this.queueShell(`git push ${remote} ${b}`);
  }

  gitStash(message?: string): string {
    const msg = message ? ` -m ${JSON.stringify(message)}` : "";
    return this.queueShell(`git stash push${msg}`);
  }

  gitStashList(): string {
    return this.git.stashes();
  }
}
