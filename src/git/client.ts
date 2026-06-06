import { spawnSync } from "node:child_process";
import * as path from "node:path";

export interface GitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitClient {
  constructor(private readonly cwd: string) {}

  run(args: string[]): GitResult {
    const r = spawnSync("git", args, {
      cwd: this.cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      success: r.status === 0,
      stdout: (r.stdout || "").trim(),
      stderr: (r.stderr || "").trim(),
      exitCode: r.status ?? 1,
    };
  }

  status(): string {
    const r = this.run(["status", "--short"]);
    return r.stdout || "(clean working tree)";
  }

  diff(file?: string): string {
    const args = file ? ["diff", file] : ["diff"];
    const r = this.run(args);
    if (!r.stdout) {
      // Try staged diff
      const staged = this.run(file ? ["diff", "--staged", file] : ["diff", "--staged"]);
      return staged.stdout || "(no diff — working tree is clean)";
    }
    return r.stdout;
  }

  log(n: number = 10): string {
    const r = this.run(["log", `--oneline`, `-${n}`]);
    return r.stdout || "(no commits yet)";
  }

  currentBranch(): string {
    const r = this.run(["rev-parse", "--abbrev-ref", "HEAD"]);
    return r.stdout || "unknown";
  }

  isDirty(): boolean {
    const r = this.run(["status", "--porcelain"]);
    return r.stdout.trim().length > 0;
  }

  hasUntracked(): boolean {
    const r = this.run(["ls-files", "--others", "--exclude-standard"]);
    return r.stdout.trim().length > 0;
  }

  isDetachedHead(): boolean {
    const r = this.run(["symbolic-ref", "--quiet", "HEAD"]);
    return !r.success;
  }

  remoteBranches(): string[] {
    const r = this.run(["branch", "-r"]);
    return r.stdout.split("\n").map((b) => b.trim()).filter(Boolean);
  }

  stashes(): string {
    const r = this.run(["stash", "list"]);
    return r.stdout || "(no stashes)";
  }
}

/** Derive the git root from a given workspace path */
export function getGitRoot(cwd: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim() : null;
}
