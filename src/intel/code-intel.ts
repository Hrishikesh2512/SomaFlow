/**
 * Semantic code intelligence backed by the TypeScript Compiler API.
 *
 * Runs an in-process `ts.LanguageService` over the workspace — no external LSP
 * process to manage — giving the agent real go-to-definition, find-references,
 * type/hover info, workspace symbol search, and per-file diagnostics instead of
 * regex guesses. An optional overlay lets it see the executor's *staged* (not
 * yet written) edits, so the agent can check changes before applying them.
 */
import * as ts from "typescript";
import fs from "node:fs";
import path from "node:path";

/** Access to staged, not-yet-written file contents. All paths are absolute. */
export interface OverlayAccess {
  /** Effective staged text for a path, or undefined if not staged. */
  get(absPath: string): string | undefined;
  /** True if the path is staged for deletion. */
  isDeleted(absPath: string): boolean;
  /** Absolute paths of all staged (created or modified) files. */
  list(): string[];
}

export interface Location {
  file: string;
  line: number;
  col: number;
  text: string;
}

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  checkJs: false,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
};

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export class CodeIntel {
  private readonly root: string;
  private readonly overlay?: OverlayAccess;
  private readonly options: ts.CompilerOptions;
  private rootFiles: string[];
  private readonly service: ts.LanguageService;

  constructor(root: string, overlay?: OverlayAccess) {
    this.root = path.resolve(root);
    this.overlay = overlay;

    const { fileNames, options } = this.loadConfig();
    this.rootFiles = fileNames;
    this.options = options;

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => {
        const set = new Set(this.rootFiles.map((f) => path.resolve(f)));
        if (this.overlay) {
          for (const f of this.overlay.list()) set.add(path.resolve(f));
          for (const f of [...set]) if (this.overlay.isDeleted(f)) set.delete(f);
        }
        return [...set];
      },
      getScriptVersion: (fileName) => {
        const abs = path.resolve(fileName);
        if (this.overlay) {
          if (this.overlay.isDeleted(abs)) return "deleted";
          const o = this.overlay.get(abs);
          if (o !== undefined) return "ovl:" + hashStr(o);
        }
        try {
          const st = fs.statSync(abs);
          return `${st.mtimeMs}:${st.size}`;
        } catch {
          return "none";
        }
      },
      getScriptSnapshot: (fileName) => {
        const text = this.effectiveText(fileName);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => this.root,
      getCompilationSettings: () => this.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (f) => {
        const abs = path.resolve(f);
        if (this.overlay) {
          if (this.overlay.isDeleted(abs)) return false;
          if (this.overlay.get(abs) !== undefined) return true;
        }
        return ts.sys.fileExists(f);
      },
      readFile: (f) => this.effectiveText(f),
      readDirectory: ts.sys.readDirectory,
      getDirectories: ts.sys.getDirectories,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    };

    this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  private loadConfig(): { fileNames: string[]; options: ts.CompilerOptions } {
    const configPath = ts.findConfigFile(this.root, ts.sys.fileExists, "tsconfig.json");
    if (configPath) {
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        read.config ?? {},
        ts.sys,
        path.dirname(configPath),
      );
      if (parsed.fileNames.length > 0) {
        return { fileNames: parsed.fileNames, options: { ...DEFAULT_OPTIONS, ...parsed.options } };
      }
    }
    return { fileNames: this.scanFiles(), options: DEFAULT_OPTIONS };
  }

  private scanFiles(): string[] {
    const out: string[] = [];
    const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
    const skip = new Set(["node_modules", ".git", "dist", "build", ".next"]);
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".") && e.name !== ".") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!skip.has(e.name)) walk(full);
        } else if (exts.has(path.extname(e.name))) {
          out.push(full);
        }
      }
    };
    walk(this.root);
    return out;
  }

  private effectiveText(fileName: string): string | undefined {
    const abs = path.resolve(fileName);
    if (this.overlay) {
      if (this.overlay.isDeleted(abs)) return undefined;
      const o = this.overlay.get(abs);
      if (o !== undefined) return o;
    }
    try {
      if (!fs.statSync(abs).isFile()) return undefined;
      return fs.readFileSync(abs, "utf8");
    } catch {
      return undefined;
    }
  }

  private rel(fileName: string): string {
    return path.relative(this.root, fileName).split(path.sep).join("/");
  }

  /** True if a TS-normalized fileName lives inside the workspace (not node_modules/libs). */
  private inWorkspace(fileName: string): boolean {
    const rootFwd = this.root.split(path.sep).join("/").toLowerCase();
    const f = fileName.toLowerCase();
    return f.startsWith(rootFwd) && !f.includes("/node_modules/");
  }

  private locationAt(fileName: string, start: number): Location {
    const sf = this.service.getProgram()?.getSourceFile(fileName);
    if (!sf) return { file: this.rel(fileName), line: 0, col: 0, text: "" };
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const full = sf.getFullText();
    const lineStart = full.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = full.indexOf("\n", start);
    if (lineEnd === -1) lineEnd = full.length;
    return {
      file: this.rel(fileName),
      line: line + 1,
      col: character + 1,
      text: full.slice(lineStart, lineEnd).trim(),
    };
  }

  /** Best position (fileName + offset) of a symbol by name, for follow-up queries. */
  private resolveSymbolPosition(name: string, fromFile?: string): { fileName: string; offset: number } | undefined {
    const items = this.service.getNavigateToItems(name, 50, fromFile ? path.resolve(this.root, fromFile) : undefined);
    if (items.length === 0) return undefined;
    const exact = items.filter((i) => i.name === name);
    const pool = exact.length > 0 ? exact : items;
    const best = pool.find((i) => i.matchKind === "exact") ?? pool[0];
    if (!best) return undefined;

    // navigateTo often returns the span of the whole declaration, not the
    // identifier. Locate the identifier within the span so hover/quick-info
    // (which must sit on the name) resolves correctly.
    let offset = best.textSpan.start;
    if (best.textSpan.length !== name.length) {
      const sf = this.service.getProgram()?.getSourceFile(best.fileName);
      if (sf) {
        const slice = sf.getFullText().slice(best.textSpan.start, best.textSpan.start + best.textSpan.length);
        const m = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).exec(slice);
        if (m) offset = best.textSpan.start + m.index;
      }
    }
    return { fileName: best.fileName, offset };
  }

  /** Workspace symbol search by name (semantic). Returns declaration locations. */
  searchSymbol(name: string): string {
    const items = this.service.getNavigateToItems(name, 50);
    if (items.length === 0) return `No symbol named "${name}" found.`;
    const lines = items.map((i) => {
      const loc = this.locationAt(i.fileName, i.textSpan.start);
      const container = i.containerName ? ` in ${i.containerName}` : "";
      return `${loc.file}:${loc.line}: [${i.kind}] ${i.name}${container}`;
    });
    return [...new Set(lines)].join("\n");
  }

  findDefinition(name: string, fromFile?: string): string {
    const pos = this.resolveSymbolPosition(name, fromFile);
    if (!pos) return `No definition found for "${name}".`;
    const defs = this.service.getDefinitionAtPosition(pos.fileName, pos.offset);
    const targets =
      defs && defs.length > 0
        ? defs.map((d) => this.locationAt(d.fileName, d.textSpan.start))
        : [this.locationAt(pos.fileName, pos.offset)];
    return targets.map((l) => `${l.file}:${l.line}:${l.col}: ${l.text}`).join("\n");
  }

  findReferences(name: string, fromFile?: string): string {
    const pos = this.resolveSymbolPosition(name, fromFile);
    if (!pos) return `No symbol named "${name}" found.`;
    const refs = this.service.getReferencesAtPosition(pos.fileName, pos.offset);
    if (!refs || refs.length === 0) return `No references found for "${name}".`;
    const lines = refs.map((r) => {
      const loc = this.locationAt(r.fileName, r.textSpan.start);
      const tag = r.isWriteAccess ? " (write)" : "";
      return `${loc.file}:${loc.line}:${loc.col}: ${loc.text}${tag}`;
    });
    return `${refs.length} reference(s) to "${name}":\n` + lines.join("\n");
  }

  getType(name: string, fromFile?: string): string {
    const pos = this.resolveSymbolPosition(name, fromFile);
    if (!pos) return `No symbol named "${name}" found.`;
    // Quick info can be empty exactly at an identifier's start; nudge inside it.
    const info =
      this.service.getQuickInfoAtPosition(pos.fileName, pos.offset) ??
      this.service.getQuickInfoAtPosition(pos.fileName, pos.offset + 1);
    if (!info) return `No type information available for "${name}".`;
    const sig = ts.displayPartsToString(info.displayParts);
    const docs = ts.displayPartsToString(info.documentation);
    const loc = this.locationAt(pos.fileName, pos.offset);
    return `${loc.file}:${loc.line}\n${sig}${docs ? `\n\n${docs}` : ""}`;
  }

  getDiagnostics(file?: string): string {
    const program = this.service.getProgram();
    if (!program) return "Diagnostics unavailable (program failed to load).";
    const files = file
      ? [path.resolve(this.root, file)]
      : program.getSourceFiles().map((s) => s.fileName).filter((f) => this.inWorkspace(f));

    const out: string[] = [];
    for (const f of files) {
      const diags = [
        ...this.service.getSyntacticDiagnostics(f),
        ...this.service.getSemanticDiagnostics(f),
      ];
      for (const d of diags) {
        const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        const cat = ts.DiagnosticCategory[d.category];
        if (d.file && d.start !== undefined) {
          const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
          out.push(`${this.rel(d.file.fileName)}:${line + 1}:${character + 1}: ${cat} TS${d.code}: ${msg}`);
        } else {
          out.push(`${cat} TS${d.code}: ${msg}`);
        }
      }
    }
    return out.length === 0 ? "No diagnostics — clean." : out.join("\n");
  }
}
