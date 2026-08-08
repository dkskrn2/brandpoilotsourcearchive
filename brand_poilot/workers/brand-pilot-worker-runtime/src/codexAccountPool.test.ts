import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createCodexAccountPool,
  createCodexAccountPoolFromEnv,
  failure,
  success,
} from "./codexAccountPool.js";

const roots: string[] = [];

async function accountRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "codex-account-pool-"));
  roots.push(root);
  for (const alias of ["primary", "secondary"]) {
    const home = path.join(root, alias);
    await mkdir(home);
    await writeFile(path.join(home, "auth.json"), "{}", { mode: 0o600 });
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex account pool", () => {
  it("selects primary first", async () => {
    const pool = await createCodexAccountPool({
      root: await accountRoot(),
      aliases: ["primary", "secondary"],
    });
    const attempted: string[] = [];

    const result = await pool.run(async (profile) => {
      attempted.push(profile.alias);
      return success("ok");
    });

    expect(attempted).toEqual(["primary"]);
    expect(result.profile.alias).toBe("primary");
    expect(result.value).toBe("ok");
  });

  it("fails over once after usage exhaustion without accepted output", async () => {
    const pool = await createCodexAccountPool({
      root: await accountRoot(),
      aliases: ["primary", "secondary"],
    });
    const attempted: string[] = [];

    const result = await pool.run(async (profile) => {
      attempted.push(profile.alias);
      return profile.alias === "primary"
        ? failure(new Error("primary failed"), "You've hit your usage limit", false)
        : success("ok");
    });

    expect(attempted).toEqual(["primary", "secondary"]);
    expect(result).toMatchObject({ profile: { alias: "secondary" }, value: "ok" });
  });

  it("does not fail over after an accepted final output", async () => {
    const pool = await createCodexAccountPool({
      root: await accountRoot(),
      aliases: ["primary", "secondary"],
    });
    const attempted: string[] = [];
    const original = new Error("primary failed after output");

    await expect(pool.run(async (profile) => {
      attempted.push(profile.alias);
      return failure(original, "You've hit your usage limit", true);
    })).rejects.toBe(original);

    expect(attempted).toEqual(["primary"]);
  });

  it.each(["rate limit", "spawn failed", "timeout", "schema invalid"])(
    "does not fail over for %s",
    async (diagnostic) => {
      const pool = await createCodexAccountPool({
        root: await accountRoot(),
        aliases: ["primary", "secondary"],
      });
      const attempted: string[] = [];

      await expect(pool.run(async (profile) => {
        attempted.push(profile.alias);
        return failure(new Error(diagnostic), diagnostic, false);
      })).rejects.toThrow(diagnostic);

      expect(attempted).toEqual(["primary"]);
    },
  );

  it("uses reset time plus five minutes as cooldown", async () => {
    let clock = Date.parse("2026-08-08T00:00:00Z");
    const pool = await createCodexAccountPool({
      root: await accountRoot(),
      aliases: ["primary", "secondary"],
      now: () => clock,
    });
    const attempted: string[] = [];
    const execute = () => pool.run(async (profile) => {
      attempted.push(profile.alias);
      return profile.alias === "primary"
        ? failure(new Error("limit"), "usage limit; try again after 2026-08-08T01:00:00Z", false)
        : success("ok");
    });

    await execute();
    attempted.length = 0;
    clock = Date.parse("2026-08-08T01:04:59Z");
    await execute();
    expect(attempted).toEqual(["secondary"]);

    attempted.length = 0;
    clock = Date.parse("2026-08-08T01:05:00Z");
    await execute();
    expect(attempted).toEqual(["primary", "secondary"]);
  });

  it("uses one hour when reset time is absent", async () => {
    let clock = 10_000;
    const pool = await createCodexAccountPool({
      root: await accountRoot(),
      aliases: ["primary", "secondary"],
      now: () => clock,
    });
    const attempted: string[] = [];
    const execute = () => pool.run(async (profile) => {
      attempted.push(profile.alias);
      return profile.alias === "primary"
        ? failure(new Error("limit"), "usage limit", false)
        : success("ok");
    });

    await execute();
    attempted.length = 0;
    clock += 3_599_999;
    await execute();
    expect(attempted).toEqual(["secondary"]);

    attempted.length = 0;
    clock += 1;
    await execute();
    expect(attempted).toEqual(["primary", "secondary"]);
  });

  it("returns codex_accounts_exhausted after both profiles exhaust", async () => {
    const pool = await createCodexAccountPool({
      root: await accountRoot(),
      aliases: ["primary", "secondary"],
    });
    const attempted: string[] = [];

    await expect(pool.run(async (profile) => {
      attempted.push(profile.alias);
      return failure(new Error("limit"), "usage limit", false);
    })).rejects.toThrow("codex_accounts_exhausted");

    expect(attempted).toEqual(["primary", "secondary"]);
  });

  it.each(["../secondary", "PRIMARY", "primary/child", ""])(
    "rejects invalid alias %s",
    async (alias) => {
      await expect(createCodexAccountPool({
        root: await accountRoot(),
        aliases: ["primary", alias],
      })).rejects.toThrow("codex_account_profile_invalid");
    },
  );

  it("rejects duplicate aliases", async () => {
    await expect(createCodexAccountPool({
      root: await accountRoot(),
      aliases: ["primary", "primary"],
    })).rejects.toThrow("codex_account_profile_duplicate");
  });

  it("rejects a symlinked profile", async () => {
    const root = await accountRoot();
    const external = await mkdtemp(path.join(tmpdir(), "codex-account-external-"));
    roots.push(external);
    await writeFile(path.join(external, "auth.json"), "{}", { mode: 0o600 });
    await rm(path.join(root, "secondary"), { recursive: true });
    await symlink(
      external,
      path.join(root, "secondary"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(createCodexAccountPool({
      root,
      aliases: ["primary", "secondary"],
    })).rejects.toThrow("codex_account_profile_symlink_forbidden");
  });

  it("requires the exact production profile order from env", async () => {
    const root = await accountRoot();

    await expect(createCodexAccountPoolFromEnv({
      CODEX_ACCOUNT_POOL_ROOT: root,
      CODEX_ACCOUNT_PROFILES: "secondary,primary",
    })).rejects.toThrow("codex_account_profiles_invalid");

    await expect(createCodexAccountPoolFromEnv({
      CODEX_ACCOUNT_POOL_ROOT: root,
      CODEX_ACCOUNT_PROFILES: "primary,secondary",
    })).resolves.toMatchObject({
      profiles: [
        { alias: "primary", home: path.join(root, "primary") },
        { alias: "secondary", home: path.join(root, "secondary") },
      ],
    });
  });
});
