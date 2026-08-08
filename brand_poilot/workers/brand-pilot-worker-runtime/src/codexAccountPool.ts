import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type CodexAccountProfile = Readonly<{
  alias: string;
  home: string;
}>;

export type CodexAttemptFailure = Readonly<{
  error: Error;
  diagnostic: string;
  acceptedOutput: boolean;
}>;

export type CodexAttemptResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failure: CodexAttemptFailure }>;

export const success = <T>(value: T): CodexAttemptResult<T> => ({ ok: true, value });

export const failure = (
  error: Error,
  diagnostic: string,
  acceptedOutput: boolean,
): CodexAttemptResult<never> => ({
  ok: false,
  failure: { error, diagnostic, acceptedOutput },
});

export class CodexAccountsExhaustedError extends Error {
  constructor() {
    super("codex_accounts_exhausted");
    this.name = "CodexAccountsExhaustedError";
  }
}

export interface CodexAccountPool {
  readonly profiles: readonly CodexAccountProfile[];
  run<T>(attempt: (profile: CodexAccountProfile) => Promise<CodexAttemptResult<T>>): Promise<{
    profile: CodexAccountProfile;
    value: T;
  }>;
}

type AccountPoolDependencies = {
  now?: () => number;
};

const PROFILE_ALIAS = /^[a-z][a-z0-9-]{0,31}$/;
const FALLBACK_COOLDOWN_MS = 60 * 60_000;
const RESET_SAFETY_MARGIN_MS = 5 * 60_000;

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

async function validatedProfiles(root: string, aliases: readonly string[]): Promise<CodexAccountProfile[]> {
  if (aliases.length !== 2) throw new Error("codex_account_profile_count_invalid");
  for (const alias of aliases) {
    if (!PROFILE_ALIAS.test(alias)) throw new Error("codex_account_profile_invalid");
  }
  if (new Set(aliases).size !== aliases.length) throw new Error("codex_account_profile_duplicate");

  const rootPath = path.resolve(root);
  const rootStats = await lstat(rootPath).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("codex_account_pool_root_invalid");
  }
  const realRoot = await realpath(rootPath);
  if (!samePath(realRoot, rootPath)) throw new Error("codex_account_pool_root_invalid");

  return Promise.all(aliases.map(async (alias) => {
    const home = path.resolve(realRoot, alias);
    if (!samePath(path.dirname(home), realRoot)) throw new Error("codex_account_profile_invalid");
    const homeStats = await lstat(home).catch(() => null);
    if (homeStats?.isSymbolicLink()) throw new Error("codex_account_profile_symlink_forbidden");
    if (!homeStats?.isDirectory()) throw new Error("codex_account_profile_directory_invalid");
    if (!samePath(await realpath(home), home)) throw new Error("codex_account_profile_path_invalid");

    const authFile = path.join(home, "auth.json");
    const authStats = await lstat(authFile).catch(() => null);
    if (authStats?.isSymbolicLink()) throw new Error("codex_account_auth_symlink_forbidden");
    if (!authStats?.isFile()) throw new Error("codex_account_auth_file_invalid");
    if (!samePath(await realpath(authFile), authFile)) throw new Error("codex_account_auth_path_invalid");
    return Object.freeze({ alias, home });
  }));
}

function isUsageExhaustion(diagnostic: string): boolean {
  const normalized = diagnostic.toLowerCase();
  if (/rate[\s_-]+limit/.test(normalized)) return false;
  return /usage[\s_-]+limit/.test(normalized);
}

function parsedResetAt(diagnostic: string, now: number): number | null {
  const match = diagnostic.match(
    /(?:try\s+again\s+(?:after|at)|resets?\s+at|available\s+after|unavailable\s+until)\s+([^\r\n]+)/i,
  );
  if (!match?.[1]) return null;
  const value = Date.parse(match[1].trim().replace(/[.;]+$/, ""));
  return Number.isFinite(value) && value > now ? value : null;
}

function retryAt(diagnostic: string, now: number): number {
  const resetAt = parsedResetAt(diagnostic, now);
  return resetAt === null ? now + FALLBACK_COOLDOWN_MS : resetAt + RESET_SAFETY_MARGIN_MS;
}

export async function createCodexAccountPool({
  root,
  aliases,
  now = Date.now,
}: {
  root: string;
  aliases: readonly string[];
  now?: () => number;
}): Promise<CodexAccountPool> {
  const profiles = Object.freeze(await validatedProfiles(root, aliases));
  const cooldownUntil = new Map<string, number>();
  return {
    profiles,
    async run<T>(attempt: (profile: CodexAccountProfile) => Promise<CodexAttemptResult<T>>) {
      for (const profile of profiles) {
        if ((cooldownUntil.get(profile.alias) ?? 0) > now()) continue;
        const result = await attempt(profile);
        if (result.ok) return { profile, value: result.value };
        if (result.failure.acceptedOutput || !isUsageExhaustion(result.failure.diagnostic)) {
          throw result.failure.error;
        }
        cooldownUntil.set(profile.alias, retryAt(result.failure.diagnostic, now()));
      }
      throw new CodexAccountsExhaustedError();
    },
  };
}

export async function createCodexAccountPoolFromEnv(
  env: NodeJS.ProcessEnv,
  dependencies: AccountPoolDependencies = {},
): Promise<CodexAccountPool> {
  const root = env.CODEX_ACCOUNT_POOL_ROOT?.trim();
  if (!root) throw new Error("codex_account_pool_root_required");
  const aliases = env.CODEX_ACCOUNT_PROFILES?.split(",").map((value) => value.trim()) ?? [];
  if (aliases.length !== 2 || aliases[0] !== "primary" || aliases[1] !== "secondary") {
    throw new Error("codex_account_profiles_invalid");
  }
  return createCodexAccountPool({ root, aliases, now: dependencies.now });
}
