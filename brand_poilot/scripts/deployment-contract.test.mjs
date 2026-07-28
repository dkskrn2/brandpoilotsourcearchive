import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const publishWorkflowPath = "../.github/workflows/publish-brand-pilot-server-images.yml";
const ubuntuRunbookPath = "docs/operations/UBUNTU_DEPLOYMENT.md";
const oauthCutoverRunbookPath = "docs/operations/OAUTH_CUTOVER.md";
const previewAuthRunbookPath = "docs/operations/VERCEL_PREVIEW_AUTH.md";
const ubuntuBootstrapPath = "deploy/scripts/bootstrap-ubuntu.sh";
const deploymentArtifacts = [
  ".dockerignore",
  "apps/api/Dockerfile",
  "workers/brand-pilot-dm-worker/Dockerfile",
  "workers/brand-pilot-content-proposal-worker/Dockerfile",
  "deploy/compose.production.yml",
  "deploy/Caddyfile",
  "deploy/Caddyfile.canary",
  "deploy/release.env.example",
  "deploy/env/api.env.example",
  "deploy/env/dm-worker.env.example",
  "deploy/env/wiki-worker.env.example",
  "deploy/env/content-proposal-worker.env.example",
  "deploy/scripts/preflight.sh",
  "deploy/scripts/deploy.sh",
  "deploy/scripts/lib.sh",
  "deploy/scripts/verify-canary.sh",
  "deploy/scripts/promote.sh",
  "deploy/scripts/rollback.sh",
  "deploy/scripts/backup-state.sh",
  "deploy/scripts/restore-state.sh",
  ubuntuRunbookPath,
  oauthCutoverRunbookPath,
  ubuntuBootstrapPath,
];

const deploymentScripts = [
  "deploy/scripts/lib.sh",
  "deploy/scripts/preflight.sh",
  "deploy/scripts/deploy.sh",
  "deploy/scripts/verify-canary.sh",
  "deploy/scripts/promote.sh",
  "deploy/scripts/rollback.sh",
  "deploy/scripts/backup-state.sh",
  "deploy/scripts/restore-state.sh",
  ubuntuBootstrapPath,
];

test("Task 10 canary is read-only, authenticated, and proves safe feature flags", () => {
  const verify = read("deploy/scripts/verify-canary.sh");
  for (const marker of [
    "/health",
    "/ready",
    "cors_allowed",
    "cors_denied",
    "secure_cookie",
    "/auth/meta/dev-complete",
    "/auth/me",
    "/brand-core",
    "/product-services",
    "/wiki/status",
    "/ai-content/usage",
    "/channels/capabilities",
    "features.scheduler",
    "features.publishing",
    "features.dm",
    "CANARY_SESSION_COOKIE_FILE",
    "CANARY_BRAND_ID",
  ]) {
    assert.ok(verify.includes(marker), `canary verifier missing ${marker}`);
  }
  assert.match(verify, /require_file_mode_600/);
  assert.match(verify, /Secure/);
  assert.match(verify, /HttpOnly/);
  assert.match(verify, /SameSite=Lax/);
  assert.doesNotMatch(verify, /--request\s+(?:POST|PUT|PATCH|DELETE)|\s-X\s*(?:POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(
    verify,
    /--request\s+(?:POST|PUT|PATCH|DELETE)|\/(?:generate|download|publish|send-message|reply)(?:[/?"]|$)/i,
  );
});

test("Task 10 backup metadata excludes secret plaintext and binds promotion state", () => {
  const backup = read("deploy/scripts/backup-state.sh");
  const promote = read("deploy/scripts/promote.sh");
  for (const marker of [
    "PROVIDER_BACKUP_ID",
    "CADDY_BACKUP_ID",
    "CADDY_DATA_SHA256",
    "CURRENT_RELEASE_SHA",
    "CURRENT_IMAGE_DIGEST",
    "RELEASE_MANIFEST_SHA256",
    "EXTERNAL_ENV_SHA256",
  ]) {
    assert.ok(backup.includes(marker), `backup metadata missing ${marker}`);
  }
  assert.match(backup, /flock -n 9/);
  assert.match(backup, /reconcile_transition_or_fail/);
  assert.doesNotMatch(backup, /\b(?:cp|tar|zip|rsync)\b[^\n]*(?:api\.env|env\/|caddy\/data)/i);
  assert.doesNotMatch(backup, /(?:DATABASE_URL|CREDENTIAL_ENCRYPTION_KEY|CLIENT_SECRET|ACCESS_TOKEN)=/);
  assert.match(promote, /PROMOTION_BACKUP_METADATA/);
  assert.match(promote, /validate_promotion_backup_metadata/);
  assert.match(promote, /CURRENT_RELEASE_SHA/);
  assert.match(promote, /CURRENT_IMAGE_DIGEST/);
});

test("Task 10 restore is test-database-only and verifies schema and row counts", () => {
  const restore = read("deploy/scripts/restore-state.sh");
  for (const marker of [
    "--test-database-url-file",
    "--backup-metadata",
    "--expected-schema-version",
    "--row-count-manifest",
    "RESTORE_REHEARSAL_TEST_ONLY",
    "restore_target_database_must_be_test_only",
    "schema_version_mismatch",
    "row_count_mismatch",
    "provider_backup_id",
  ]) {
    assert.ok(restore.includes(marker), `restore contract missing ${marker}`);
  }
  assert.match(restore, /require_file_mode_600/);
  assert.match(restore, /flock -n 9/);
  assert.doesNotMatch(restore, /\beval\b|\bsource\b[^\n]*(?:DATABASE|ENV|metadata)/i);
});

test("Task 10 rollback uses immutable prior digest and documents immediate triggers", () => {
  const rollback = read("deploy/scripts/rollback.sh");
  const runbook = read(ubuntuRunbookPath);
  assert.match(rollback, /OCI_REVISION/);
  assert.match(rollback, /@sha256:/);
  assert.match(rollback, /API_ENV_FILE/);
  assert.match(rollback, /rollback_external_env_mismatch/);
  for (const phrase of [
    "OAuth repeated failure",
    "credential decryption failure",
    "duplicate DM or publish",
    "API interruption longer than 5 minutes",
    "migration mismatch",
    "never runs paid AI generation",
    "never sends a real DM",
    "never publishes to a real SNS channel",
  ]) {
    assert.ok(runbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
});

function indentation(line) {
  return line.match(/^ */)[0].length;
}

function parseComposeServices(compose) {
  const lines = compose.split(/\r?\n/);
  const servicesIndex = lines.findIndex((line) => /^services:\s*(?:#.*)?$/.test(line));
  assert.notEqual(servicesIndex, -1, "compose services marker is missing");

  const servicesIndent = indentation(lines[servicesIndex]);
  const sectionEnd = lines.findIndex((line, index) => (
    index > servicesIndex
    && line.trim()
    && !line.trimStart().startsWith("#")
    && indentation(line) <= servicesIndent
  ));
  const end = sectionEnd === -1 ? lines.length : sectionEnd;
  const candidates = lines
    .map((line, index) => ({ line, index, indent: indentation(line) }))
    .slice(servicesIndex + 1, end)
    .filter(({ line, indent }) => (
      indent > servicesIndent
      && /^ *[A-Za-z0-9_.-]+:\s*(?:#.*)?$/.test(line)
    ));
  assert.ok(candidates.length, "compose services block has no service markers");

  const serviceIndent = Math.min(...candidates.map(({ indent }) => indent));
  const markers = candidates.filter(({ indent }) => indent === serviceIndent);
  const services = new Map();
  for (const [position, marker] of markers.entries()) {
    const name = marker.line.trim().split(":", 1)[0];
    const next = markers[position + 1]?.index ?? end;
    services.set(name, {
      indent: serviceIndent,
      text: lines.slice(marker.index, next).join("\n"),
    });
  }
  return services;
}

function parseServiceList(block, key) {
  const lines = block.text.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => (
    indentation(line) > block.indent
    && new RegExp(`^ *${key}:\\s*(?:#.*)?$`).test(line)
  ));
  if (markerIndex === -1) return [];

  const markerIndent = indentation(lines[markerIndex]);
  const values = [];
  for (const line of lines.slice(markerIndex + 1)) {
    if (line.trim() && indentation(line) <= markerIndent) break;
    const item = line.match(/^ *-\s+(.+?)\s*$/);
    if (item) values.push(item[1]);
  }
  return values;
}

function parseWorkflowJob(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(markerIndex, -1, `workflow job ${name} is missing`);
  const nextJobIndex = lines.findIndex((line, index) => (
    index > markerIndex && /^ {2}[A-Za-z0-9_-]+:$/.test(line)
  ));
  return lines.slice(markerIndex, nextJobIndex === -1 ? lines.length : nextJobIndex).join("\n");
}

function assertComposeTopology(compose) {
  const services = parseComposeServices(compose);
  assert.ok(services.has("api-primary"), "compose api-primary service marker is missing");
  assert.ok(services.has("api-canary"), "compose api-canary service marker is missing");
  assert.ok(services.has("caddy"), "compose caddy service marker is missing");
  for (const [name, block] of services) {
    if (name === "caddy") continue;
    const hasPorts = block.text.split(/\r?\n/).slice(1).some((line) => (
      indentation(line) > block.indent
      && /^ *ports\s*:/.test(line)
    ));
    assert.equal(hasPorts, false, `${name} service must not define host ports`);
  }
  return services;
}

function hasCaddyLogDirective(caddy) {
  return caddy.split(/\r?\n/).some((line) => {
    const directive = line.trim();
    return Boolean(directive) && !directive.startsWith("#") && /^log(?:\s|$)/.test(directive);
  });
}

function hasShellTracing(script) {
  return script.split(/\r?\n/).some((rawLine) => {
    const line = rawLine.trim();
    if (!line) return false;
    if (line.startsWith("#!")) {
      const tokens = line.split(/\s+/);
      const shellIndex = tokens.findIndex((token) => /(?:^|\/)(?:ba)?sh$/.test(token));
      return shellIndex !== -1 && tokens.slice(shellIndex + 1).some(
        (token) => /^-[A-Za-z]*x[A-Za-z]*$/.test(token) || token === "--xtrace",
      );
    }
    if (line.startsWith("#")) return false;
    const command = line.replace(/\s+#.*$/, "");
    if (/^set\s+-[A-Za-z]*x[A-Za-z]*(?=\s|;|&&|\|\||$)/.test(command)) return true;
    if (/^set\b[^;&|]*(?:^|\s)-o\s+xtrace(?=\s|;|&&|\|\||$)/.test(command)) return true;
    return /^(?:(?:exec|command|sudo)\s+)*(?:env(?:\s+\S+)*\s+)?(?:\S*\/)?bash\s+(?:-[A-Za-z]*x[A-Za-z]*|--xtrace)(?=\s|;|&&|\|\||$)/.test(command);
  });
}

test("production deployment artifacts exist", () => {
  const missing = deploymentArtifacts.filter((path) => !existsSync(path));
  assert.equal(
    missing.length,
    0,
    `missing deployment artifacts:\n${missing.map((path) => `- ${path}`).join("\n")}`,
  );
});

test("preview auth runbook uses one stable origin and an opaque OAuth destination", () => {
  assert.equal(existsSync(previewAuthRunbookPath), true, "preview auth runbook is missing");
  const runbook = read(previewAuthRunbookPath);
  for (const phrase of [
    "https://staging-app.danbammsg.co.kr",
    "AUTH_PREVIEW_FRONTEND_URL=https://staging-app.danbammsg.co.kr",
    "VITE_API_BASE_URL=https://api.danbammsg.co.kr",
    "VITE_AUTH_DESTINATION=preview",
    "destination=preview",
    "CORS_ALLOWED_ORIGINS=https://app.danbammsg.co.kr,https://www.danbammsg.co.kr,https://staging-app.danbammsg.co.kr",
    "Do not use a generated `*.vercel.app` URL",
    "Do not attach the stable alias to an unreviewed pull request",
    "No Ubuntu host or Vercel project is changed by this repository commit",
  ]) {
    assert.ok(runbook.includes(phrase), `preview auth runbook missing: ${phrase}`);
  }
});

test("Ubuntu runbook fixes the API-only scope and stable public integration URLs", () => {
  const runbook = read(ubuntuRunbookPath);
  for (const phrase of [
    "API + Caddy only",
    "no external customers",
    "Vercel API",
    "48 hours",
    "LM Studio",
    "Tailscale",
    "private SSH",
    "never public ingress",
    "VITE_API_BASE_URL=https://api.danbammsg.co.kr",
    "https://api.danbammsg.co.kr/auth/kakao/callback",
    "https://api.danbammsg.co.kr/auth/meta/callback",
    "https://api.danbammsg.co.kr/auth/meta/trends/callback",
    "https://api.danbammsg.co.kr/webhooks/meta/instagram",
    "CREDENTIAL_ENCRYPTION_KEY",
    "no blanket key reissue",
    "Do not copy",
  ]) {
    assert.ok(runbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
  assert.match(runbook, /no\s+db:migrate/i);
  assert.match(runbook, /worker.*scheduler.*publication/i);
  assert.match(runbook, /rotate only.*exposed.*revoked.*provider-required/i);
});

test("Ubuntu runbook provides private SSH, firewall, Docker, and network prerequisite commands", () => {
  const runbook = read(ubuntuRunbookPath);
  for (const command of [
    "curl -fsSL https://tailscale.com/install.sh | sh",
    "sudo tailscale up --hostname=brand-pilot-ubuntu",
    "sudo adduser --disabled-password --gecos \"\" bpdeploy",
    "ssh-keygen -t ed25519 -a 100",
    "PermitRootLogin no",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "PubkeyAuthentication yes",
    "AllowUsers bpdeploy",
    "sudo sshd -t",
    "sudo systemctl reload ssh",
    "sudo ufw allow in on tailscale0 to any port 22 proto tcp",
    "sudo ufw allow 80/tcp",
    "sudo ufw allow 443/tcp",
    "https://download.docker.com/linux/ubuntu/gpg",
    "docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
    "docker run --rm hello-world",
    "sudo ./deploy/scripts/bootstrap-ubuntu.sh",
  ]) {
    assert.ok(runbook.includes(command), `Ubuntu runbook missing command: ${command}`);
  }
  for (const phrase of [
    "Ubuntu 24.04",
    "amd64",
    "static LAN IP",
    "CGNAT",
    "dynamic public IP",
    "DDNS",
    "ACME",
    "never forward TCP 22",
    "root-equivalent",
    "new SSH session",
    "host fingerprint",
    "authorized_keys",
    "No exit node",
    "No Funnel",
    "router forwards only TCP 80/443",
  ]) {
    assert.ok(runbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
  assert.match(runbook, /ssh -i .*brand-pilot-ubuntu.*bpdeploy@<TAILSCALE_IP_OR_NAME>/);
});

test("Ubuntu runbook separates the Tailscale management plane from public DNS and ingress", () => {
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");
  const deploymentBoundary = [
    runbook,
    read("deploy/compose.production.yml"),
    read("deploy/Caddyfile"),
    read("deploy/Caddyfile.canary"),
    ...deploymentScripts.map(read),
  ].join("\n");

  for (const phrase of [
    "management plane only",
    "`brand-pilot-dev-windows`",
    "`brand-pilot-ubuntu`",
    "`tailscale status`",
    "Do not hard-code Tailscale IP addresses",
    "public OAuth and webhook DNS must never resolve to a Tailscale IP",
    "`api.danbammsg.co.kr` and `canary-api.danbammsg.co.kr`",
    "public Ubuntu IPv4",
    "working public Ubuntu IPv6",
    "`app.danbammsg.co.kr` remains a Vercel custom domain",
    "never TCP 22, 4000, or 5432",
    "port 4000 is Docker-internal `expose` only",
    "Before public DNS propagation",
    "After public DNS propagation",
  ]) {
    assert.ok(
      normalizedRunbook.includes(phrase),
      `Ubuntu runbook missing network boundary detail: ${phrase}`,
    );
  }

  for (const command of [
    "tailscale status",
    "sudo ufw allow in on tailscale0 to any port 22 proto tcp",
    "sudo ufw deny 22/tcp",
    "sudo ufw deny 4000/tcp",
    "sudo ufw deny 5432/tcp",
    "curl --resolve canary-api.danbammsg.co.kr:443:<PUBLIC_IPV4>",
    "curl --fail https://canary-api.danbammsg.co.kr/health",
    "curl --fail https://canary-api.danbammsg.co.kr/ready",
  ]) {
    assert.ok(runbook.includes(command), `Ubuntu runbook missing network command: ${command}`);
  }
  assert.doesNotMatch(
    deploymentBoundary,
    /100\.90\.110\.88|100\.106\.196\.48/,
    "deployment docs and automation must not pin current Tailscale addresses",
  );
});

test("Ubuntu runbook is command-ready for env, artifact integrity, canary, rollback, and cutover", () => {
  const runbook = read(ubuntuRunbookPath);
  for (const phrase of [
    "/opt/brand-pilot/shared/env/api.env",
    "chmod 600",
    "DB_POOL_MAX=3",
    "DB_SSL_CA_BASE64",
    "LOCAL_SCHEDULER_ENABLED=false",
    "INSTAGRAM_PUBLISH_ENABLED=false",
    "least privilege",
    "GHCR",
    "exact commit",
    "exact SHA",
    "release.env.sha256",
    "release-integrity.sha256",
    "API_IMAGE",
    "CADDY_IMAGE",
    "canary-api.danbammsg.co.kr",
    "TTL 300",
    "api-primary",
    "api-canary",
    "caddy",
    "state/candidate",
    "state/previous",
    "1.1.1.1",
    "8.8.8.8",
    "60 minutes",
    "scheduler",
    "publication",
    "no database migration",
    "future worker plan",
  ]) {
    assert.ok(runbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
  for (const command of [
    "./scripts/deploy.sh /opt/brand-pilot/incoming/release.env --phase canary",
    "./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr",
    "./scripts/rollback.sh --release \"$candidate_sha\" --phase canary",
    "./scripts/promote.sh --prepare",
    "./scripts/promote.sh --commit --dns-cutover-confirmed",
    "./scripts/rollback.sh --previous --phase production",
    "curl --fail https://canary-api.danbammsg.co.kr/health",
    "curl --fail https://canary-api.danbammsg.co.kr/ready",
    "docker compose",
    "config --quiet",
  ]) {
    assert.ok(runbook.includes(command), `Ubuntu runbook missing command: ${command}`);
  }
  assert.doesNotMatch(runbook, /docker compose config(?!\s+--quiet)/);
});

test("Ubuntu runbook documents the fail-closed first TLS cutover and recovery sequence", () => {
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");

  for (const phrase of [
    "Caddyfile.canary",
    "does not request a certificate for `api.danbammsg.co.kr`",
    "`--prepare` starts and health-checks `api-primary`",
    "does not change Caddy, poll an external URL, or mutate",
    "`--commit` without `--dns-cutover-confirmed` fails before Docker",
    "waits for the primary TLS `/ready` response before",
    "restores the canary-only Caddy configuration",
  ]) {
    assert.ok(
      normalizedRunbook.includes(phrase),
      `Ubuntu runbook missing cutover detail: ${phrase}`,
    );
  }

  const prepareIndex = runbook.indexOf("./scripts/promote.sh --prepare");
  const firstResolverIndex = runbook.indexOf("dig +short api.danbammsg.co.kr @1.1.1.1");
  const secondResolverIndex = runbook.indexOf("dig +short api.danbammsg.co.kr @8.8.8.8");
  const commitIndex = runbook.indexOf(
    "./scripts/promote.sh --commit --dns-cutover-confirmed",
  );
  assert.ok(prepareIndex >= 0, "runbook must prepare the primary");
  assert.ok(firstResolverIndex > prepareIndex, "DNS must change after primary prewarm");
  assert.ok(secondResolverIndex > firstResolverIndex, "both public resolvers must be checked");
  assert.ok(commitIndex > secondResolverIndex, "confirmed commit must follow resolver checks");

  assert.match(
    runbook,
    /After reconnecting over Tailscale:\s*```bash\s*cd \/opt\/brand-pilot\/repo\/brand_poilot\/deploy/,
  );
  assert.ok(
    normalizedRunbook.includes(
      "On the trusted operator machine, use Git Bash or WSL for these POSIX commands:",
    ),
    "artifact commands must name the required Windows shell",
  );
  assert.match(runbook, /sudo rm -f \/tmp\/bootstrap-ubuntu\.sh/);
  assert.doesNotMatch(runbook, /(?<!sudo )rm -f \/tmp\/bootstrap-ubuntu\.sh/);
});

test("Ubuntu runbook documents candidate-bound offline preparation and transactional commit", () => {
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");

  for (const phrase of [
    "`--prepare` pulls and preloads both `api-primary` and `caddy`",
    "`org.opencontainers.image.revision`",
    "`--network none`",
    "`state/prepared`",
    "`RELEASE_SHA`",
    "`API_IMAGE` and `CADDY_IMAGE` digests",
    "`release-integrity.sha256`",
    "`CANARY_HOST` and `PRIMARY_HOST` must be different",
    "`--commit --dns-cutover-confirmed` requires a valid candidate-bound `state/prepared` proof",
    "`--pull never`",
    "does not contact the registry",
    "external primary TLS `/ready`",
    "transactionally",
    "`error=recovery_failed`",
    "restored endpoint does not pass readiness",
  ]) {
    assert.ok(
      normalizedRunbook.includes(phrase),
      `Ubuntu runbook missing offline promotion detail: ${phrase}`,
    );
  }
});

test("Ubuntu runbook documents durable transition recovery and host invariants", () => {
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");

  for (const phrase of [
    "`deploy.sh`, `preflight.sh`, `promote.sh`, and `rollback.sh`",
    "acquire `state/deploy.lock` before",
    "`state/transition.journal`",
    "`state/current`, `state/candidate`, `state/previous`, and `state/prepared`",
    "first promotion recovery restores `Caddyfile.canary` and removes `api-primary`",
    "mode 600",
    "leaves `state/transition.journal` in place",
    "`error=recovery_failed` and exits with status 70",
    "must not delete `state/transition.journal` manually",
    "`CANARY_HOST` and `PRIMARY_HOST` must each match between the current and candidate releases",
    "`state/prepared` is never restored from the journal",
    "removes `state/prepared` fail-closed",
    "rerun `./scripts/promote.sh --prepare` before commit",
    "Canary rollback also invalidates `state/prepared`",
    "every locked entrypoint reports `error=recovery_failed` and exits with status 70",
    "`deploy.sh`, `promote.sh`, `rollback.sh`, and journal reconciliation enforce the same host pair",
    "Production rollback requires an existing current or candidate runtime state",
  ]) {
    assert.ok(
      normalizedRunbook.includes(phrase),
      `Ubuntu runbook missing transition recovery detail: ${phrase}`,
    );
  }

  assert.match(
    runbook,
    /\.\/scripts\/preflight\.sh "\/opt\/brand-pilot\/releases\/<VERIFIED_RELEASE_SHA>\/release\.env"/,
  );
  assert.match(
    runbook,
    /stat -c '%U %a %n' \/opt\/brand-pilot\/state\/transition\.journal/,
  );
  assert.doesNotMatch(
    normalizedRunbook,
    /restores the journaled `state\/current`, `state\/candidate`, `state\/previous`, and `state\/prepared` snapshot/,
  );
});

test("Ubuntu runbook separates administrator and bpdeploy permissions and protects incoming artifacts", () => {
  const runbook = read(ubuntuRunbookPath);
  const bpdeployHeadings = [...runbook.matchAll(/^#{2,4} \[bpdeploy Tailscale SSH\].*$/gm)];
  const administratorHeadings = [
    ...runbook.matchAll(/^#{2,4} \[Ubuntu 관리자 콘솔\/기존 sudo 관리자\].*$/gm),
  ];
  assert.ok(bpdeployHeadings.length >= 4, "expected explicit bpdeploy operator sections");
  assert.ok(administratorHeadings.length >= 4, "expected explicit administrator sections");
  assert.match(runbook, /bpdeploy has no sudo by design/i);
  assert.match(runbook, /do not grant.*broad sudo/i);

  const headingPattern = /^#{2,4} /gm;
  for (const heading of bpdeployHeadings) {
    headingPattern.lastIndex = heading.index + heading[0].length;
    const nextHeading = headingPattern.exec(runbook);
    const block = runbook.slice(heading.index, nextHeading?.index ?? runbook.length);
    assert.doesNotMatch(
      block,
      /\bsudo(?:edit)?\b/,
      `bpdeploy section must not contain sudo: ${heading[0]}`,
    );
  }

  const envHeading = bpdeployHeadings.find((heading) => heading[0].includes("api.env"));
  assert.ok(envHeading, "expected a bpdeploy api.env section");
  headingPattern.lastIndex = envHeading.index + envHeading[0].length;
  const nextEnvHeading = headingPattern.exec(runbook);
  const envBlock = runbook.slice(envHeading.index, nextEnvHeading?.index ?? runbook.length);
  assert.match(envBlock, /install -m 0600[^]*api\.env\.example[^]*api\.env/);
  assert.match(envBlock, /\bchmod 600 [^\n]*api\.env/);
  assert.match(envBlock, /\bstat -c [^\n]*api\.env/);
  assert.doesNotMatch(envBlock, /\bchown\b/);

  const artifactHeading = bpdeployHeadings.find((heading) =>
    heading[0].includes("release artifact"),
  );
  assert.ok(artifactHeading, "expected a bpdeploy release artifact section");
  headingPattern.lastIndex = artifactHeading.index + artifactHeading[0].length;
  const nextArtifactHeading = headingPattern.exec(runbook);
  const artifactBlock = runbook.slice(
    artifactHeading.index,
    nextArtifactHeading?.index ?? runbook.length,
  );
  const chmodCommand =
    "chmod 600 /opt/brand-pilot/incoming/release.env /opt/brand-pilot/incoming/release.env.sha256";
  const statCommand = "stat -c '%U %a %n'";
  assert.ok(artifactBlock.includes(chmodCommand), "incoming artifacts must become mode 600");
  assert.ok(artifactBlock.includes(statCommand), "incoming artifact owner/mode must be shown");
  assert.match(artifactBlock, /bpdeploy 600/);
  assert.ok(
    artifactBlock.indexOf(chmodCommand) < artifactBlock.indexOf(statCommand) &&
      artifactBlock.indexOf(statCommand) < artifactBlock.indexOf("sha256sum --check"),
    "chmod and owner/mode verification must precede checksum verification",
  );
});

test("Ubuntu bootstrap is strict, root-only, idempotent, and creates safe owned paths", () => {
  const script = read(ubuntuBootstrapPath);
  assert.match(script, /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail\n/);
  assert.equal(hasShellTracing(script), false);
  assert.match(script, /\bEUID\b[\s\S]*root_required/);
  assert.match(script, /\/etc\/os-release/);
  assert.match(script, /VERSION_ID[\s\S]*24\\?\.04|24\\?\.04[\s\S]*VERSION_ID/);
  assert.match(script, /dpkg --print-architecture[\s\S]*amd64/);
  assert.match(script, /id -u bpdeploy/);
  assert.match(script, /ROOT="\/opt\/brand-pilot"/);
  assert.match(script, /realpath -m/);
  assert.match(script, /-L/);
  for (const path of ["repo", "incoming", "releases"]) {
    assert.match(script, new RegExp(`install -d -m 0750[^\\n]*\\$ROOT/${path}`));
  }
  for (const path of ["state", "shared", "shared/env"]) {
    assert.match(script, new RegExp(`install -d -m 0700[^\\n]*\\$ROOT/${path}`));
  }
  assert.match(script, /-o bpdeploy -g bpdeploy/);
  assert.doesNotMatch(script, /\b(?:touch|cat|printf)\b[^\n]*(?:api\.env|secret|credential)/i);
  const bash = findBash();
  assert.ok(bash, "Bash is required for Ubuntu bootstrap syntax validation");
  const syntax = spawnSync(bash, ["-n", ubuntuBootstrapPath], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("only Caddy publishes host ports", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const primaryBlock = services.get("api-primary").text;
  const canaryBlock = services.get("api-canary").text;
  const caddyBlock = services.get("caddy").text;
  for (const apiBlock of [primaryBlock, canaryBlock]) {
    assert.match(apiBlock, /LOCAL_SCHEDULER_ENABLED:\s*"false"/);
    assert.match(apiBlock, /INSTAGRAM_PUBLISH_ENABLED:\s*"false"/);
    assert.match(apiBlock, /^ {4}expose:\s*\r?\n {6}- "4000"$/m);
  }
  for (const [name, service] of services) {
    if (!/^(?:dm-worker|wiki-worker)/.test(name)) continue;
    assert.match(
      service.text,
      /^\s{4}profiles:/m,
      `first-deploy topology must keep ${name} behind an explicit profile`,
    );
  }
  assert.match(
    primaryBlock,
    /\$\{PRIMARY_API_IMAGE:-\$\{API_IMAGE:\?API_IMAGE is required\}\}/,
  );
  assert.match(
    canaryBlock,
    /\$\{CANDIDATE_API_IMAGE:-\$\{API_IMAGE:\?API_IMAGE is required\}\}/,
  );
  assert.match(caddyBlock, /"80:80"/);
  assert.match(caddyBlock, /"443:443"/);
});

test("optional workers use dedicated profiles, identities, env files, and hardened containers", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const expected = new Map([
    ["dm-worker-1", {
      profile: "dm-worker-1",
      image: "DM_WORKER_IMAGE",
      env: "DM_WORKER_1_ENV_FILE",
      identity: "WORKER_ID: dm-worker-1",
    }],
    ["dm-worker-2", {
      profile: "dm-worker-2",
      image: "DM_WORKER_IMAGE",
      env: "DM_WORKER_2_ENV_FILE",
      identity: "WORKER_ID: dm-worker-2",
    }],
    ["wiki-worker-1", {
      profile: "wiki-worker-1",
      image: "WIKI_WORKER_IMAGE",
      env: "WIKI_WORKER_1_ENV_FILE",
      identity: "WORKER_ID: wiki-worker-1",
    }],
    ["content-proposal-worker-1", {
      profile: "content-proposal-worker-1",
      image: "CONTENT_PROPOSAL_WORKER_IMAGE",
      env: "CONTENT_PROPOSAL_WORKER_1_ENV_FILE",
      identity: "WORKER_ID: content-proposal-worker-1",
    }],
  ]);

  for (const [name, contract] of expected) {
    const block = services.get(name);
    assert.ok(block, `${name} service is missing`);
    assert.deepEqual(parseServiceList(block, "profiles"), [`"${contract.profile}"`]);
    assert.match(block.text, new RegExp(`\\$\\{${contract.image}:\\?`));
    assert.match(block.text, new RegExp(`\\$\\{${contract.env}:-/opt/brand-pilot/shared/env/`));
    assert.ok(block.text.includes(contract.identity), `${name} must have a unique stable WORKER_ID`);
    assert.match(block.text, /^ {4}read_only:\s+true$/m);
    assert.deepEqual(parseServiceList(block, "tmpfs"), ["/tmp:size=64m,mode=1777"]);
    assert.deepEqual(parseServiceList(block, "cap_drop"), ["ALL"]);
    assert.deepEqual(parseServiceList(block, "security_opt"), ["no-new-privileges:true"]);
    assert.match(block.text, /driver:\s+json-file/);
    assert.match(block.text, /max-size:\s+10m/);
    assert.match(block.text, /max-file:\s+"5"/);
    assert.doesNotMatch(block.text, /API_ENV_FILE|api\.env/);
  }

  for (const automatedWorker of [
    "card-news-worker",
    "blog-worker",
    "marketing-worker",
    "image-worker",
    "subject-analysis-worker",
  ]) {
    assert.equal(services.has(automatedWorker), false, `${automatedWorker} must stay out of the first Ubuntu stack`);
  }
});

test("worker env examples keep service credentials separate and rollout flags fail closed", () => {
  const apiEnv = read("deploy/env/api.env.example");
  assert.match(apiEnv, /^AUTOMATED_CONTENT_ENABLED=false$/m);
  assert.match(apiEnv, /^CONTENT_PROPOSALS_ENABLED=false$/m);

  const dmEnv = read("deploy/env/dm-worker.env.example");
  const wikiEnv = read("deploy/env/wiki-worker.env.example");
  const proposalEnv = read("deploy/env/content-proposal-worker.env.example");
  assert.match(dmEnv, /^DM_WORKER_DATABASE_URL=required-at-deploy-time$/m);
  assert.match(dmEnv, /^WORKER_API_TOKEN=required-at-deploy-time$/m);
  assert.match(wikiEnv, /^DM_WORKER_DATABASE_URL=required-at-deploy-time$/m);
  assert.match(wikiEnv, /^WORKER_API_TOKEN=required-at-deploy-time$/m);
  assert.match(proposalEnv, /^CONTENT_PROPOSAL_WORKER_API_TOKEN=required-at-deploy-time$/m);
  for (const env of [dmEnv, wikiEnv, proposalEnv]) {
    assert.doesNotMatch(env, /API_SERVICE_TOKEN|ADMIN_SERVICE_TOKEN|CRON_SECRET/);
  }
});

test("worker Docker images run the real entrypoints as non-root users", () => {
  const dmDockerfile = read("workers/brand-pilot-dm-worker/Dockerfile");
  const proposalDockerfile = read("workers/brand-pilot-content-proposal-worker/Dockerfile");
  for (const dockerfile of [dmDockerfile, proposalDockerfile]) {
    assert.match(dockerfile, /^FROM node:22-bookworm-slim AS build$/m);
    assert.match(dockerfile, /^FROM node:22-bookworm-slim AS runtime$/m);
    assert.match(dockerfile, /^USER node$/m);
  }
  assert.match(dmDockerfile, /workers\/brand-pilot-dm-worker\/dist\/index\.js/);
  assert.match(dmDockerfile, /workers\/brand-pilot-dm-worker\/runtime/);
  assert.match(dmDockerfile, /@openai\/codex@0\.145\.0/);
  assert.match(proposalDockerfile, /workers\/brand-pilot-content-proposal-worker\/dist\/main\.js/);
});

test("preflight forbids worker profiles on the first deploy and fixes activation order", () => {
  const preflight = read("deploy/scripts/preflight.sh");
  assert.match(preflight, /COMPOSE_PROFILES/);
  assert.match(preflight, /first_deploy_worker_profiles_forbidden/);
  assert.match(
    preflight,
    /WIKI_ACTIVE_VERSION[\s\S]*DM_WORKER_1_HEARTBEAT[\s\S]*DM_WORKER_1_LEASE[\s\S]*REMOTE_WORKER_LEASE_EXPIRED[\s\S]*DM_WORKER_2/,
  );
});

test("Task 8 fixes every shared env path and preflight permission contract", () => {
  const compose = read("deploy/compose.production.yml");
  const preflight = read("deploy/scripts/preflight.sh");
  const runbook = read(ubuntuRunbookPath);
  const expectedEnvPaths = [
    "/opt/brand-pilot/shared/env/api.env",
    "/opt/brand-pilot/shared/env/dm-worker-1.env",
    "/opt/brand-pilot/shared/env/dm-worker-2.env",
    "/opt/brand-pilot/shared/env/wiki-worker-1.env",
    "/opt/brand-pilot/shared/env/content-proposal-worker-1.env",
  ];

  for (const path of expectedEnvPaths) {
    assert.ok(compose.includes(path), `compose missing fixed env path: ${path}`);
    assert.ok(preflight.includes(path.split("/").at(-1)), `preflight missing env file: ${path}`);
    assert.ok(runbook.includes(path), `Ubuntu runbook missing env path: ${path}`);
  }
  assert.match(preflight, /shared\/env[\s\S]*required_directory_mode_invalid/);
  assert.match(preflight, /shared\/env[\s\S]*required_directory_owner_invalid/);
  for (const variable of [
    "API_ENV_FILE",
    "DM_WORKER_1_ENV_FILE",
    "DM_WORKER_2_ENV_FILE",
    "WIKI_WORKER_1_ENV_FILE",
    "CONTENT_PROPOSAL_WORKER_1_ENV_FILE",
  ]) {
    assert.match(
      preflight,
      new RegExp(`require_file_mode_600 "\\$${variable}" "bpdeploy"`),
      `preflight must validate ${variable}`,
    );
  }
  assert.match(runbook, /shared\/env[^]*mode 700[^]*bpdeploy/i);
});

test("content proposal worker authentication is present in the API operator contract", () => {
  const apiEnv = read("deploy/env/api.env.example");
  const ubuntuRunbook = read(ubuntuRunbookPath);
  assert.match(
    apiEnv,
    /^CONTENT_PROPOSAL_WORKER_API_TOKEN=required-at-deploy-time$/m,
  );
  assert.match(
    ubuntuRunbook,
    /WORKER_API_TOKEN ADMIN_SERVICE_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN/,
  );
});

test("preflight rejects missing or mismatched content proposal worker tokens without leaking them", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the shared secret contract");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-shared-secret-"));
  const apiEnv = join(fixture, "api.env");
  const workerEnv = join(fixture, "content-proposal-worker-1.env");
  const run = () => spawnSync(bash, [
    "-c",
    'source "$1"; require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
    "_",
    bashPath("deploy/scripts/lib.sh"),
    bashPath(apiEnv),
    bashPath(workerEnv),
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  try {
    for (const [apiContents, workerContents] of [
      ["OTHER=value\n", "CONTENT_PROPOSAL_WORKER_API_TOKEN=worker-only\n"],
      ["CONTENT_PROPOSAL_WORKER_API_TOKEN=api-only\n", "OTHER=value\n"],
    ]) {
      writeFileSync(apiEnv, apiContents);
      writeFileSync(workerEnv, workerContents);
      const missing = run();
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /shared_secret_missing/);
      assert.doesNotMatch(missing.stderr, /api-only|worker-only/);
    }

    writeFileSync(apiEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=required-at-deploy-time\n");
    writeFileSync(workerEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=required-at-deploy-time\n");
    const placeholder = run();
    assert.notEqual(placeholder.status, 0);
    assert.match(placeholder.stderr, /shared_secret_missing/);

    writeFileSync(apiEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=api-secret-value\n");
    writeFileSync(workerEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=worker-secret-value\n");
    const mismatch = run();
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /shared_secret_mismatch/);
    assert.doesNotMatch(mismatch.stderr, /api-secret-value|worker-secret-value/);

    writeFileSync(apiEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=matching-secret-value\n");
    writeFileSync(workerEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=matching-secret-value\n");
    const matching = run();
    assert.equal(matching.status, 0, matching.stderr);

    const preflight = read("deploy/scripts/preflight.sh");
    assert.match(
      preflight,
      /require_matching_env_secret[\s\\]+"CONTENT_PROPOSAL_WORKER_API_TOKEN"[\s\\]+"\$API_ENV_FILE"[\s\\]+"\$CONTENT_PROPOSAL_WORKER_1_ENV_FILE"/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("preflight rejects reuse of the general worker token for content proposals without leaking it", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the shared secret contract");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-distinct-secret-"));
  const apiEnv = join(fixture, "api.env");
  const reusedSecret = "must-not-appear-reused-worker-secret";
  try {
    writeFileSync(
      apiEnv,
      [
        `WORKER_API_TOKEN=${reusedSecret}`,
        `CONTENT_PROPOSAL_WORKER_API_TOKEN=${reusedSecret}`,
        "",
      ].join("\n"),
    );
    const result = spawnSync(bash, [
      "-c",
      'source "$1"; require_distinct_env_secrets "$2" WORKER_API_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN',
      "_",
      bashPath("deploy/scripts/lib.sh"),
      bashPath(apiEnv),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /shared_secret_reuse/);
    assert.doesNotMatch(result.stderr, new RegExp(reusedSecret));

    const preflight = read("deploy/scripts/preflight.sh");
    assert.match(
      preflight,
      /require_distinct_env_secrets[\s\\]+"\$API_ENV_FILE"[\s\\]+"WORKER_API_TOKEN"[\s\\]+"CONTENT_PROPOSAL_WORKER_API_TOKEN"/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function runSharedSecretHelper(apiContents, workerContents, command) {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the shared secret contract");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-secret-parser-"));
  const apiEnv = join(fixture, "api.env");
  const workerEnv = join(fixture, "content-proposal-worker-1.env");
  try {
    writeFileSync(apiEnv, apiContents);
    writeFileSync(workerEnv, workerContents);
    return spawnSync(bash, [
      "-c",
      `source "$1"; ${command}`,
      "_",
      bashPath("deploy/scripts/lib.sh"),
      bashPath(apiEnv),
      bashPath(workerEnv),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("shared secret parser rejects a duplicate key followed by an empty value", () => {
  const result = runSharedSecretHelper(
    [
      "WORKER_API_TOKEN=general-token",
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=proposal-token",
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=",
      "",
    ].join("\n"),
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=proposal-token\n",
    'require_distinct_env_secrets "$2" WORKER_API_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN',
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /general-token|proposal-token/);
});

test("shared secret parser rejects a whitespace-only value", () => {
  const result = runSharedSecretHelper(
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=   \n",
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=   \n",
    'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
  );
  assert.notEqual(result.status, 0);
});

test("shared secret parser rejects quoted and unquoted equivalent values", () => {
  const result = runSharedSecretHelper(
    [
      "WORKER_API_TOKEN=shared-token",
      'CONTENT_PROPOSAL_WORKER_API_TOKEN="shared-token"',
      "",
    ].join("\n"),
    'CONTENT_PROPOSAL_WORKER_API_TOKEN="shared-token"\n',
    'require_distinct_env_secrets "$2" WORKER_API_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN',
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /shared-token/);
});

test("shared secret parser accepts canonical unquoted special characters", () => {
  const specialToken = "AbC+/=_:.@%-123";
  const result = runSharedSecretHelper(
    [
      "WORKER_API_TOKEN=general-token",
      `CONTENT_PROPOSAL_WORKER_API_TOKEN=${specialToken}`,
      "",
    ].join("\n"),
    `CONTENT_PROPOSAL_WORKER_API_TOKEN=${specialToken}\n`,
    'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"; '
      + 'require_distinct_env_secrets "$2" WORKER_API_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /general-token|AbC/);
});

test("shared secret parser ignores an exact key mentioned in a comment", () => {
  const result = runSharedSecretHelper(
    [
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret",
      "# Rotate CONTENT_PROPOSAL_WORKER_API_TOKEN through the approved procedure.",
      "",
    ].join("\n"),
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret\n",
    'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /canonical-secret/);
});

test("shared secret parser ignores a longer near-match key", () => {
  const result = runSharedSecretHelper(
    [
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret",
      "CONTENT_PROPOSAL_WORKER_API_TOKEN_BACKUP=backup-secret",
      "",
    ].join("\n"),
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret\n",
    'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /canonical-secret|backup-secret/,
  );
});

for (const [declarationName, alternateDeclaration] of [
  ["export declaration", "export CONTENT_PROPOSAL_WORKER_API_TOKEN=exported-secret"],
  ["leading-space declaration", " CONTENT_PROPOSAL_WORKER_API_TOKEN =spaced-secret"],
  ["colon declaration", "CONTENT_PROPOSAL_WORKER_API_TOKEN: colon-secret"],
  ["bare declaration", "CONTENT_PROPOSAL_WORKER_API_TOKEN"],
]) {
  test(`shared secret parser rejects a canonical line combined with an ${declarationName}`, () => {
    const result = runSharedSecretHelper(
      [
        "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret",
        alternateDeclaration,
        "",
      ].join("\n"),
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret\n",
      'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
    );
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /canonical-secret|exported-secret|spaced-secret|colon-secret|CONTENT_PROPOSAL_WORKER_API_TOKEN[:=]/,
    );
  });
}

test("Task 8 release replacement cannot mutate shared env files", () => {
  const replacementScripts = [
    "deploy/scripts/deploy.sh",
    "deploy/scripts/promote.sh",
    "deploy/scripts/rollback.sh",
  ].map(read).join("\n");

  const sharedEnvTarget =
    /shared\/env|(?:API|DM_WORKER_1|DM_WORKER_2|WIKI_WORKER_1|CONTENT_PROPOSAL_WORKER_1)_ENV_FILE/;
  const sharedEnvMutations = replacementScripts
    .split(/\r?\n/)
    .filter((line) =>
      sharedEnvTarget.test(line)
      && (
        /\b(?:rm|mv|cp|install|touch|truncate|chmod|chown|tee)\b/.test(line)
        || /\bsed\b[^#\n]*\s-i(?:\s|$)/.test(line)
        || /(?:^|[^<])>{1,2}\s*["']?\$\{?(?:API|DM_WORKER_1|DM_WORKER_2|WIKI_WORKER_1|CONTENT_PROPOSAL_WORKER_1)_ENV_FILE/.test(line)
      ),
    );
  assert.deepEqual(
    sharedEnvMutations,
    [],
    "release replacement scripts must not create, modify, or delete shared env targets",
  );
  const runbook = read(ubuntuRunbookPath);
  assert.match(runbook, /image[^]*release[^]*(?:never|must not)[^]*(?:create|modify|delete)[^]*shared env/i);
});

test("Task 8 pins OAuth cutover, frontend origin, and secret lifecycle", () => {
  assert.equal(existsSync(oauthCutoverRunbookPath), true, "OAuth cutover runbook is missing");
  const runbook = read(oauthCutoverRunbookPath);
  const apiEnv = read("deploy/env/api.env.example");
  const fixedValues = [
    "https://api.danbammsg.co.kr/auth/kakao/callback",
    "https://api.danbammsg.co.kr/auth/meta/callback",
    "https://api.danbammsg.co.kr/auth/meta/trends/callback",
    "https://api.danbammsg.co.kr/webhooks/meta/instagram",
    "https://app.danbammsg.co.kr",
  ];
  for (const value of fixedValues) {
    assert.ok(runbook.includes(value), `OAuth runbook missing: ${value}`);
    assert.ok(apiEnv.includes(value), `API env example missing: ${value}`);
  }
  for (const phrase of [
    "add the new callback before removing the old callback",
    "NEVER arbitrarily rotate `CREDENTIAL_ENCRYPTION_KEY`",
    "Kakao REST key",
    "Meta app ID",
    "webhook verify token",
    "Supabase",
    "Blob token",
    "worker/admin/cron",
    "suspected exposure",
    "arbitrary origin",
    "login",
    "cancel",
    "state mismatch",
    "token decryption",
    "must not log secrets",
  ]) {
    assert.ok(runbook.includes(phrase), `OAuth runbook missing policy: ${phrase}`);
  }
  assert.match(apiEnv, /^AUTH_FRONTEND_URL=https:\/\/app\.danbammsg\.co\.kr$/m);
  assert.match(apiEnv, /^CORS_ALLOWED_ORIGINS=https:\/\/app\.danbammsg\.co\.kr$/m);
});

test("release images are digest pinned and Caddy checks readiness", () => {
  const compose = read("deploy/compose.production.yml");
  const caddy = read("deploy/Caddyfile");
  assert.match(
    compose,
    /\$\{PRIMARY_API_IMAGE:-\$\{API_IMAGE:\?API_IMAGE is required\}\}/,
  );
  assert.match(
    compose,
    /\$\{CANDIDATE_API_IMAGE:-\$\{API_IMAGE:\?API_IMAGE is required\}\}/,
  );
  assert.match(compose, /CADDY_IMAGE:\?CADDY_IMAGE/);
  assert.match(compose, /CANARY_HOST:\?CANARY_HOST/);
  assert.match(compose, /PRIMARY_HOST:\?PRIMARY_HOST/);
  assert.match(caddy, /\{\$CANARY_HOST\}/);
  assert.match(caddy, /\{\$PRIMARY_HOST\}/);
  assert.match(caddy, /\/ready/);
  assert.equal(hasCaddyLogDirective(caddy), false, "Caddy access logging must remain disabled");
});

test("Caddy container has only the capabilities and writable mounts it needs", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const apiBlocks = [services.get("api-primary"), services.get("api-canary")];
  const caddyBlock = services.get("caddy");

  assert.match(caddyBlock.text, /^ {4}read_only:\s+true$/m);
  assert.deepEqual(parseServiceList(caddyBlock, "cap_drop"), ["ALL"]);
  assert.deepEqual(parseServiceList(caddyBlock, "cap_add"), ["NET_BIND_SERVICE"]);
  assert.deepEqual(parseServiceList(caddyBlock, "security_opt"), ["no-new-privileges:true"]);
  assert.deepEqual(parseServiceList(caddyBlock, "tmpfs"), ["/tmp:size=64m,mode=1777"]);
  assert.deepEqual(parseServiceList(caddyBlock, "volumes"), [
    "${CADDYFILE_PATH:-./Caddyfile}:/etc/caddy/Caddyfile:ro",
    "caddy_data:/data",
    "caddy_config:/config",
  ]);
  for (const apiBlock of apiBlocks) {
    assert.deepEqual(parseServiceList(apiBlock, "cap_add"), []);
    assert.deepEqual(parseServiceList(apiBlock, "volumes"), []);
  }

  const writableMounts = parseServiceList(caddyBlock, "volumes")
    .filter((mount) => !mount.endsWith(":ro"));
  assert.deepEqual(writableMounts, ["caddy_data:/data", "caddy_config:/config"]);
});

test("Caddy routes canary and primary hosts to isolated API services", () => {
  const caddy = read("deploy/Caddyfile");
  assert.match(caddy, /\{\$CANARY_HOST\}[\s\S]*reverse_proxy api-canary:4000/);
  assert.match(caddy, /\{\$PRIMARY_HOST\}[\s\S]*reverse_proxy api-primary:4000/);
  assert.doesNotMatch(caddy, /\{\$CANARY_HOST\},\s*\{\$PRIMARY_HOST\}/);
});

test("canary Caddy configuration requests TLS only for the canary host", () => {
  const caddy = read("deploy/Caddyfile.canary");
  assert.match(caddy, /\{\$CANARY_HOST\}[\s\S]*reverse_proxy api-canary:4000/);
  assert.doesNotMatch(caddy, /PRIMARY_HOST|api-primary/);
  assert.match(caddy, /tls \{\$ACME_EMAIL\}/);
  assert.match(caddy, /encode zstd gzip/);
  assert.match(caddy, /Strict-Transport-Security/);
  assert.equal(hasCaddyLogDirective(caddy), false);
});

test("Caddy applies baseline browser security headers without access logging", () => {
  const caddy = read("deploy/Caddyfile");
  assert.match(caddy, /^\s*header\s+\{$/m);
  assert.match(caddy, /Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"/);
  assert.match(caddy, /X-Content-Type-Options\s+"nosniff"/);
  assert.match(caddy, /X-Frame-Options\s+"DENY"/);
  assert.match(caddy, /Referrer-Policy\s+"strict-origin-when-cross-origin"/);
  assert.equal(hasCaddyLogDirective(caddy), false, "Caddy access logging must remain disabled");
});

test("Caddy enforces HTTPS, bounded requests, and upstream timeouts on both edges", () => {
  for (const path of ["deploy/Caddyfile", "deploy/Caddyfile.canary"]) {
    const caddy = read(path);
    assert.match(caddy, /tls \{\$ACME_EMAIL\}/, `${path} must use ACME TLS`);
    assert.match(
      caddy,
      /Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"/,
      `${path} must send HSTS`,
    );
    assert.match(caddy, /request_body\s*\{[\s\S]*max_size 32MB[\s\S]*\}/);
    assert.match(caddy, /timeouts\s*\{[\s\S]*read_body 30s[\s\S]*read_header 10s/);
    assert.match(caddy, /timeouts\s*\{[\s\S]*write 60s[\s\S]*idle 2m/);
    assert.match(
      caddy,
      /transport http\s*\{[\s\S]*dial_timeout 5s[\s\S]*response_header_timeout 30s/,
    );
    assert.doesNotMatch(caddy, /http:\/\/\{\$(?:CANARY|PRIMARY)_HOST\}/);
  }
});

test("deployment scripts never enable shell tracing", () => {
  for (const path of deploymentScripts) {
    assert.equal(hasShellTracing(read(path)), false, `${path} enables shell tracing`);
  }
});

test("all deployment scripts use Bash strict mode", () => {
  for (const path of deploymentScripts) {
    assert.match(read(path), /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail\n/);
  }
});

test("deploy and rollback serialize changes and validate Compose before pull or up", () => {
  for (const path of ["deploy/scripts/deploy.sh", "deploy/scripts/rollback.sh"]) {
    const script = read(path);
    assert.match(script, /flock/);
    const configIndex = script.indexOf("config --quiet");
    const pullIndex = script.indexOf(" pull");
    const upIndex = script.indexOf(" up");
    assert.ok(configIndex >= 0, `${path} omits compose config --quiet`);
    assert.ok(pullIndex > configIndex, `${path} pulls before validating Compose`);
    assert.ok(upIndex > configIndex, `${path} starts containers before validating Compose`);
  }
});

test("rollback acquires its lock before resolving mutable previous state", () => {
  const rollback = read("deploy/scripts/rollback.sh");
  const lockIndex = rollback.indexOf("flock -n 9");
  const previousStateIndex = rollback.indexOf('load_required_state_sha "$ROOT/state/previous"');
  assert.ok(lockIndex >= 0);
  assert.ok(previousStateIndex > lockIndex);
});

test("release and state contracts are digest-pinned and atomic", () => {
  const lib = read("deploy/scripts/lib.sh");
  const deploy = read("deploy/scripts/deploy.sh");
  const promote = read("deploy/scripts/promote.sh");
  const rollback = read("deploy/scripts/rollback.sh");
  assert.match(lib, /@sha256:/);
  assert.match(lib, /\[a-f0-9\]\{64\}/);
  assert.match(lib, /mktemp/);
  assert.match(lib, /chmod/);
  assert.match(lib, /\bmv\b/);
  assert.match(deploy, /atomic_write[\s\S]*state\/candidate/);
  assert.match(promote, /atomic_write[\s\S]*state\/previous/);
  assert.match(promote, /atomic_write[\s\S]*state\/current/);
  assert.match(rollback, /atomic_write[\s\S]*state\/current/);
});

test("release manifests are parsed without source or eval and preflight is fail-closed", () => {
  const lib = read("deploy/scripts/lib.sh");
  const preflight = read("deploy/scripts/preflight.sh");
  for (const path of deploymentScripts) {
    assert.doesNotMatch(read(path), /\beval\b/);
  }
  assert.doesNotMatch(preflight, /source\s+["']?\$MANIFEST/);
  assert.match(lib, /manifest_unknown_key/);
  assert.match(lib, /manifest_duplicate_key/);
  assert.match(lib, /RELEASE_SCHEMA\|RELEASE_SHA\|API_IMAGE\|DM_WORKER_IMAGE\|WIKI_WORKER_IMAGE\|CONTENT_PROPOSAL_WORKER_IMAGE\|CADDY_IMAGE\|CANARY_HOST\|PRIMARY_HOST\|ACME_EMAIL\|API_ENV_FILE/);
  assert.match(preflight, /VERSION_ID=.*24\\?\.04|24\\?\.04.*VERSION_ID/);
  assert.match(preflight, /dpkg --print-architecture/);
  assert.match(preflight, /COMPOSE_MINOR >= 24/);
  assert.match(preflight, /NTPSynchronized/);
  assert.match(preflight, /10 \* 1024 \* 1024/);
  assert.match(preflight, /\/var\/lib\/docker/);
  assert.match(preflight, /sport = :80 or sport = :443/);
  assert.match(preflight, /"bpdeploy"/);
  assert.match(preflight, /LOCAL_SCHEDULER_ENABLED/);
  assert.match(preflight, /INSTAGRAM_PUBLISH_ENABLED/);
  assert.match(preflight, /config --quiet/);
});

test("the first attachment lifecycle rollout is forced off and remains unscheduled", () => {
  const flag = "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED";
  const envExample = read("deploy/env/api.env.example");
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const preflight = read("deploy/scripts/preflight.sh");
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");
  const ledger = read("docs/prd/brand-pilot-feature-preservation-ledger.md");

  assert.equal(
    envExample.match(new RegExp(`^${flag}=false$`, "gm"))?.length,
    1,
    "reviewed API env example must contain one exact false attachment-session flag",
  );
  for (const service of ["api-primary", "api-canary"]) {
    assert.match(
      services.get(service).text,
      new RegExp(`^\\s+${flag}:\\s+["']false["']\\s*$`, "m"),
      `${service} must force the attachment-session flag false`,
    );
  }
  assert.match(
    preflight,
    new RegExp(`require_exact_false\\s+"${flag}"\\s+"\\$API_ENV_FILE"`),
  );
  assert.ok(
    runbook.match(new RegExp(`${flag}=false`, "g"))?.length >= 4,
    "runbook must retain the flag in fixed controls, safe values, final evidence, and dark-launch checks",
  );

  for (const phrase of [
    `${flag}=false`,
    "/internal/cron/ai-content-attachment-gc",
    "implemented-but-not-scheduled",
    "later Operations/rollout approval",
    "full legacy-token TTL drain",
    "oldestEligiblePendingAgeSeconds",
    "deadLetterCount",
    "five consecutive scheduled runs",
    "forward-only",
    "flag OFF",
    "cleanup obligations remain",
  ]) {
    assert.ok(normalizedRunbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
  for (const phrase of [
    "콘텐츠 첨부 총 5개",
    "PNG/JPEG 각 5MB",
    "활성 중복 경고",
    "fresh upload attempt",
    "immutable worker snapshot",
    "15-day retry boundary",
    "draft preservation on storage failure",
    "npm run test:deployment",
  ]) {
    assert.ok(ledger.includes(phrase), `preservation ledger missing: ${phrase}`);
  }

  for (const path of deploymentScripts) {
    assert.doesNotMatch(
      read(path),
      /\/internal\/cron\/ai-content-attachment-gc/,
      `${path} must not invoke attachment GC`,
    );
  }
  assert.doesNotMatch(
    compose,
    /(?:systemd|\.service\b|\.timer\b|AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED:\s*["']?true)/i,
  );
  assert.doesNotMatch(
    envExample,
    /^AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=true$/m,
  );
  const trackedOperationalFiles = spawnSync(
    "git",
    ["ls-files", "-z", "--", "apps/api/.env.example", "deploy"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(trackedOperationalFiles.status, 0, trackedOperationalFiles.stderr);
  const operationalPaths = trackedOperationalFiles.stdout.split("\0").filter(Boolean);
  const trackedWorkflowFiles = spawnSync(
    "git",
    ["ls-files", "-z", "--", ":(top).github"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(trackedWorkflowFiles.status, 0, trackedWorkflowFiles.stderr);
  const workflowPaths = trackedWorkflowFiles.stdout
    .split("\0")
    .filter(Boolean)
    .map((path) => resolve(path));
  for (const path of [...operationalPaths, ...workflowPaths]) {
    assert.doesNotMatch(
      read(path),
      /AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED(?:=|:\s*)["']?true["']?/,
      `${path} must not enable attachment-session issuance`,
    );
  }
  assert.equal(
    operationalPaths.some((path) => /\.(?:service|timer)$/.test(path)),
    false,
    "first rollout must not check in an attachment lifecycle systemd unit",
  );
});

test("canary verification and promotion keep bounded explicit contracts", () => {
  const verify = read("deploy/scripts/verify-canary.sh");
  const promote = read("deploy/scripts/promote.sh");
  assert.match(verify, /\/health/);
  assert.match(verify, /\/ready/);
  assert.match(verify, /cors_allowed/);
  assert.match(verify, /cors_denied/);
  assert.match(verify, /dev-complete/);
  assert.match(verify, /"404"/);
  assert.match(promote, /--prepare/);
  assert.match(promote, /--commit/);
  assert.match(promote, /--dns-cutover-confirmed/);
  assert.match(promote, /CANARY_HOST/);
  assert.match(promote, /PRIMARY_HOST/);
  assert.match(promote, /flock/);
  assert.match(promote, /\[\[\s+"\$CURRENT_SHA"\s+!=\s+"\$CANDIDATE_SHA"\s+\]\]/);
  assert.match(promote, /rm -f -- "\$ROOT\/state\/candidate"/);
});

test("deployment phases target only their isolated API service", () => {
  const deploy = read("deploy/scripts/deploy.sh");
  const promote = read("deploy/scripts/promote.sh");
  const rollback = read("deploy/scripts/rollback.sh");
  assert.match(deploy, /up[\s\S]*api-canary/);
  assert.doesNotMatch(deploy, /up[^\n]*api-primary/);
  assert.match(promote, /up[\s\S]{0,160}api-primary/);
  assert.doesNotMatch(promote, /up[^\n]*api-canary/);
  assert.match(rollback, /PHASE[\s\S]*api-canary/);
  assert.match(rollback, /PHASE[\s\S]*api-primary/);
});

test("installed releases and state are regular immutable verified files", () => {
  const lib = read("deploy/scripts/lib.sh");
  const deploy = read("deploy/scripts/deploy.sh");
  assert.match(lib, /release-integrity\.sha256/);
  assert.match(lib, /644 Caddyfile\.canary/);
  assert.match(lib, /generate_release_integrity/);
  assert.match(lib, /validate_release_integrity/);
  assert.match(lib, /!\s+-L/);
  assert.match(lib, /require_secure_state_file/);
  assert.match(deploy, /generate_release_integrity/);
  assert.match(deploy, /Caddyfile\.canary/);
  assert.match(deploy, /validate_release_directory/);
});

test("CI publishing has narrow triggers, permissions, and an Ubuntu 24.04 runner", () => {
  const workflow = read(publishWorkflowPath);
  const verifyJob = parseWorkflowJob(workflow, "verify");
  const publishJob = parseWorkflowJob(workflow, "publish");
  assert.match(workflow, /^name: Publish Brand Pilot server images$/m);
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n {2}push:\n {4}branches: \[main\]\n {4}paths:\n {6}- "brand_poilot\/\*\*"\n {6}- "\.github\/workflows\/publish-brand-pilot-server-images\.yml"$/m);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("\njobs:")), /packages: write/);
  assert.match(verifyJob, /^ {4}permissions:\n {6}contents: read$/m);
  assert.doesNotMatch(verifyJob, /packages: write|docker\/login-action|docker\/build-push-action/);
  assert.match(publishJob, /^ {4}needs: verify$/m);
  assert.match(publishJob, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(publishJob, /^ {4}permissions:\n {6}contents: read\n {6}packages: write$/m);
  assert.match(verifyJob, /^ {4}runs-on: ubuntu-24\.04$/m);
  assert.match(publishJob, /^ {4}runs-on: ubuntu-24\.04$/m);
  assert.doesNotMatch(workflow, /^\s+(?:actions|checks|deployments|id-token|issues|pull-requests):\s+write$/m);
});

test("CI publishing verifies the complete server release contract before building", () => {
  const workflow = read(publishWorkflowPath);
  const verifyJob = parseWorkflowJob(workflow, "verify");
  assert.match(verifyJob, /uses: actions\/checkout@[0-9a-f]{40}\s+# v4\.4\.0[\s\S]*persist-credentials: false/);
  assert.match(verifyJob, /uses: actions\/setup-node@[0-9a-f]{40}\s+# v4\.4\.0[\s\S]*node-version: 22\.23\.1[\s\S]*cache: npm[\s\S]*cache-dependency-path: brand_poilot\/package-lock\.json/);
  assert.match(verifyJob, /name: Install\n {8}working-directory: brand_poilot\n {8}run: npm ci/);
  assert.match(verifyJob, /name: Verify\n {8}working-directory: brand_poilot\n {8}run: \|\n {10}npm run test:contract\n {10}node --test scripts\/migrationRunner\.test\.mjs\n {10}npm run test:migrations\n {10}npm run test --workspace @brand-pilot\/api\n {10}npm run test --workspace @brand-pilot\/dm-worker\n {10}npm run test --workspace @brand-pilot\/content-proposal-worker\n {10}npm run build --workspace @brand-pilot\/api\n {10}npm run build --workspace @brand-pilot\/dm-worker\n {10}npm run build --workspace @brand-pilot\/content-proposal-worker\n {10}shellcheck --exclude=SC1091,SC2034,SC2317 deploy\/scripts\/\*\.sh\n {10}npm run test:deployment/);
});

test("CI publishing pushes a lowercase linux amd64 API image with immutable metadata", () => {
  const workflow = read(publishWorkflowPath);
  const publishJob = parseWorkflowJob(workflow, "publish");
  assert.match(publishJob, /uses: actions\/checkout@[0-9a-f]{40}\s+# v4\.4\.0[\s\S]*persist-credentials: false/);
  assert.match(publishJob, /uses: docker\/setup-buildx-action@[0-9a-f]{40}\s+# v3\.12\.0/);
  assert.match(publishJob, /uses: docker\/login-action@[0-9a-f]{40}\s+# v3\.7\.0[\s\S]*registry: \$\{\{ env\.REGISTRY \}\}[\s\S]*username: \$\{\{ github\.actor \}\}[\s\S]*password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(publishJob, /id: image[\s\S]*API_IMAGE_NAME,,/);
  assert.match(publishJob, /uses: docker\/build-push-action@[0-9a-f]{40}\s+# v6\.19\.2[\s\S]*context: brand_poilot[\s\S]*file: brand_poilot\/apps\/api\/Dockerfile[\s\S]*platforms: linux\/amd64[\s\S]*push: true/);
  assert.match(publishJob, /tags: \$\{\{ steps\.image\.outputs\.name \}\}:sha-\$\{\{ github\.sha \}\}/);
  assert.match(publishJob, /org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/);
  assert.match(publishJob, /org\.opencontainers\.image\.source=https:\/\/github\.com\/\$\{\{ github\.repository \}\}/);
  for (const [id, file, output] of [
    ["dm_worker", "workers/brand-pilot-dm-worker/Dockerfile", "dm_worker"],
    ["wiki_worker", "workers/brand-pilot-dm-worker/Dockerfile", "wiki_worker"],
    ["content_proposal_worker", "workers/brand-pilot-content-proposal-worker/Dockerfile", "content_proposal_worker"],
  ]) {
    assert.match(
      publishJob,
      new RegExp(`id: ${id}[\\s\\S]*file: brand_poilot/${file}[\\s\\S]*tags: \\$\\{\\{ steps\\.image\\.outputs\\.${output} \\}\\}:sha-\\$\\{\\{ github\\.sha \\}\\}`),
    );
  }
});

test("CI publishing pins every third-party action to its verified commit", () => {
  const workflow = read(publishWorkflowPath);
  const expected = new Map([
    ["actions/checkout", "11d5960a326750d5838078e36cf38b85af677262"],
    ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
    ["docker/setup-buildx-action", "8d2750c68a42422c14e847fe6c8ac0403b4cbd6f"],
    ["docker/login-action", "c94ce9fb468520275223c153574b00df6fe4bcc9"],
    ["docker/build-push-action", "10e90e3645eae34f1e60eeb005ba3a3d33f178e8"],
    ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
  ]);
  const uses = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s+([^@\s]+)@([^\s#]+)\s+#\s+(v\d+\.\d+\.\d+)$/gm)];
  assert.equal(uses.length, 10);
  for (const [, action, revision] of uses) {
    assert.equal(revision, expected.get(action), `${action} is not pinned to the verified SHA`);
  }
  assert.doesNotMatch(workflow, /^\s*(?:-\s+)?uses:\s+\S+@v\d+(?:\s|$)/m);
});

test("CI release manifest is digest pinned, single-line validated, and checksummed", () => {
  const workflow = read(publishWorkflowPath);
  assert.match(workflow, /caddy_line="\$\(cat deploy\/caddy-image\.env\)"/);
  assert.match(workflow, /\[\[ "\$caddy_line" == 'CADDY_IMAGE=docker\.io\/library\/caddy@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648' \]\]/);
  assert.match(workflow, /source deploy\/caddy-image\.env/);
  assert.match(workflow, /\[\[ "\$RELEASE_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflow, /for digest in "\$API_DIGEST" "\$DM_WORKER_DIGEST" "\$WIKI_WORKER_DIGEST" "\$CONTENT_PROPOSAL_WORKER_DIGEST"/);
  assert.match(workflow, /\[\[ "\$digest" =~ \^sha256:\[0-9a-f\]\{64\}\$ \]\]/);
  assert.match(workflow, /printf 'API_IMAGE=%s@%s\\n' "\$API_IMAGE" "\$API_DIGEST"/);
  assert.match(workflow, /printf 'DM_WORKER_IMAGE=%s@%s\\n' "\$DM_WORKER_IMAGE" "\$DM_WORKER_DIGEST"/);
  assert.match(workflow, /printf 'WIKI_WORKER_IMAGE=%s@%s\\n' "\$WIKI_WORKER_IMAGE" "\$WIKI_WORKER_DIGEST"/);
  assert.match(workflow, /printf 'CONTENT_PROPOSAL_WORKER_IMAGE=%s@%s\\n' "\$CONTENT_PROPOSAL_WORKER_IMAGE" "\$CONTENT_PROPOSAL_WORKER_DIGEST"/);
  for (const line of [
    "RELEASE_SCHEMA=1",
    "CANARY_HOST=canary-api.danbammsg.co.kr",
    "PRIMARY_HOST=api.danbammsg.co.kr",
    "ACME_EMAIL=ops@danbammsg.co.kr",
    "API_ENV_FILE=/opt/brand-pilot/shared/env/api.env",
  ]) {
    assert.ok(workflow.includes(line), `release manifest omits ${line}`);
  }
  assert.match(workflow, /sha256sum release\.env > release\.env\.sha256/);
});

test("CI publishing uploads only the release pair and never deploys production", () => {
  const workflow = read(publishWorkflowPath);
  const publishJob = parseWorkflowJob(workflow, "publish");
  assert.match(publishJob, /uses: actions\/upload-artifact@[0-9a-f]{40}\s+# v4\.6\.2[\s\S]*name: brand-pilot-api-release-\$\{\{ github\.sha \}\}[\s\S]*path: \|\n {12}brand_poilot\/release\.env\n {12}brand_poilot\/release\.env\.sha256\n {10}if-no-files-found: error\n {10}retention-days: 30/);
  assert.doesNotMatch(workflow, /\b(?:ssh|scp|rsync)\b/);
  assert.doesNotMatch(workflow, /docker compose[^\n]*(?:up|pull|restart)/);
  assert.doesNotMatch(workflow, /npm run db:migrate|\bpsql\b/);
  assert.doesNotMatch(workflow, /deploy\/scripts\/(?:deploy|promote|rollback)\.sh/);
});

function findBash() {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      ]
    : ["/usr/bin/bash", "/bin/bash"];
  return candidates.find(existsSync);
}

function bashPath(path) {
  const absolute = resolve(path).replaceAll("\\", "/");
  if (process.platform !== "win32") return absolute;
  return absolute.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function writeReleaseManifest(directory, overrides = {}, extraLines = []) {
  mkdirSync(directory, { recursive: true });
  const digest = "a".repeat(64);
  const values = {
    RELEASE_SCHEMA: "1",
    RELEASE_SHA: "1".repeat(40),
    API_IMAGE: `ghcr.io/dkskrn2/brand-pilot-api@sha256:${digest}`,
    DM_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-dm-worker@sha256:${digest}`,
    WIKI_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-wiki-worker@sha256:${digest}`,
    CONTENT_PROPOSAL_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-content-proposal-worker@sha256:${digest}`,
    CADDY_IMAGE: `docker.io/library/caddy@sha256:${digest}`,
    CANARY_HOST: "canary-api.danbammsg.co.kr",
    PRIMARY_HOST: "api.danbammsg.co.kr",
    ACME_EMAIL: "ops@danbammsg.co.kr",
    API_ENV_FILE: "/opt/brand-pilot/shared/env/api.env",
    ...overrides,
  };
  const manifest = join(directory, "release.env");
  const contents = [
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    ...extraLines,
    "",
  ].join("\n");
  writeFileSync(manifest, contents, { mode: 0o600 });
  chmodSync(manifest, 0o600);
  const checksum = createHash("sha256").update(contents).digest("hex");
  writeFileSync(`${manifest}.sha256`, `${checksum}  release.env\n`, { mode: 0o600 });
  chmodSync(`${manifest}.sha256`, 0o600);
  return manifest;
}

function seedRelease(root, sha, apiEnvFile, overrides = {}) {
  const releaseDirectory = join(root, "releases", sha);
  const digestCharacter = sha[0] === "1" ? "a" : sha[0] === "2" ? "b" : "c";
  const digest = digestCharacter.repeat(64);
  writeReleaseManifest(releaseDirectory, {
    RELEASE_SHA: sha,
    API_IMAGE: `ghcr.io/dkskrn2/brand-pilot-api@sha256:${digest}`,
    DM_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-dm-worker@sha256:${digest}`,
    WIKI_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-wiki-worker@sha256:${digest}`,
    CONTENT_PROPOSAL_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-content-proposal-worker@sha256:${digest}`,
    CADDY_IMAGE: `docker.io/library/caddy@sha256:${digest}`,
    API_ENV_FILE: apiEnvFile,
    ...overrides,
  });
  copyFileSync("deploy/compose.production.yml", join(releaseDirectory, "compose.production.yml"));
  copyFileSync("deploy/Caddyfile", join(releaseDirectory, "Caddyfile"));
  copyFileSync("deploy/Caddyfile.canary", join(releaseDirectory, "Caddyfile.canary"));
  mkdirSync(join(releaseDirectory, "scripts"), { recursive: true });
  for (const name of ["lib.sh", "preflight.sh", "deploy.sh", "verify-canary.sh", "promote.sh", "rollback.sh", "backup-state.sh", "restore-state.sh"]) {
    copyFileSync(join("deploy", "scripts", name), join(releaseDirectory, "scripts", name));
    chmodSync(join(releaseDirectory, "scripts", name), 0o755);
  }
  const specs = [
    [0o600, "release.env"],
    [0o600, "release.env.sha256"],
    [0o644, "compose.production.yml"],
    [0o644, "Caddyfile"],
    [0o644, "Caddyfile.canary"],
    ...["lib.sh", "preflight.sh", "deploy.sh", "verify-canary.sh", "promote.sh", "rollback.sh"]
      .map((name) => [0o755, `scripts/${name}`]),
    [0o755, "scripts/backup-state.sh"],
    [0o755, "scripts/restore-state.sh"],
  ];
  const integrity = specs.map(([mode, relative]) => {
    chmodSync(join(releaseDirectory, relative), mode);
    const checksum = createHash("sha256").update(readFileSync(join(releaseDirectory, relative))).digest("hex");
    return `${checksum}  ${mode.toString(8)}  ${relative}`;
  }).join("\n") + "\n";
  writeFileSync(join(releaseDirectory, "release-integrity.sha256"), integrity, { mode: 0o600 });
  chmodSync(join(releaseDirectory, "release-integrity.sha256"), 0o600);
  return releaseDirectory;
}

function writeTransitionJournal(root, values) {
  const journal = join(root, "state", "transition.journal");
  const contents = [
    "JOURNAL_SCHEMA=1",
    `OPERATION=${values.operation}`,
    `DEPLOYMENT_PHASE=${values.deploymentPhase}`,
    `TRANSITION_PHASE=${values.transitionPhase ?? "runtime_mutation"}`,
    `FROM_CURRENT=${values.fromCurrent ?? "NONE"}`,
    `FROM_CANDIDATE=${values.fromCandidate ?? "NONE"}`,
    `FROM_PREVIOUS=${values.fromPrevious ?? "NONE"}`,
    `FROM_PREPARED=${values.fromPrepared ?? "0"}`,
    `TO_RELEASE=${values.toRelease}`,
    "",
  ].join("\n");
  writeFileSync(journal, contents, { mode: 0o600 });
  chmodSync(journal, 0o600);
  return journal;
}

function dockerMockScript() {
  return `#!/usr/bin/env bash
printf 'PRIMARY_API_IMAGE=%s CANDIDATE_API_IMAGE=%s CADDY_IMAGE=%s CADDYFILE_PATH=%s %s\\n' "\${PRIMARY_API_IMAGE:-}" "\${CANDIDATE_API_IMAGE:-}" "\${CADDY_IMAGE:-}" "\${CADDYFILE_PATH:-}" "$*" >> "$DOCKER_LOG"
if [[ -n "\${EVENT_LOG:-}" ]]; then printf 'docker %s\\n' "$*" >> "$EVENT_LOG"; fi
if [[ "$1 $2" == "image inspect" ]]; then printf '%s\\n' "$RELEASE_SHA_FOR_TEST"; fi
if [[ "$*" == *" up -d "* ]]; then
  count=0
  [[ ! -f "$DOCKER_UP_COUNT_FILE" ]] || count="$(cat "$DOCKER_UP_COUNT_FILE")"
  count=$((count + 1))
  printf '%s\\n' "$count" > "$DOCKER_UP_COUNT_FILE"
  if (( count <= DOCKER_UP_FAILURES )); then exit 42; fi
  if [[ -n "\${DOCKER_FAIL_UP_SERVICE:-}" && "$*" == *"\${DOCKER_FAIL_UP_SERVICE}"* ]]; then
    service_count_file="\${DOCKER_UP_COUNT_FILE}.\${DOCKER_FAIL_UP_SERVICE}"
    service_count=0
    [[ ! -f "$service_count_file" ]] || service_count="$(cat "$service_count_file")"
    service_count=$((service_count + 1))
    printf '%s\\n' "$service_count" > "$service_count_file"
    if (( service_count <= \${DOCKER_FAIL_UP_TIMES:-1} )); then exit 43; fi
  fi
  if [[ -n "\${DOCKER_KILL_SWITCH:-}" && -f "$DOCKER_KILL_SWITCH" &&
    -n "\${DOCKER_KILL_UP_SERVICE:-}" && "$*" == *"\${DOCKER_KILL_UP_SERVICE}"* ]]; then
    rm -f -- "$DOCKER_KILL_SWITCH"
    kill -KILL "$PPID"
    sleep 1
  fi
fi
exit 0
`;
}

function statMockScript() {
  return `#!/usr/bin/env bash
if [[ "$*" == *"%U"* ]]; then
  printf 'bpdeploy\\n'
  exit 0
fi
path="\${@: -1}"
case "$path" in
  */scripts/*.sh) printf '755\\n' ;;
  */compose.production.yml|*/Caddyfile|*/Caddyfile.canary) printf '644\\n' ;;
  *) printf '600\\n' ;;
esac
`;
}

function bashFixtureCommand() {
  return `export PATH="$1:/usr/bin:/bin"
stat() {
  if [[ "$*" == *"%U"* ]]; then
    printf 'bpdeploy\\n'
    return 0
  fi
  path="\${@: -1}"
  case "$path" in
    */scripts/*.sh) printf '755\\n' ;;
    */compose.production.yml|*/Caddyfile|*/Caddyfile.canary) printf '644\\n' ;;
    *) printf '600\\n' ;;
  esac
}
export -f stat
shift
exec bash "$@"`;
}

function runDeployFixture({
  overrides = {},
  extraLines = [],
  curlSucceeds = false,
  dockerUpFailures = 0,
  dockerFailUpService = "",
  currentSha = null,
  currentManifestOverrides = {},
  corruptCurrent = false,
  previousCandidateSha = null,
  previousCandidateManifestOverrides = {},
  corruptCandidate = false,
} = {}) {
  const bash = findBash();
  assert.ok(bash, "Bash is required for disposable deployment tests");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-deploy-"));
  const root = join(fixture, "root");
  const incoming = join(fixture, "incoming");
  const mocks = join(fixture, "bin");
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(mocks, { recursive: true });
  const manifest = writeReleaseManifest(incoming, {
    API_ENV_FILE: `${bashPath(root)}/shared/env/api.env`,
    ...overrides,
  }, extraLines);
  const dockerLog = join(fixture, "docker.log");
  const preflightLog = join(fixture, "preflight.log");
  const dockerUpCountFile = join(fixture, "docker-up-count");
  writeExecutable(join(mocks, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(mocks, "stat"), statMockScript());
  writeExecutable(join(mocks, "docker"), dockerMockScript());
  writeExecutable(join(mocks, "curl"), curlSucceeds
    ? "#!/usr/bin/env bash\nexit 0\n"
    : "#!/usr/bin/env bash\nexit 22\n");
  const preflight = join(fixture, "preflight");
  writeExecutable(
    preflight,
    "#!/usr/bin/env bash\nprintf '%s\\n' \"${CADDYFILE_PATH:-}\" > \"$PREFLIGHT_LOG\"\n",
  );
  if (currentSha) {
    seedRelease(
      root,
      currentSha,
      `${bashPath(root)}/shared/env/api.env`,
      currentManifestOverrides,
    );
    writeFileSync(join(root, "state", "current"), `${currentSha}\n`, { mode: 0o600 });
  } else if (corruptCurrent) {
    writeFileSync(join(root, "state", "current"), "not-a-release\n", { mode: 0o600 });
  }
  if (previousCandidateSha) {
    seedRelease(
      root,
      previousCandidateSha,
      `${bashPath(root)}/shared/env/api.env`,
      previousCandidateManifestOverrides,
    );
    writeFileSync(
      join(root, "state", "candidate"),
      `${previousCandidateSha}\n`,
      { mode: 0o600 },
    );
  } else if (corruptCandidate) {
    writeFileSync(join(root, "state", "candidate"), "not-a-release\n", { mode: 0o600 });
  }

  const result = spawnSync(bash, [
    "-c",
    bashFixtureCommand(),
    "_",
    bashPath(mocks),
    bashPath("deploy/scripts/deploy.sh"),
    bashPath(manifest),
    "--phase",
    "canary",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      BRAND_PILOT_ROOT: bashPath(root),
      PREFLIGHT_SCRIPT: bashPath(preflight),
      PREFLIGHT_LOG: bashPath(preflightLog),
      READY_TIMEOUT_SECONDS: "1",
      DOCKER_LOG: bashPath(dockerLog),
      DOCKER_UP_COUNT_FILE: bashPath(dockerUpCountFile),
      DOCKER_UP_FAILURES: String(dockerUpFailures),
      DOCKER_FAIL_UP_SERVICE: dockerFailUpService,
      DOCKER_FAIL_UP_TIMES: "1",
      RELEASE_SHA_FOR_TEST: "1".repeat(40),
    },
  });
  return { fixture, root, dockerLog, preflightLog, result, candidateSha: "1".repeat(40) };
}

function runRollbackFixture({
  dockerUpFailures = 1,
  phase = "canary",
  curlSucceeds = true,
  failStateMove = "",
  current = true,
  candidate = true,
  currentManifestOverrides = {},
  candidateManifestOverrides = {},
  targetManifestOverrides = {},
  preparedContents = "",
} = {}) {
  const bash = findBash();
  assert.ok(bash, "Bash is required for disposable rollback tests");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-rollback-"));
  const root = join(fixture, "root");
  const mocks = join(fixture, "bin");
  const currentSha = "2".repeat(40);
  const targetSha = "1".repeat(40);
  const apiEnvFile = `${bashPath(root)}/shared/env/api.env`;
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(mocks, { recursive: true });
  const candidateSha = "3".repeat(40);
  if (current) {
    seedRelease(root, currentSha, apiEnvFile, currentManifestOverrides);
    writeFileSync(join(root, "state", "current"), `${currentSha}\n`, { mode: 0o600 });
  }
  seedRelease(root, targetSha, apiEnvFile, targetManifestOverrides);
  if (candidate) {
    seedRelease(root, candidateSha, apiEnvFile, candidateManifestOverrides);
    writeFileSync(join(root, "state", "candidate"), `${candidateSha}\n`, { mode: 0o600 });
  }
  if (preparedContents) {
    writeFileSync(join(root, "state", "prepared"), preparedContents, { mode: 0o600 });
  }
  const dockerLog = join(fixture, "docker.log");
  const dockerUpCountFile = join(fixture, "docker-up-count");
  writeExecutable(join(mocks, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(mocks, "stat"), statMockScript());
  writeExecutable(join(mocks, "docker"), dockerMockScript());
  if (failStateMove) {
    writeExecutable(join(mocks, "mv"), `#!/usr/bin/env bash
if [[ "\${@: -1}" == */state/${failStateMove} ]]; then exit 73; fi
exec /usr/bin/mv "$@"
`);
  }
  writeExecutable(
    join(mocks, "curl"),
    curlSucceeds ? "#!/usr/bin/env bash\nexit 0\n" : "#!/usr/bin/env bash\nexit 22\n",
  );
  const result = spawnSync(bash, [
    "-c",
    bashFixtureCommand(),
    "_",
    bashPath(mocks),
    bashPath("deploy/scripts/rollback.sh"),
    "--release",
    targetSha,
    "--phase",
    phase,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      BRAND_PILOT_ROOT: bashPath(root),
      READY_TIMEOUT_SECONDS: "1",
      DOCKER_LOG: bashPath(dockerLog),
      DOCKER_UP_COUNT_FILE: bashPath(dockerUpCountFile),
      DOCKER_UP_FAILURES: String(dockerUpFailures),
      RELEASE_SHA_FOR_TEST: targetSha,
    },
  });
  return { fixture, root, dockerLog, result, currentSha, targetSha };
}

function runPromotionFixture({
  current = true,
  dockerFailUpService = "",
  dockerFailUpTimes = 1,
  dockerUpFailures = 0,
  curlSucceeds = true,
  failStateMove = "",
  failStateRemove = "",
  candidateManifestOverrides = {},
  currentManifestOverrides = {},
  dockerKillUpService = "caddy",
} = {}) {
  const bash = findBash();
  assert.ok(bash, "Bash is required for disposable promotion tests");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-promote-"));
  const root = join(fixture, "root");
  const mocks = join(fixture, "bin");
  const candidateSha = "1".repeat(40);
  const currentSha = "2".repeat(40);
  const apiEnvFile = `${bashPath(root)}/shared/env/api.env`;
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(mocks, { recursive: true });
  mkdirSync(join(root, "shared", "env"), { recursive: true });
  writeFileSync(join(root, "shared", "env", "api.env"), "TEST_ONLY=true\n", { mode: 0o600 });
  chmodSync(join(root, "shared", "env", "api.env"), 0o600);
  seedRelease(root, candidateSha, apiEnvFile, candidateManifestOverrides);
  writeFileSync(join(root, "state", "candidate"), `${candidateSha}\n`, { mode: 0o600 });
  writeFileSync(join(root, "state", "deploy.lock"), "", { mode: 0o600 });
  if (current) {
    seedRelease(root, currentSha, apiEnvFile, currentManifestOverrides);
    writeFileSync(join(root, "state", "current"), `${currentSha}\n`, { mode: 0o600 });
  }
  const backupMetadata = join(root, "state", "promotion-backup.env");
  const candidateManifest = join(root, "releases", candidateSha, "release.env");
  const manifestChecksum = createHash("sha256").update(readFileSync(candidateManifest)).digest("hex");
  const envChecksum = createHash("sha256")
    .update(readFileSync(join(root, "shared", "env", "api.env")))
    .digest("hex");
  const currentDigest = current
    ? `ghcr.io/dkskrn2/brand-pilot-api@sha256:${"b".repeat(64)}`
    : "NONE";
  writeFileSync(
    backupMetadata,
    [
      "BACKUP_SCHEMA=1",
      "PROVIDER_BACKUP_ID=test-provider-backup",
      "CADDY_BACKUP_ID=test-caddy-backup",
      `CADDY_DATA_SHA256=${"d".repeat(64)}`,
      `CURRENT_RELEASE_SHA=${current ? currentSha : "NONE"}`,
      `CURRENT_IMAGE_DIGEST=${currentDigest}`,
      `CANDIDATE_RELEASE_SHA=${candidateSha}`,
      `RELEASE_MANIFEST_SHA256=${manifestChecksum}`,
      `EXTERNAL_ENV_SHA256=${envChecksum}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(backupMetadata, 0o600);
  const curlLog = join(fixture, "curl.log");
  const dockerLog = join(fixture, "docker.log");
  const eventLog = join(fixture, "events.log");
  const dockerUpCountFile = join(fixture, "docker-up-count");
  const dockerKillSwitch = join(fixture, "docker-kill-switch");
  writeExecutable(join(mocks, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(mocks, "stat"), statMockScript());
  writeExecutable(join(mocks, "docker"), dockerMockScript());
  if (failStateMove) {
    writeExecutable(join(mocks, "mv"), `#!/usr/bin/env bash
if [[ "\${@: -1}" == */state/${failStateMove} ]]; then exit 73; fi
exec /usr/bin/mv "$@"
`);
  }
  if (failStateRemove) {
    writeExecutable(join(mocks, "rm"), `#!/usr/bin/env bash
if [[ "\${@: -1}" == */state/${failStateRemove} ]]; then exit 74; fi
exec /usr/bin/rm "$@"
`);
  }
  writeExecutable(join(mocks, "curl"), curlSucceeds ? `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CURL_LOG"
printf 'curl %s\\n' "$*" >> "$EVENT_LOG"
exit 0
` : `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CURL_LOG"
printf 'curl %s\\n' "$*" >> "$EVENT_LOG"
exit 22
`);
  const run = (...args) => spawnSync(bash, [
    "-c",
    bashFixtureCommand(),
    "_",
    bashPath(mocks),
    bashPath("deploy/scripts/promote.sh"),
    ...args,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      BRAND_PILOT_ROOT: bashPath(root),
      READY_TIMEOUT_SECONDS: "1",
      CURL_LOG: bashPath(curlLog),
      DOCKER_LOG: bashPath(dockerLog),
      EVENT_LOG: bashPath(eventLog),
      DOCKER_UP_COUNT_FILE: bashPath(dockerUpCountFile),
      DOCKER_UP_FAILURES: String(dockerUpFailures),
      DOCKER_FAIL_UP_SERVICE: dockerFailUpService,
      DOCKER_FAIL_UP_TIMES: String(dockerFailUpTimes),
      RELEASE_SHA_FOR_TEST: candidateSha,
      DOCKER_KILL_SWITCH: bashPath(dockerKillSwitch),
      DOCKER_KILL_UP_SERVICE: dockerKillUpService,
      PROMOTION_BACKUP_METADATA: bashPath(backupMetadata),
    },
  });
  const prepare = () => {
    const result = run("--prepare");
    if (result.status === 0) {
      for (const path of [curlLog, dockerLog, eventLog, dockerUpCountFile]) {
        rmSync(path, { force: true });
      }
    }
    return result;
  };
  return {
    fixture,
    root,
    curlLog,
    dockerLog,
    eventLog,
    run,
    prepare,
    candidateSha,
    currentSha,
    dockerKillSwitch,
  };
}

test("manifest parser rejects tag-only images, unknown keys, and duplicate keys before Compose up", () => {
  const fixtures = [
    runDeployFixture({ overrides: { API_IMAGE: "ghcr.io/dkskrn2/brand-pilot-api:latest" } }),
    runDeployFixture({ extraLines: ["UNEXPECTED_KEY=value"] }),
    runDeployFixture({ extraLines: ["RELEASE_SHA=2".padEnd(52, "2")] }),
    runDeployFixture({ overrides: { API_ENV_FILE: "/opt/brand-pilot/${UNSAFE}/api.env" } }),
  ];
  try {
    for (const fixture of fixtures) {
      assert.notEqual(fixture.result.status, 0, fixture.result.stdout);
      const dockerLog = existsSync(fixture.dockerLog) ? readFileSync(fixture.dockerLog, "utf8") : "";
      assert.doesNotMatch(dockerLog, /\bcompose\b.*\bup\b/);
    }
    assert.match(fixtures[0].result.stderr, /image_must_be_digest_pinned/);
    assert.match(fixtures[1].result.stderr, /manifest_unknown_key/);
    assert.match(fixtures[2].result.stderr, /manifest_duplicate_key/);
    assert.match(fixtures[3].result.stderr, /manifest_api_env_file_invalid/);
  } finally {
    for (const fixture of fixtures) rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a failed first canary stops the candidate and leaves current and candidate state absent", () => {
  const fixture = runDeployFixture();
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bcompose\b.*\bconfig --quiet\b/);
    assert.match(dockerLog, /\bcompose\b.*\bpull\b/);
    assert.match(dockerLog, /\bcompose\b.*\bup\b/);
    assert.match(dockerLog, /\bstop api-canary\b/);
    assert.match(dockerLog, /\brm -f api-canary\b/);
    assert.match(dockerLog, /\bstop caddy\b/);
    assert.match(dockerLog, /\brm -f caddy\b/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial first-canary up failure removes candidate and leaves state absent", () => {
  const fixture = runDeployFixture({ curlSucceeds: true, dockerUpFailures: 1 });
  try {
    assert.notEqual(fixture.result.status, 0);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bcompose\b.*\bup\b/);
    assert.match(dockerLog, /\bstop api-canary\b/);
    assert.match(dockerLog, /\brm -f api-canary\b/);
    assert.doesNotMatch(dockerLog, /\bup -d\b[^\n]*caddy/);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial candidate up failure removes only candidate and leaves exact current untouched", () => {
  const currentSha = "2".repeat(40);
  const fixture = runDeployFixture({
    curlSucceeds: true,
    dockerUpFailures: 1,
    currentSha,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(readFileSync(join(fixture.root, "state", "current"), "utf8"), `${currentSha}\n`);
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 1, dockerLog);
    assert.match(upLines[0], new RegExp(`/releases/${"1".repeat(40)}/`));
    assert.match(dockerLog, /\bstop api-canary\b/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-primary/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a canary deploy with current never recreates or stops api-primary", () => {
  const currentSha = "2".repeat(40);
  const fixture = runDeployFixture({ curlSucceeds: true, currentSha });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup\b[^\n]*api-canary/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-primary/);
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
    assert.equal(readFileSync(join(fixture.root, "state", "current"), "utf8"), `${currentSha}\n`);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${"1".repeat(40)}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a corrupt previous candidate aborts before any Compose action", () => {
  const fixture = runDeployFixture({
    curlSucceeds: true,
    currentSha: "2".repeat(40),
    corruptCandidate: true,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /state_(sha|file)_invalid|release_sha_invalid/);
    assert.equal(existsSync(fixture.dockerLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a new canary readiness failure restores the exact previous candidate runtime and state", () => {
  const previousCandidateSha = "3".repeat(40);
  const fixture = runDeployFixture({
    currentSha: "2".repeat(40),
    previousCandidateSha,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${previousCandidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 2, dockerLog);
    assert.match(upLines[0], new RegExp(`/releases/${"1".repeat(40)}/`));
    assert.match(upLines[1], new RegExp(`/releases/${previousCandidateSha}/`));
    assert.match(
      upLines[1],
      new RegExp(`CANDIDATE_API_IMAGE=.*@sha256:${"c".repeat(64)}`),
    );
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-primary/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial new-canary up failure restores the previous candidate without changing state", () => {
  const previousCandidateSha = "3".repeat(40);
  const fixture = runDeployFixture({
    curlSucceeds: true,
    dockerUpFailures: 1,
    currentSha: "2".repeat(40),
    previousCandidateSha,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${previousCandidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 2, dockerLog);
    assert.match(upLines[1], new RegExp(`/releases/${previousCandidateSha}/`));
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a successful new canary atomically replaces previous candidate state without touching Caddy", () => {
  const previousCandidateSha = "3".repeat(40);
  const fixture = runDeployFixture({
    curlSucceeds: true,
    currentSha: "2".repeat(40),
    previousCandidateSha,
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup -d\b[^\n]*api-canary/);
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a corrupt current state aborts before any Compose action", () => {
  const fixture = runDeployFixture({ curlSucceeds: true, corruptCurrent: true });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /state_(sha|file)_invalid|release_sha_invalid/);
    assert.equal(existsSync(fixture.dockerLog), false);
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial rollback up failure preserves state and restores current", () => {
  const fixture = runRollbackFixture();
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${"3".repeat(40)}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 2, dockerLog);
    assert.match(upLines[0], new RegExp(`/releases/${fixture.targetSha}/`));
    assert.match(upLines[1], new RegExp(`/releases/${"3".repeat(40)}/`));
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("canary rollback changes only api-canary and records the serving candidate", () => {
  const fixture = runRollbackFixture({ dockerUpFailures: 0 });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup\b[^\n]*api-canary/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-primary/);
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.targetSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("production rollback applies the complete target primary and Caddy release", () => {
  const fixture = runRollbackFixture({ dockerUpFailures: 0, phase: "production" });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bpull\b[^\n]*api-primary caddy/);
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 1, dockerLog);
    assert.match(
      upLines[0],
      new RegExp(`/releases/${fixture.targetSha}/.*api-primary caddy`),
    );
    assert.match(
      upLines[0],
      new RegExp(`CADDYFILE_PATH=.*/releases/${fixture.targetSha}/Caddyfile\\b`),
    );
    assert.match(upLines[0], new RegExp(`CADDY_IMAGE=.*@sha256:${"a".repeat(64)}`));
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-canary/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.targetSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "previous"), "utf8"),
      `${fixture.currentSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("failed rollback current write restores runtime and the complete old state", () => {
  const fixture = runRollbackFixture({
    dockerUpFailures: 0,
    phase: "production",
    failStateMove: "current",
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /atomic_write_failed/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${"3".repeat(40)}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*api-primary`));
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

for (const failure of [
  { name: "partial up", dockerUpFailures: 1, curlSucceeds: true },
  { name: "readiness", dockerUpFailures: 0, curlSucceeds: false },
]) {
  test(`production rollback ${failure.name} failure restores exact current primary and Caddy`, () => {
    const fixture = runRollbackFixture({
      phase: "production",
      dockerUpFailures: failure.dockerUpFailures,
      curlSucceeds: failure.curlSucceeds,
    });
    try {
      assert.notEqual(fixture.result.status, 0);
      assert.equal(
        readFileSync(join(fixture.root, "state", "current"), "utf8"),
        `${fixture.currentSha}\n`,
      );
      assert.equal(
        readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
        `${"3".repeat(40)}\n`,
      );
      const dockerLog = readFileSync(fixture.dockerLog, "utf8");
      const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
      assert.equal(upLines.length, 3, dockerLog);
      assert.match(
        upLines[0],
        new RegExp(`/releases/${fixture.targetSha}/.*api-primary caddy`),
      );
      assert.match(
        upLines[1],
        new RegExp(`/releases/${fixture.currentSha}/.*api-primary`),
      );
      assert.match(
        upLines[0],
        new RegExp(`CADDYFILE_PATH=.*/releases/${fixture.targetSha}/Caddyfile\\b`),
      );
      assert.match(
        upLines[2],
        new RegExp(`CADDYFILE_PATH=.*/releases/${fixture.currentSha}/Caddyfile\\b`),
      );
      assert.match(upLines[0], new RegExp(`CADDY_IMAGE=.*@sha256:${"a".repeat(64)}`));
      assert.match(upLines[2], new RegExp(`CADDY_IMAGE=.*@sha256:${"b".repeat(64)}`));
    } finally {
      rmSync(fixture.fixture, { recursive: true, force: true });
    }
  });
}

test("later promotion prepare preloads and validates without replacing runtime or release state", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.run("--prepare");
    assert.equal(prepare.status, 0, prepare.stderr);
    assert.equal(existsSync(fixture.curlLog), false);
    const dockerLog = existsSync(fixture.dockerLog) ? readFileSync(fixture.dockerLog, "utf8") : "";
    assert.match(dockerLog, /\bpull\b[^\n]*api-primary caddy/);
    assert.match(dockerLog, /\brun\b[^\n]*--network none[^\n]*\bvalidate\b/);
    assert.doesNotMatch(
      dockerLog,
      /\bcompose\b[^\n]*\b(up|stop|rm)\b[^\n]*(api-primary|api-canary|caddy)/,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.deepEqual(
      readdirSync(join(fixture.root, "state")).sort(),
      ["candidate", "current", "deploy.lock", "prepared", "promotion-backup.env"],
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("first promotion prepare preloads both images and prewarms only primary", () => {
  const fixture = runPromotionFixture({ current: false });
  try {
    const prepare = fixture.run("--prepare");
    assert.equal(prepare.status, 0, prepare.stderr);
    assert.equal(existsSync(fixture.curlLog), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup -d\b[^\n]*--wait[^\n]*api-primary/);
    assert.match(dockerLog, /\bpull\b[^\n]*api-primary caddy/);
    assert.doesNotMatch(dockerLog, /\bcompose\b[^\n]*\b(up|stop|rm)\b[^\n]*caddy/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-canary/);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.deepEqual(
      readdirSync(join(fixture.root, "state")).sort(),
      ["candidate", "deploy.lock", "prepared", "promotion-backup.env"],
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("failed first promotion prepare removes only prewarmed primary and preserves candidate", () => {
  const fixture = runPromotionFixture({ current: false, dockerUpFailures: 1 });
  try {
    const prepare = fixture.run("--prepare");
    assert.notEqual(prepare.status, 0);
    assert.match(readFileSync(fixture.dockerLog, "utf8"), /\bstop api-primary\b/);
    assert.match(readFileSync(fixture.dockerLog, "utf8"), /\brm -f api-primary\b/);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("promotion commit requires explicit DNS cutover confirmation before Docker", () => {
  const fixture = runPromotionFixture();
  try {
    const commit = fixture.run("--commit");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /dns_cutover_confirmation_required/);
    assert.equal(existsSync(fixture.dockerLog), false);
    assert.equal(existsSync(fixture.curlLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("confirmed promotion applies production Caddy before polling primary and mutating state", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.equal(commit.status, 0, commit.stderr);
    const curlLog = readFileSync(fixture.curlLog, "utf8");
    assert.match(curlLog, /https:\/\/api\.danbammsg\.co\.kr\/ready/);
    assert.doesNotMatch(curlLog, /canary-api\.danbammsg\.co\.kr/);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup\b[^\n]*api-primary/);
    assert.doesNotMatch(dockerLog, /\bup\b[^\n]*api-canary/);
    assert.doesNotMatch(dockerLog, /\bcompose\b[^\n]*\s+pull(?:\s|$)/);
    assert.match(dockerLog, /\bup\b[^\n]*--pull never[^\n]*api-primary/);
    assert.match(dockerLog, /\bup\b[^\n]*--pull never[^\n]*caddy/);
    assert.match(dockerLog, /\bup\b[^\n]*caddy/);
    const caddyUp = dockerLog.split(/\r?\n/).find((line) => /\bup -d\b[^\n]*caddy/.test(line));
    assert.ok(caddyUp, dockerLog);
    assert.match(
      caddyUp,
      new RegExp(`CADDYFILE_PATH=.*/releases/${fixture.candidateSha}/Caddyfile\\b`),
    );
    assert.doesNotMatch(caddyUp, /Caddyfile\.canary/);
    const events = readFileSync(fixture.eventLog, "utf8");
    assert.ok(
      events.indexOf("docker compose") < events.indexOf("curl "),
      events,
    );
    assert.ok(
      events.lastIndexOf(" caddy") < events.indexOf("curl "),
      events,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "previous"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a failed promotion restores the exact current primary and Caddy release", () => {
  const fixture = runPromotionFixture({ dockerFailUpService: "caddy" });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 4, dockerLog);
    assert.match(upLines[0], new RegExp(`/releases/${fixture.candidateSha}/.*api-primary`));
    assert.match(upLines[1], new RegExp(`/releases/${fixture.candidateSha}/.*caddy`));
    assert.match(
      upLines[2],
      new RegExp(`/releases/${fixture.currentSha}/.*api-primary`),
    );
    assert.match(
      upLines[3],
      new RegExp(`PRIMARY_API_IMAGE=.*@sha256:${"b".repeat(64)}`),
    );
    assert.match(
      readFileSync(fixture.curlLog, "utf8"),
      /--resolve api\.danbammsg\.co\.kr:443:127\.0\.0\.1/,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a failed first promotion leaves candidate and no current state", () => {
  const fixture = runPromotionFixture({ current: false, dockerFailUpService: "caddy" });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bstop api-primary\b/);
    assert.match(dockerLog, /\brm -f api-primary\b/);
    assert.doesNotMatch(dockerLog, /\b(stop|rm)\b[^\n]*api-canary/);
    const caddyRestore = dockerLog.split(/\r?\n/).findLast(
      (line) => /\bup -d\b[^\n]*caddy/.test(line),
    );
    assert.ok(caddyRestore, dockerLog);
    assert.match(caddyRestore, /CADDYFILE_PATH=.*Caddyfile\.canary/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("mutated or symlinked immutable release files are rejected before promotion network access", (t) => {
  const mutated = runPromotionFixture();
  try {
    writeFileSync(
      join(mutated.root, "releases", mutated.candidateSha, "Caddyfile.canary"),
      "mutated\n",
    );
    const result = mutated.run("--prepare");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release_integrity/);
    assert.equal(existsSync(mutated.curlLog), false);
  } finally {
    rmSync(mutated.fixture, { recursive: true, force: true });
  }

  const linked = runPromotionFixture();
  const caddyPath = join(linked.root, "releases", linked.candidateSha, "Caddyfile");
  const targetPath = join(linked.fixture, "outside-Caddyfile");
  try {
    writeFileSync(targetPath, "outside\n");
    unlinkSync(caddyPath);
    try {
      symlinkSync(targetPath, caddyPath);
    } catch (error) {
      if (error?.code === "EPERM") {
        t.diagnostic("file symlink creation unavailable on this Windows host");
        return;
      }
      throw error;
    }
    const result = linked.run("--prepare");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release_(file|integrity).*invalid|release_symlink_forbidden/);
    assert.equal(existsSync(linked.curlLog), false);
  } finally {
    rmSync(linked.fixture, { recursive: true, force: true });
  }
});

test("a successful canary atomically records candidate without creating current", () => {
  const fixture = runDeployFixture({ curlSucceeds: true });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.equal(readFileSync(join(fixture.root, "state", "candidate"), "utf8"), `${"1".repeat(40)}\n`);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const caddyUp = dockerLog.split(/\r?\n/).find((line) => /\bup -d\b[^\n]*caddy/.test(line));
    assert.ok(caddyUp, dockerLog);
    assert.match(
      caddyUp,
      new RegExp(`CADDYFILE_PATH=.*/releases/${"1".repeat(40)}/Caddyfile\\.canary\\b`),
    );
    assert.match(
      readFileSync(fixture.preflightLog, "utf8"),
      new RegExp(`/releases/${"1".repeat(40)}/Caddyfile\\.canary\\b`),
    );
    assert.deepEqual(
      readdirSync(join(fixture.root, "state")).sort(),
      ["candidate", "deploy.lock"],
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("atomic_write leaves a complete state file and no temporary siblings", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for disposable deployment tests");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-state-"));
  const destination = join(fixture, "candidate");
  try {
    const result = spawnSync(bash, [
      "-c",
      'source "$1"; atomic_write "$2" "$3"$\'\\n\' 600',
      "_",
      bashPath("deploy/scripts/lib.sh"),
      bashPath(destination),
      "1".repeat(40),
    ], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(destination, "utf8"), `${"1".repeat(40)}\n`);
    assert.deepEqual(readdirSync(fixture), ["candidate"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("manifest rejects identical canary and primary hosts before Docker", () => {
  const fixture = runDeployFixture({
    overrides: {
      CANARY_HOST: "api.danbammsg.co.kr",
      PRIMARY_HOST: "api.danbammsg.co.kr",
    },
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /manifest_hosts_must_differ/);
    assert.equal(existsSync(fixture.dockerLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("promotion commit requires a candidate-bound prepared proof before Docker", () => {
  const fixture = runPromotionFixture();
  try {
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /promotion_not_prepared/);
    assert.equal(existsSync(fixture.dockerLog), false);
    assert.equal(existsSync(fixture.curlLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("promotion rejects a stale or tampered prepared proof before Docker", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    writeFileSync(
      join(fixture.root, "state", "prepared"),
      `RELEASE_SHA=${fixture.candidateSha}\nPREPARATION_FINGERPRINT=${"0".repeat(64)}\n`,
      { mode: 0o600 },
    );
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /promotion_prepared_proof_mismatch/);
    assert.equal(existsSync(fixture.dockerLog), false);
    assert.equal(existsSync(fixture.curlLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("failed current state write restores runtime and leaves old state truthful", () => {
  const fixture = runPromotionFixture({ failStateMove: "current" });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /atomic_write_failed/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*api-primary`));
    assert.match(
      readFileSync(fixture.curlLog, "utf8"),
      /--resolve api\.danbammsg\.co\.kr:443:127\.0\.0\.1/,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("failed candidate cleanup restores the journaled pre-transition state", () => {
  const fixture = runPromotionFixture({ failStateRemove: "candidate" });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /candidate_state_cleanup_failed/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(
      dockerLog,
      new RegExp(`/releases/${fixture.currentSha}/.*\\bup -d\\b`),
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("restoration failure is explicit and preserves the old state truth", () => {
  const fixture = runPromotionFixture({
    dockerFailUpService: "caddy",
    dockerFailUpTimes: 2,
  });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.equal(commit.status, 70);
    assert.match(commit.stderr, /error=recovery_failed/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("prepare preloads both images, validates production Caddy offline, and records proof", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.run("--prepare");
    assert.equal(prepare.status, 0, prepare.stderr);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bpull\b[^\n]*api-primary caddy/);
    assert.match(
      dockerLog,
      /\brun\b[^\n]*--pull never[^\n]*--network none[^\n]*Caddyfile[^\n]*\bvalidate\b/,
    );
    const proofPath = join(fixture.root, "state", "prepared");
    assert.equal(existsSync(proofPath), true);
    const proof = readFileSync(proofPath, "utf8");
    assert.match(proof, new RegExp(`^RELEASE_SHA=${fixture.candidateSha}$`, "m"));
    assert.match(proof, /^PREPARATION_FINGERPRINT=[a-f0-9]{64}$/m);
    assert.equal(existsSync(fixture.curlLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("recovery paths never suppress Docker restoration failures", () => {
  for (const path of [
    "deploy/scripts/deploy.sh",
    "deploy/scripts/promote.sh",
    "deploy/scripts/rollback.sh",
  ]) {
    assert.doesNotMatch(read(path), /docker[\s\S]{0,240}\|\|\s*true/, path);
  }
  const lib = read("deploy/scripts/lib.sh");
  assert.match(
    lib,
    /reconcile_transition_or_fail[\s\S]*error=recovery_failed[\s\S]*exit 70/,
  );
  assert.match(read("deploy/scripts/promote.sh"), /reconcile_transition_or_fail/);
  assert.match(read("deploy/scripts/rollback.sh"), /reconcile_transition_or_fail/);
});

test("compose topology rejects missing markers and ports on any non-Caddy service", () => {
  assert.throws(
    () => assertComposeTopology(`services:
  api-primary:
    image: api
  worker:
    image: worker
  caddy:
    image: caddy
`),
    /api-canary/,
  );
  assert.throws(
    () => assertComposeTopology(`services:
  api-primary:
    image: api
  api-canary:
    image: api
`),
    /caddy/,
  );
  assert.throws(
    () => assertComposeTopology(`services:
  api-primary:
    image: api
  api-canary:
    image: api
  worker:
    image: worker
    ports:
      - "9000:9000"
  caddy:
    image: caddy
    ports:
      - "80:80"
`),
    /worker.*ports/,
  );
  assert.throws(
    () => assertComposeTopology(`services:
  api-primary:
    image: api
  api-canary:
    image: api
  worker:
    image: worker
    ports: ["9000:9000"]
  caddy:
    image: caddy
`),
    /worker.*ports/,
  );
  assert.doesNotThrow(() => assertComposeTopology(`services:
  api-primary:
    image: api
    # ports:
  api-canary:
    image: api
    # ports:
  worker:
    image: worker
  caddy:
    image: caddy
    ports:
      - "80:80"
`));
});

test("Caddy log detection catches directives but not comments or longer words", () => {
  assert.equal(hasCaddyLogDirective("# log {\nlogger example\n"), false);
  assert.equal(hasCaddyLogDirective("log\n"), true);
  assert.equal(hasCaddyLogDirective("  log default\n"), true);
  assert.equal(hasCaddyLogDirective("log {\n  output stdout\n}\n"), true);
});

test("shell tracing detection covers common activation forms without matching comments", () => {
  for (const script of [
    "set -x\n",
    "set -x; echo unsafe\n",
    "set -eux\n",
    "set -eux || exit 1\n",
    "set -o xtrace\n",
    "set -o xtrace && echo unsafe\n",
    "#!/usr/bin/env -S bash -x\n",
    "#!/bin/bash --xtrace\n",
    "bash -x deploy.sh\n",
    "bash -x; echo unsafe\n",
    "bash --xtrace deploy.sh\n",
  ]) {
    assert.equal(hasShellTracing(script), true, script);
  }
  assert.equal(hasShellTracing("# set -x\necho safe # bash -x deploy.sh\nset +x\n"), false);
});

test("transition journal is durable and reconciled by every locked deployment entrypoint", () => {
  const lib = read("deploy/scripts/lib.sh");
  assert.match(lib, /transition\.journal/);
  assert.match(lib, /reconcile_transition/);
  assert.match(lib, /sync\s+-f/);
  for (const path of [
    "deploy/scripts/deploy.sh",
    "deploy/scripts/promote.sh",
    "deploy/scripts/rollback.sh",
    "deploy/scripts/preflight.sh",
  ]) {
    const script = read(path);
    const lockIndex = script.indexOf("flock -n 9");
    const reconcileIndex = script.indexOf("reconcile_transition");
    assert.ok(lockIndex >= 0, `${path} must acquire deploy.lock`);
    assert.ok(reconcileIndex > lockIndex, `${path} must reconcile after acquiring deploy.lock`);
  }
});

test("promotion rejects current and candidate host drift before Docker or state mutation", () => {
  const fixture = runPromotionFixture({
    currentManifestOverrides: {
      CANARY_HOST: "old-canary-api.danbammsg.co.kr",
    },
  });
  try {
    const result = fixture.run("--prepare");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /promotion_hosts_mismatch/);
    assert.equal(existsSync(fixture.dockerLog), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("an abrupt promotion exit after runtime activation is recovered on the next entrypoint", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    writeFileSync(fixture.dockerKillSwitch, "kill\n");
    const killed = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(killed.status, 0);
    assert.equal(existsSync(join(fixture.root, "state", "transition.journal")), true);

    const recovered = fixture.run("--prepare");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(join(fixture.root, "state", "transition.journal")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*api-primary`));
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*caddy`));
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial promotion state write is rolled back from its durable journal", () => {
  const fixture = runPromotionFixture();
  const journal = join(fixture.root, "state", "transition.journal");
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    writeFileSync(
      journal,
      [
        "JOURNAL_SCHEMA=1",
        "OPERATION=promote",
        "DEPLOYMENT_PHASE=production",
        "TRANSITION_PHASE=state_mutation",
        `FROM_CURRENT=${fixture.currentSha}`,
        `FROM_CANDIDATE=${fixture.candidateSha}`,
        "FROM_PREVIOUS=NONE",
        "FROM_PREPARED=1",
        `TO_RELEASE=${fixture.candidateSha}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(journal, 0o600);
    writeFileSync(join(fixture.root, "state", "previous"), `${fixture.currentSha}\n`, { mode: 0o600 });
    writeFileSync(join(fixture.root, "state", "current"), `${fixture.candidateSha}\n`, { mode: 0o600 });

    const recovered = fixture.run("--prepare");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(journal), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a first-promotion journal restores canary-only Caddy and removes primary", () => {
  const fixture = runPromotionFixture({ current: false });
  const journal = join(fixture.root, "state", "transition.journal");
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    writeFileSync(
      journal,
      [
        "JOURNAL_SCHEMA=1",
        "OPERATION=promote",
        "DEPLOYMENT_PHASE=production",
        "TRANSITION_PHASE=runtime_mutation",
        "FROM_CURRENT=NONE",
        `FROM_CANDIDATE=${fixture.candidateSha}`,
        "FROM_PREVIOUS=NONE",
        "FROM_PREPARED=1",
        `TO_RELEASE=${fixture.candidateSha}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(journal, 0o600);

    const recovered = fixture.run("--prepare");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(journal), false);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /CADDYFILE_PATH=.*Caddyfile\.canary[^\n]*\bup -d\b[^\n]*caddy/);
    assert.match(dockerLog, /\bstop api-primary\b/);
    assert.match(dockerLog, /\brm -f api-primary\b/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a production rollback journal restores the prior current runtime and exact state", () => {
  const fixture = runPromotionFixture();
  const journal = join(fixture.root, "state", "transition.journal");
  try {
    writeFileSync(
      journal,
      [
        "JOURNAL_SCHEMA=1",
        "OPERATION=rollback",
        "DEPLOYMENT_PHASE=production",
        "TRANSITION_PHASE=state_mutation",
        `FROM_CURRENT=${fixture.currentSha}`,
        `FROM_CANDIDATE=${fixture.candidateSha}`,
        "FROM_PREVIOUS=NONE",
        "FROM_PREPARED=0",
        `TO_RELEASE=${fixture.candidateSha}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(journal, 0o600);
    writeFileSync(join(fixture.root, "state", "current"), `${fixture.candidateSha}\n`, { mode: 0o600 });
    writeFileSync(join(fixture.root, "state", "previous"), `${fixture.currentSha}\n`, { mode: 0o600 });

    const recovered = fixture.run("--prepare");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(journal), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*api-primary`));
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*caddy`));
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("all locked deployment entrypoints convert reconciliation failure to status 70", () => {
  for (const path of [
    "deploy/scripts/deploy.sh",
    "deploy/scripts/promote.sh",
    "deploy/scripts/rollback.sh",
    "deploy/scripts/preflight.sh",
  ]) {
    const script = read(path);
    const lockIndex = script.indexOf("flock -n 9");
    const reconcileIndex = script.indexOf("reconcile_transition_or_fail");
    assert.ok(lockIndex >= 0, `${path} must acquire deploy.lock`);
    assert.ok(
      reconcileIndex > lockIndex,
      `${path} must fail closed through reconcile_transition_or_fail after locking`,
    );
  }
  assert.match(
    read("deploy/scripts/lib.sh"),
    /reconcile_transition_or_fail[\s\S]*error=recovery_failed[\s\S]*exit 70/,
  );
});

test("deploy rejects host drift against current or resident candidate before Docker", () => {
  const currentSha = "2".repeat(40);
  const previousCandidateSha = "3".repeat(40);
  const fixtures = [
    runDeployFixture({
      currentSha,
      overrides: { CANARY_HOST: "new-canary-api.danbammsg.co.kr" },
    }),
    runDeployFixture({
      previousCandidateSha,
      overrides: { PRIMARY_HOST: "new-api.danbammsg.co.kr" },
    }),
  ];
  try {
    for (const fixture of fixtures) {
      assert.notEqual(fixture.result.status, 0);
      assert.match(fixture.result.stderr, /release_hosts_mismatch/);
      assert.equal(existsSync(fixture.dockerLog), false);
    }
  } finally {
    for (const fixture of fixtures) {
      rmSync(fixture.fixture, { recursive: true, force: true });
    }
  }
});

test("rollback rejects target host drift and empty production state before Docker", () => {
  const drift = runRollbackFixture({
    dockerUpFailures: 0,
    phase: "production",
    targetManifestOverrides: { PRIMARY_HOST: "old-api.danbammsg.co.kr" },
  });
  const empty = runRollbackFixture({
    dockerUpFailures: 0,
    phase: "production",
    current: false,
    candidate: false,
  });
  try {
    assert.notEqual(drift.result.status, 0);
    assert.match(drift.result.stderr, /release_hosts_mismatch/);
    assert.equal(existsSync(drift.dockerLog), false);
    assert.notEqual(empty.result.status, 0);
    assert.match(empty.result.stderr, /production_rollback_requires_runtime_state/);
    assert.equal(existsSync(empty.dockerLog), false);
  } finally {
    rmSync(drift.fixture, { recursive: true, force: true });
    rmSync(empty.fixture, { recursive: true, force: true });
  }
});

test("repeated first promotion prepare preserves the exact old proof on abrupt failure", () => {
  const fixture = runPromotionFixture({
    current: false,
    dockerKillUpService: "api-primary",
  });
  try {
    const first = fixture.prepare();
    assert.equal(first.status, 0, first.stderr);
    const proofPath = join(fixture.root, "state", "prepared");
    const originalProof = readFileSync(proofPath);
    writeFileSync(fixture.dockerKillSwitch, "kill\n");

    const killed = fixture.run("--prepare");
    assert.notEqual(killed.status, 0);
    assert.equal(existsSync(proofPath), true);
    assert.deepEqual(readFileSync(proofPath), originalProof);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("successful canary rollback invalidates any candidate-bound prepared proof", () => {
  const fixture = runRollbackFixture({
    dockerUpFailures: 0,
    phase: "canary",
    preparedContents: "stale-candidate-proof\n",
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.equal(existsSync(join(fixture.root, "state", "prepared")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("interrupted transition recovery clears rather than rebinds a stale prepared proof", () => {
  const fixture = runPromotionFixture();
  const staleCandidateSha = "3".repeat(40);
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    seedRelease(
      fixture.root,
      staleCandidateSha,
      `${bashPath(fixture.root)}/shared/env/api.env`,
    );
    writeFileSync(
      join(fixture.root, "state", "candidate"),
      `${staleCandidateSha}\n`,
      { mode: 0o600 },
    );
    writeTransitionJournal(fixture.root, {
      operation: "rollback",
      deploymentPhase: "canary",
      fromCurrent: fixture.currentSha,
      fromCandidate: staleCandidateSha,
      fromPrepared: "1",
      toRelease: staleCandidateSha,
    });

    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /promotion_backup_candidate_mismatch/);
    assert.equal(existsSync(join(fixture.root, "state", "prepared")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("reconciliation rejects journaled host drift before Docker and retains the journal", () => {
  const fixture = runPromotionFixture({
    currentManifestOverrides: {
      CANARY_HOST: "old-canary-api.danbammsg.co.kr",
    },
  });
  try {
    const journal = writeTransitionJournal(fixture.root, {
      operation: "promote",
      deploymentPhase: "production",
      fromCurrent: fixture.currentSha,
      fromCandidate: fixture.candidateSha,
      fromPrepared: "0",
      toRelease: fixture.candidateSha,
    });
    const result = fixture.run("--prepare");
    assert.equal(result.status, 70);
    assert.match(result.stderr, /error=recovery_failed/);
    assert.equal(existsSync(journal), true);
    assert.equal(existsSync(fixture.dockerLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});
