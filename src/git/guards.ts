import type { GitClient } from "./client";

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/** Refuse to checkout if there are uncommitted changes */
export function guardCheckout(git: GitClient, branch: string): GuardResult {
  if (git.isDirty()) {
    return {
      ok: false,
      reason: `Working tree is dirty. Commit or stash your changes before checking out '${branch}'.`,
    };
  }
  return { ok: true };
}

/** Refuse to push if we're on a detached HEAD */
export function guardPush(git: GitClient): GuardResult {
  if (git.isDetachedHead()) {
    return {
      ok: false,
      reason: "You are in a detached HEAD state. Create or checkout a branch before pushing.",
    };
  }
  return { ok: true };
}

/** Warn before committing nothing */
export function guardCommit(git: GitClient): GuardResult {
  if (!git.isDirty()) {
    return {
      ok: false,
      reason: "Nothing to commit — working tree is clean.",
    };
  }
  return { ok: true };
}

/** Generic guard: block if command targets protected branches */
export function guardDestructive(branch: string): GuardResult {
  const protected_ = ["main", "master", "production", "prod", "release"];
  if (protected_.includes(branch.toLowerCase())) {
    return {
      ok: false,
      reason: `'${branch}' is a protected branch. Arthur will not perform destructive operations on it directly.`,
    };
  }
  return { ok: true };
}
