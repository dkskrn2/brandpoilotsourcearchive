# Brand Pilot Ubuntu API and worker deployment

This runbook moves the Brand Pilot API/Caddy runtime and immutable worker image
definitions to one Ubuntu host. It assumes there are **no external customers**
and no continuity-critical webhook traffic yet. The first release starts only
API + Caddy: no db:migrate, worker profile, scheduler, or publication. Keep the
current Vercel API available for at least **48 hours** as the rollback target.

LM Studio is not used. Tailscale is the **management plane only** for private
SSH, code transfer, and operations: **private SSH, never public ingress**. Do
not enable a Tailscale exit node, Funnel, Serve, subnet routing, or any other
public routing; public OAuth and webhook DNS must never resolve to a Tailscale
IP.

Placeholders such as `<PUBLIC_IPV4>`, `<TAILSCALE_IP_OR_NAME>`, `<RUN_ID>`,
`<RELEASE_SHA>`, and `<GITHUB_OWNER>` must be replaced deliberately. Commands
labelled Ubuntu console, Windows PowerShell, or `bpdeploy` must be run in that
environment only.

The operator boundary is deliberate:

- `[Ubuntu 관리자 콘솔/기존 sudo 관리자]` means the physical Ubuntu console
  or an already-authorized administrator account. Use it only for OS, network,
  root-owned configuration, bootstrap, reboot, and root-level port inspection.
- `[bpdeploy Tailscale SSH]` means an SSH session over Tailscale as `bpdeploy`.
  **bpdeploy has no sudo by design.** Do not grant it broad sudo access. Its
  Docker group membership is already root-equivalent and must be treated as a
  privileged operational capability.

## 1. Freeze the scope and stable public hostname

Before moving traffic, attach `api.danbammsg.co.kr` to the current Vercel API.
While DNS still targets Vercel, configure and test all of these exact values:

```text
VITE_API_BASE_URL=https://api.danbammsg.co.kr
KAKAO_REDIRECT_URI=https://api.danbammsg.co.kr/auth/kakao/callback
META_OAUTH_REDIRECT_URI=https://api.danbammsg.co.kr/auth/meta/callback
META_TRENDS_OAUTH_REDIRECT_URI=https://api.danbammsg.co.kr/auth/meta/trends/callback
META_WEBHOOK_URL=https://api.danbammsg.co.kr/webhooks/meta/instagram
```

Test Kakao login, Instagram/Meta login, trends login, and the Meta webhook
verification/delivery path before the move. In the Kakao and Meta provider
consoles, add or update the allowed callback, domain, and webhook entries.
Existing application keys can generally be reused: there is **no blanket key
reissue**. Preserve the exact existing `CREDENTIAL_ENCRYPTION_KEY`; changing it
would make stored credentials unreadable. Rotate only a key that is exposed, revoked, or provider-required.
Record any provider-mandated rotation separately.
In short: no blanket key reissue.

Copy environment values deliberately, one variable at a time. **Do not copy**
a developer `.env` wholesale and do not carry development-only values into
production.

The fixed first-move controls are:

```text
LOCAL_SCHEDULER_ENABLED=false
INSTAGRAM_PUBLISH_ENABLED=false
AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=false
AUTOMATED_CONTENT_ENABLED=false
CONTENT_PROPOSALS_ENABLED=false
DM_WORKERS_ENABLED=false
DEV_AUTH_ENABLED=false
DB_POOL_MAX=3
```

The release contains 9 digest-pinned Codex worker image keys, 10 profile-only
worker services, and one separately digest-pinned publish scheduler service.
No worker or scheduler starts with the API/Caddy deployment. Section 13 is the
worker activation gate; Section 14 is the separate publish scheduler gate.
Publication and database schema changes remain out of scope until their own approvals.

Keep the frontend and API DNS owners separate. `app.danbammsg.co.kr` remains a
Vercel custom domain. `api.danbammsg.co.kr` and
`canary-api.danbammsg.co.kr` are the public API hosts and eventually resolve to
the public Ubuntu IPv4. Publish AAAA only when the host also has a working
public Ubuntu IPv6 route and matching firewall policy.

## 2. Network prerequisites

Confirm all of the following before installing software:

- Ubuntu 24.04 LTS, `amd64`, with current security updates.
- A static LAN IP or a DHCP reservation for the Ubuntu machine.
- A real public IPv4. Compare the router WAN address with an external IP check.
  If they differ, investigate double NAT or CGNAT with the ISP before continuing.
- The router forwards only TCP 80/443 to the static LAN IP: never TCP 22, 4000,
  or 5432.
- If the public address is dynamic, define a tested dynamic public IP / DDNS
  update method and its recovery owner.
- `canary-api.danbammsg.co.kr` and later `api.danbammsg.co.kr` have DNS A
  records to the public Ubuntu IPv4. Do not publish an AAAA record without a
  working public Ubuntu IPv6 route and firewall policy.
- ISP/router/firewall paths allow inbound 80 and 443. Caddy ACME needs public
  reachability to issue and renew certificates.
- API port 4000 is Docker-internal `expose` only. PostgreSQL 5432 is likewise
  not published by this stack. Neither port is a router, UFW, or public service
  exception.

Useful read-only checks:

### [Ubuntu 관리자 콘솔/기존 sudo 관리자] Network diagnostics

```bash
dpkg --print-architecture
. /etc/os-release && printf '%s %s\n' "$ID" "$VERSION_ID"
ip -brief address
curl -4 --fail https://ifconfig.me
sudo ss -lntp
```

Record the router WAN IPv4, Ubuntu LAN IPv4, intended public IPv4/IPv6, DNS
values, and the person able to change the router. The router forwards only TCP
80/443. Operational rule: never forward TCP 22, 4000, or 5432.

## 3. Tailscale and OpenSSH

### [Ubuntu 관리자 콘솔/기존 sudo 관리자] 3.1 Initial setup

Use the physical/local Ubuntu console for the initial setup:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=brand-pilot-ubuntu
tailscale status
sudo adduser --disabled-password --gecos "" bpdeploy
sudo install -d -m 700 -o bpdeploy -g bpdeploy /home/bpdeploy/.ssh
```

No exit node, No Funnel, no public Tailscale routing. Note the Tailscale IP/name
without publishing it.

The stable device names are `brand-pilot-dev-windows` and
`brand-pilot-ubuntu`. On every operator run, use `tailscale status` to confirm
the current device identity, address, online state, and expected owner before
SSH. Do not hard-code Tailscale IP addresses in scripts, deployment manifests,
DNS records, or long-lived operator commands; addresses can change. Use the
device name when MagicDNS is enabled, or copy the current address from that
specific `tailscale status` result for the one interactive session.

### 3.2 Windows key

In Windows PowerShell:

```powershell
ssh-keygen -t ed25519 -a 100 -f "$env:USERPROFILE\.ssh\brand-pilot-ubuntu" -C "brand-pilot-ubuntu"
Get-Content "$env:USERPROFILE\.ssh\brand-pilot-ubuntu.pub"
```

Transfer only the `.pub` line through the Ubuntu console or another already
trusted console. Do not send the private key. On the Ubuntu console, paste the
public key in place of `<WINDOWS_ED25519_PUBLIC_KEY>`:

#### [Ubuntu 관리자 콘솔/기존 sudo 관리자] Install the public key

```bash
printf '%s\n' '<WINDOWS_ED25519_PUBLIC_KEY>' |
  sudo tee /home/bpdeploy/.ssh/authorized_keys >/dev/null
sudo chown bpdeploy:bpdeploy /home/bpdeploy/.ssh/authorized_keys
sudo chmod 600 /home/bpdeploy/.ssh/authorized_keys
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

The last command prints the host fingerprint. Compare it with the first Windows
SSH prompt over Tailscale. Stop on a mismatch.

```powershell
ssh -i "$env:USERPROFILE\.ssh\brand-pilot-ubuntu" bpdeploy@<TAILSCALE_IP_OR_NAME>
```

### [Ubuntu 관리자 콘솔/기존 sudo 관리자] 3.3 Harden sshd without losing access

Keep the Ubuntu console and the first working SSH session open. Create a drop-in
with `sudoedit /etc/ssh/sshd_config.d/90-brand-pilot.conf`:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers bpdeploy
```

Validate before reloading:

```bash
sudo sshd -t
sudo systemctl reload ssh
sudo systemctl status ssh --no-pager
```

Open a second Windows SSH session and verify it works before closing either
existing session. Re-check the host fingerprint after any OS reinstall.

### [Ubuntu 관리자 콘솔/기존 sudo 관리자] 3.4 UFW and router

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw deny 22/tcp
sudo ufw deny 4000/tcp
sudo ufw deny 5432/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

The router forwards only TCP 80/443 and never TCP 22, 4000, or 5432. The
interface-specific SSH allow precedes the public deny: verify the resulting UFW
rule order while the physical console and an existing Tailscale session remain
open. Verify public denial from an external network, not only from the LAN.

### 3.5 Windows operations

First run `tailscale status` and confirm `brand-pilot-dev-windows` and
`brand-pilot-ubuntu`; then use the current Tailscale name/address for
administration:

```powershell
ssh -i "$env:USERPROFILE\.ssh\brand-pilot-ubuntu" bpdeploy@<TAILSCALE_IP_OR_NAME>
scp -i "$env:USERPROFILE\.ssh\brand-pilot-ubuntu" .\release.env .\release.env.sha256 "bpdeploy@<TAILSCALE_IP_OR_NAME>:/opt/brand-pilot/incoming/"
```

Prefer Git for source and deployment assets and `scp` only for exact release
artifacts. Never copy a private key, developer `.env`, or unverified archive.

## [Ubuntu 관리자 콘솔/기존 sudo 관리자] 4. Install Docker from the official repository

Run on Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker bpdeploy
```

Membership in the Docker group is **root-equivalent**. Protect the bpdeploy SSH
key and do not add unrelated users. Open a **new SSH session** so group
membership takes effect, then verify:

```bash
docker version
docker compose version
docker run --rm hello-world
```

## [Ubuntu 관리자 콘솔/기존 sudo 관리자] 5. Bootstrap the filesystem

The script is root-required, refuses non-Ubuntu-24.04/non-amd64 machines,
requires `bpdeploy`, rejects managed symlinks/path escapes, and is safe to rerun.
It creates no secret or environment file.

If the repository is already checked out:

```bash
cd /opt/brand-pilot/repo/brand_poilot
sudo ./deploy/scripts/bootstrap-ubuntu.sh
```

For the first bootstrap, copy only the reviewed script to `/tmp`, run it, then
remove the temporary copy:

```powershell
scp -i "$env:USERPROFILE\.ssh\brand-pilot-ubuntu" .\brand_poilot\deploy\scripts\bootstrap-ubuntu.sh "bpdeploy@<TAILSCALE_IP_OR_NAME>:/tmp/bootstrap-ubuntu.sh"
```

```bash
sudo install -m 0755 /tmp/bootstrap-ubuntu.sh /usr/local/sbin/brand-pilot-bootstrap
sudo /usr/local/sbin/brand-pilot-bootstrap
sudo rm -f /tmp/bootstrap-ubuntu.sh
sudo find /opt/brand-pilot -maxdepth 2 -type d -printf '%M %u:%g %p\n'
```

Expected directories:

```text
/opt/brand-pilot/repo                 0750 bpdeploy:bpdeploy
/opt/brand-pilot/incoming             0750 bpdeploy:bpdeploy
/opt/brand-pilot/releases             0750 bpdeploy:bpdeploy
/opt/brand-pilot/state                0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared               0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared/env           0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared/codex         0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared/codex-accounts 0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared/codex-accounts/primary   0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared/codex-accounts/secondary 0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared/codex-accounts/primary/generated_images   0700 bpdeploy:bpdeploy
/opt/brand-pilot/shared/codex-accounts/secondary/generated_images 0700 bpdeploy:bpdeploy
```

## 6. Source and production environment

### [bpdeploy Tailscale SSH] Check out the exact source and create api.env

The bootstrap made both the repository and shared environment directories
private and owned by `bpdeploy`, so these commands require neither privilege
escalation nor ownership changes:

```bash
git clone https://github.com/dkskrn2/main.git /opt/brand-pilot/repo
cd /opt/brand-pilot/repo
git fetch --prune origin
git checkout --detach <RELEASE_SHA>
test "$(git rev-parse HEAD)" = "<RELEASE_SHA>"
test -x brand_poilot/deploy/scripts/deploy.sh
```

Create the production file from the reviewed deployment example, then edit each
value deliberately:

```bash
install -m 0600 \
  /opt/brand-pilot/repo/brand_poilot/deploy/env/api.env.example \
  /opt/brand-pilot/shared/env/api.env
${EDITOR:-vi} /opt/brand-pilot/shared/env/api.env
chmod 600 /opt/brand-pilot/shared/env/api.env
stat -c '%a %U:%G %n' /opt/brand-pilot/shared/env/api.env
```

Review every production variable in the file:

```text
NODE_ENV HOST PORT COOKIE_SECURE CORS_ALLOWED_ORIGINS DEV_AUTH_ENABLED
AUTH_FRONTEND_URL SUPABASE_DATABASE_URL DB_POOL_MAX
DB_POOL_IDLE_TIMEOUT_MS DB_POOL_CONNECTION_TIMEOUT_MS DB_SSL_CA_BASE64
SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_BRAND_ASSETS_BUCKET
WORKER_API_TOKEN ADMIN_SERVICE_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN
CRON_SECRET SOURCE_CRAWL_BATCH_SIZE
SOURCE_CRAWL_DISCOVERY_LIMIT SOURCE_CRAWL_TIME_BUDGET_MS
LOCAL_SCHEDULER_ENABLED WORKER_CODEX_MAX_CONCURRENCY
WORKER_CODEX_DM_RESERVED_SLOTS CREDENTIAL_ENCRYPTION_KEY
INSTAGRAM_PUBLISH_ENABLED IMAGE_JOB_COOLDOWN_MS META_GRAPH_VERSION META_APP_ID
META_APP_SECRET META_OAUTH_REDIRECT_URI META_TRENDS_OAUTH_REDIRECT_URI
META_WEBHOOK_VERIFY_TOKEN DM_PROFILE_REFRESH_AFTER_HOURS KAKAO_REST_API_KEY
KAKAO_CLIENT_SECRET KAKAO_REDIRECT_URI BRAND_PILOT_DEV_BRAND_ID
BRAND_PILOT_DEV_WORKSPACE_ID BLOB_READ_WRITE_TOKEN
AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED
AI_CONTENT_DAILY_GENERATION_LIMIT AI_CONTENT_DAILY_DOWNLOAD_LIMIT
PUBLISH_ARTIFACT_ALLOWED_ORIGINS
```

Required safe values include:

```text
NODE_ENV=production
COOKIE_SECURE=true
DEV_AUTH_ENABLED=false
DB_POOL_MAX=3
LOCAL_SCHEDULER_ENABLED=false
INSTAGRAM_PUBLISH_ENABLED=false
AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=false
```

Keep the original `CREDENTIAL_ENCRYPTION_KEY`. Set `DB_SSL_CA_BASE64` only when
the database provider requires a private CA; use the strict canonical Base64 of
the CA certificate. Otherwise leave it empty and use the operating system trust
store. Do not paste command output containing environment values into tickets,
chat, logs, or shell history. Do not run `env`, `set`, or any Compose command
that renders the environment. On the secret-bearing machine, every Compose
validation must use `config --quiet`; never render the resolved configuration.

Do not copy a development `.env` wholesale. Do not add `api.env` to Git.

### Shared environment ownership and release boundary

The operator, not an image or release script, creates the twelve fixed production
environment files:

```text
/opt/brand-pilot/shared/env/api.env
/opt/brand-pilot/shared/env/dm-worker-1.env
/opt/brand-pilot/shared/env/dm-worker-2.env
/opt/brand-pilot/shared/env/wiki-worker-1.env
/opt/brand-pilot/shared/env/content-proposal-worker-1.env
/opt/brand-pilot/shared/env/brand-intelligence-worker-1.env
/opt/brand-pilot/shared/env/subject-analysis-worker-1.env
/opt/brand-pilot/shared/env/image-worker-1.env
/opt/brand-pilot/shared/env/card-news-worker-1.env
/opt/brand-pilot/shared/env/blog-worker-1.env
/opt/brand-pilot/shared/env/marketing-worker-1.env
/opt/brand-pilot/shared/env/publish-scheduler.env
```

`/opt/brand-pilot/shared/env` must remain owner `bpdeploy`, mode 700. Every file
must remain owner `bpdeploy`, mode 600. Create the worker files from their
reviewed examples before running preflight, even while their Compose profiles
remain disabled:

```bash
install -m 0600 deploy/env/dm-worker.env.example \
  /opt/brand-pilot/shared/env/dm-worker-1.env
install -m 0600 deploy/env/dm-worker.env.example \
  /opt/brand-pilot/shared/env/dm-worker-2.env
install -m 0600 deploy/env/wiki-worker.env.example \
  /opt/brand-pilot/shared/env/wiki-worker-1.env
install -m 0600 deploy/env/content-proposal-worker.env.example \
  /opt/brand-pilot/shared/env/content-proposal-worker-1.env
install -m 0600 deploy/env/brand-intelligence-worker.env.example \
  /opt/brand-pilot/shared/env/brand-intelligence-worker-1.env
install -m 0600 deploy/env/subject-analysis-worker.env.example \
  /opt/brand-pilot/shared/env/subject-analysis-worker-1.env
install -m 0600 deploy/env/image-worker.env.example \
  /opt/brand-pilot/shared/env/image-worker-1.env
install -m 0600 deploy/env/card-news-worker.env.example \
  /opt/brand-pilot/shared/env/card-news-worker-1.env
install -m 0600 deploy/env/blog-worker.env.example \
  /opt/brand-pilot/shared/env/blog-worker-1.env
install -m 0600 deploy/env/marketing-worker.env.example \
  /opt/brand-pilot/shared/env/marketing-worker-1.env
install -m 0600 deploy/env/publish-scheduler.env.example \
  /opt/brand-pilot/shared/env/publish-scheduler.env
chmod 700 /opt/brand-pilot/shared/env
chmod 600 /opt/brand-pilot/shared/env/*.env
stat -c '%a %U:%G %n' /opt/brand-pilot/shared/env \
  /opt/brand-pilot/shared/env/*.env
```

Review and replace every placeholder without printing values. An image pull,
container replacement, release installation, promotion, or rollback must never
create, modify, or delete shared env files. Those operations may only read the
fixed paths. Back up and restore them through a separately approved,
secret-safe operator procedure.

No worker environment file accepts `OPENAI_API_KEY`, an embedding API key, or a
direct model endpoint. AI authentication comes only from the persisted ChatGPT
login described below.

Set `CONTENT_PROPOSAL_WORKER_API_TOKEN` to one dedicated secret in both
`api.env` and `content-proposal-worker-1.env`. It must not reuse
`WORKER_API_TOKEN`. Preflight compares only SHA-256 digests of the two complete
environment lines and fails closed when either value is missing, still a
placeholder, or different. Do not print either file or token while diagnosing
this check.

OAuth/provider changes follow
[`OAUTH_CUTOVER.md`](./OAUTH_CUTOVER.md). In particular,
`AUTH_FRONTEND_URL=https://app.danbammsg.co.kr` and
`CORS_ALLOWED_ORIGINS=https://app.danbammsg.co.kr` are exact production values;
do not add a temporary or arbitrary origin.

## 7. Publish and obtain an immutable release

The workflow
`.github/workflows/publish-brand-pilot-server-images.yml` verifies the source,
builds the linux/amd64 API image, nine Codex CLI worker images, and the standalone
publish scheduler image in CI, pushes
them to GHCR, captures every immutable image digest plus the Caddy digest, and
uploads:

```text
artifact: brand-pilot-api-release-<RELEASE_SHA>
release.env
release.env.sha256
```

This closes the Docker image build gap: Ubuntu does not build the API locally.

Trigger the workflow for `main` after the exact commit is present:

```bash
gh workflow run publish-brand-pilot-server-images.yml --ref main
gh run list --workflow publish-brand-pilot-server-images.yml --limit 10
gh run watch <RUN_ID> --exit-status
```

Download the artifact for the exact SHA on a trusted operator machine. On the
trusted operator machine, use Git Bash or WSL for these POSIX commands:

```bash
rm -rf ./brand-pilot-release-download
mkdir ./brand-pilot-release-download
gh run download <RUN_ID> \
  --name "brand-pilot-api-release-<RELEASE_SHA>" \
  --dir ./brand-pilot-release-download
cd ./brand-pilot-release-download
sha256sum --check release.env.sha256
grep -Fx "RELEASE_SHA=<RELEASE_SHA>" release.env
required_ghcr_images=(
  API_IMAGE
  PUBLISH_SCHEDULER_IMAGE
  DM_WORKER_IMAGE
  WIKI_WORKER_IMAGE
  CONTENT_PROPOSAL_WORKER_IMAGE
  BRAND_INTELLIGENCE_WORKER_IMAGE
  SUBJECT_ANALYSIS_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  MARKETING_WORKER_IMAGE
)
for image_key in "${required_ghcr_images[@]}"; do
  grep -Eq "^${image_key}=ghcr\\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$" release.env
done
grep -Eq '^CADDY_IMAGE=docker\.io/library/caddy@sha256:[0-9a-f]{64}$' release.env
```

Transfer exactly those two verified files to
`/opt/brand-pilot/incoming/`.

### [bpdeploy Tailscale SSH] Protect and verify the release artifact

Immediately restrict both received files before reading either one. Confirm
that each is owned by `bpdeploy` with mode `600`, then repeat the checksum and
release identity checks:

```bash
cd /opt/brand-pilot/incoming
chmod 600 /opt/brand-pilot/incoming/release.env /opt/brand-pilot/incoming/release.env.sha256
stat -c '%U %a %n' /opt/brand-pilot/incoming/release.env /opt/brand-pilot/incoming/release.env.sha256
test "$(stat -c '%U %a' /opt/brand-pilot/incoming/release.env)" = "bpdeploy 600"
test "$(stat -c '%U %a' /opt/brand-pilot/incoming/release.env.sha256)" = "bpdeploy 600"
sha256sum --check release.env.sha256
release_sha="$(sed -n 's/^RELEASE_SHA=//p' release.env)"
test "$release_sha" = "<RELEASE_SHA>"
test "$(git -C /opt/brand-pilot/repo rev-parse HEAD)" = "$release_sha"
required_image_keys=(
  API_IMAGE
  PUBLISH_SCHEDULER_IMAGE
  DM_WORKER_IMAGE
  WIKI_WORKER_IMAGE
  CONTENT_PROPOSAL_WORKER_IMAGE
  BRAND_INTELLIGENCE_WORKER_IMAGE
  SUBJECT_ANALYSIS_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  MARKETING_WORKER_IMAGE
  CADDY_IMAGE
)
for image_key in "${required_image_keys[@]}"; do
  grep -Eq "^${image_key}=.+@sha256:[0-9a-f]{64}$" release.env
done
```

The deployment script creates and verifies
`/opt/brand-pilot/releases/<RELEASE_SHA>/release-integrity.sha256`. Never edit a
release directory after installation.

Every release manifest has separate `CANARY_HOST` and `PRIMARY_HOST` values.
`CANARY_HOST` and `PRIMARY_HOST` must be different; deployment rejects an
identical pair before Docker is used.

For a private GHCR package, create a short-lived, least privilege token with
read-only package access. Avoid broad repository/admin scopes:

```bash
read -r -s -p 'GHCR read token: ' GHCR_TOKEN
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username '<GITHUB_OWNER>' --password-stdin
unset GHCR_TOKEN
```

Do not place the token on a command line or in a file. Revoke it when it is no
longer required.

### [bpdeploy Tailscale SSH] 7.1 Persist and verify the ChatGPT login

Every production AI path uses `@openai/codex@0.145.0` in its immutable worker
image. There is no direct OpenAI API key path. Manual content proposal, image,
card-news, blog, and reel workers use the two persisted aliases `primary` and
`secondary` under `/opt/brand-pilot/shared/codex-accounts`. Those five workers
mount the parent at `/codex-accounts` and automatically try `secondary` only
when `primary` returns a verified usage-exhaustion failure before producing any
accepted output. The brand-intelligence worker mounts only the authenticated
`primary` profile at `/codex-accounts/primary`; it does not use automatic account
failover. Other workers keep their existing single `/codex` contract.

The pool and both profile directories must be `bpdeploy:bpdeploy` mode `700`.
Each `auth.json` must be a regular, non-symlink file owned by
`bpdeploy:bpdeploy` with mode `600`. Containers run with the same numeric
UID/GID so Codex can refresh login state. Never copy `auth.json` into an image,
archive, release, ticket, chat, or log. Never put account email addresses in
source, configuration, or logs.

After the verified manifest is present and its private GHCR login is active,
perform the one-time non-overwriting transition before running the new bootstrap.
Existing containers keep their already-open bind mount; do not restart unrelated
workers during this transition:

```bash
legacy_home=/opt/brand-pilot/shared/codex
account_pool=/opt/brand-pilot/shared/codex-accounts
test -d "$legacy_home"
test ! -L "$legacy_home"
test ! -e "$account_pool"
install -d -m 0700 -o bpdeploy -g bpdeploy "$account_pool"
test ! -e "$account_pool/primary"
mv -- "$legacy_home" "$account_pool/primary"
install -d -m 0700 -o bpdeploy -g bpdeploy "$account_pool/secondary"
install -d -m 0700 -o bpdeploy -g bpdeploy "$account_pool/primary/generated_images"
install -d -m 0700 -o bpdeploy -g bpdeploy "$account_pool/secondary/generated_images"
```

The guards stop instead of overwriting either profile. Run the interactive login
only for a profile whose persisted login is missing or expired:

```bash
release_manifest=/opt/brand-pilot/incoming/release.env
brand_intelligence_image="$(sed -n 's/^BRAND_INTELLIGENCE_WORKER_IMAGE=//p' "$release_manifest")"
test -n "$brand_intelligence_image"
test "${brand_intelligence_image#*@sha256:}" != "$brand_intelligence_image"
docker pull --quiet "$brand_intelligence_image" >/dev/null

runtime_uid="$(id -u bpdeploy)"
runtime_gid="$(id -g bpdeploy)"
for profile in primary secondary; do
  profile_home="/opt/brand-pilot/shared/codex-accounts/$profile"
  docker run --rm -it --network host \
    --user "$runtime_uid:$runtime_gid" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 128 \
    --tmpfs /tmp:size=64m,mode=1777 \
    --mount "type=bind,src=$profile_home,dst=/codex" \
    --env CODEX_HOME=/codex \
    --entrypoint codex \
    "$brand_intelligence_image" login
done
```

Complete the ChatGPT/Google flow in Ubuntu Chrome. Then restore and verify the
fixed metadata without reading the credential:

```bash
runtime_uid="$(id -u bpdeploy)"
runtime_gid="$(id -g bpdeploy)"
chmod 700 /opt/brand-pilot/shared/codex-accounts
for profile in primary secondary; do
  profile_home="/opt/brand-pilot/shared/codex-accounts/$profile"
  auth_file="$profile_home/auth.json"
  chmod 700 "$profile_home"
  chmod 600 "$auth_file"
  test "$(stat -c '%U:%G %a' "$profile_home")" = "bpdeploy:bpdeploy 700"
  test "$(stat -c '%U:%G %a' "$auth_file")" = "bpdeploy:bpdeploy 600"

  if ! docker run --rm --pull never \
    --user "$runtime_uid:$runtime_gid" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 128 \
    --tmpfs /tmp:size=64m,mode=1777 \
    --mount "type=bind,src=$profile_home,dst=/codex" \
    --env CODEX_HOME=/codex \
    --entrypoint codex \
    "$brand_intelligence_image" login status >/dev/null 2>&1; then
    printf '%s\n' 'codex_login_status=failed' >&2
    exit 1
  fi
done
printf '%s\n' 'codex_login_status=ok'
```

The deployment preflight repeats the same owner/mode checks and suppresses all
`codex login status` output. Never diagnose login by printing, parsing, or
grepping `auth.json`, and never run a Compose command that renders resolved
environment values.

As of 2026-07-30, this Ubuntu ChatGPT login and the non-output status check were
completed successfully. That proves only the persisted login. Worker deployment
and production onboarding QA remain pending.

## 8. Canary deployment

Create:

```text
canary-api.danbammsg.co.kr -> <PUBLIC_IPV4>, TTL 300
```

### [bpdeploy Tailscale SSH] Deploy and verify the canary

Wait until public resolvers return the intended address and ports 80/443 are
reachable. Then:

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/deploy.sh /opt/brand-pilot/incoming/release.env --phase canary
./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr
```

The first canary starts `api-canary` and `caddy`; it does not create
`api-primary`. It mounts `Caddyfile.canary`, which contains only the canary host
and does not request a certificate for `api.danbammsg.co.kr`. This prevents
primary-host ACME failures while that hostname still points to Vercel. On later
releases, canary deployment changes only `api-canary`; the current
`api-primary` and production Caddy configuration remain untouched.
`state/candidate` is the canary SHA. `state/current` is the serving primary SHA,
and `state/previous` is created only when an existing primary is successfully
replaced.

The edge is intentionally narrow. Caddy is the only service bound to host ports
80/443. Its hostname site blocks obtain and renew ACME certificates, redirect
plain HTTP to HTTPS automatically, send HSTS, reject request bodies over 32MB,
and apply bounded client and upstream timeouts before proxying to the
Docker-internal API port 4000.

Before public DNS propagation is complete, a hosts override may prove that this
operator machine reaches the intended Ubuntu edge without changing the machine's
hosts file. The authoritative canary A/AAAA record must already target Ubuntu
and ACME issuance must have succeeded; do not use `--insecure` to bypass TLS:

```bash
curl --resolve canary-api.danbammsg.co.kr:443:<PUBLIC_IPV4> --fail https://canary-api.danbammsg.co.kr/health
curl --resolve canary-api.danbammsg.co.kr:443:<PUBLIC_IPV4> --fail https://canary-api.danbammsg.co.kr/ready
```

This is only the pre-propagation path check; it does not prove public DNS.
After public DNS propagation, remove the override and verify the actual public
resolver path from an external network:

```bash
dig +short canary-api.danbammsg.co.kr A @1.1.1.1
dig +short canary-api.danbammsg.co.kr A @8.8.8.8
dig +short canary-api.danbammsg.co.kr AAAA @1.1.1.1
curl --fail https://canary-api.danbammsg.co.kr/health
curl --fail https://canary-api.danbammsg.co.kr/ready
```

The A answers must equal the public Ubuntu IPv4. The AAAA answer must either be
empty or equal the verified public Ubuntu IPv6. A Tailscale address is a release
blocker in either public answer.

Acceptance commands:

```bash
curl --fail https://canary-api.danbammsg.co.kr/health
curl --fail https://canary-api.danbammsg.co.kr/ready
curl -sS -D - -o /dev/null -H 'Origin: https://app.danbammsg.co.kr' https://canary-api.danbammsg.co.kr/health
curl -sS -D - -o /dev/null -H 'Origin: https://evil.example' https://canary-api.danbammsg.co.kr/health
curl -sS -o /dev/null -w '%{http_code}\n' https://canary-api.danbammsg.co.kr/auth/meta/dev-complete
```

Expected: `/health` and `/ready` are 200; the allowed CORS origin is exact; the
evil origin receives no allow-origin header; the dev route is 404. Also verify
there were no database mutations, no migration, no worker lease, and no
scheduler/publication activity.

Inspect bounded operational evidence without printing container environments:

```bash
release_sha="$(cat /opt/brand-pilot/state/candidate)"
release_dir="/opt/brand-pilot/releases/$release_sha"
docker compose -p brand-pilot -f "$release_dir/compose.production.yml" --env-file "$release_dir/release.env" config --quiet
docker compose -p brand-pilot -f "$release_dir/compose.production.yml" --env-file "$release_dir/release.env" ps
docker inspect --format '{{.Name}} {{.Config.Image}} {{.RestartCount}}' brand-pilot-api-canary-1
```

### [Ubuntu 관리자 콘솔/기존 sudo 관리자] Inspect ports and reboot

Confirm that only public ports 80/443 are bound, then reboot Ubuntu and wait for
Docker:

```bash
sudo ss -lntp
sudo reboot
```

### [bpdeploy Tailscale SSH] Verify after reboot and rehearse rollback

After reconnecting over Tailscale:

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker logs --tail 100 brand-pilot-api-canary-1
```

Review logs before sharing them; do not copy secret-bearing output.

For the first-release rollback rehearsal, there is no `state/previous`. Use the
candidate explicitly:

```bash
candidate_sha="$(cat /opt/brand-pilot/state/candidate)"
./scripts/rollback.sh --release "$candidate_sha" --phase canary
./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr
```

Canary rollback also invalidates `state/prepared`. If the rolled-back canary will
be promoted, rerun `./scripts/promote.sh --prepare` before commit.

On a later release, a failed new canary restores the prior candidate runtime and
state. Production `--previous` is valid only after a successful replacement has
created `state/previous`.

## 9. DNS cutover

At least 24 hours earlier, lower the `api.danbammsg.co.kr` TTL to 300 and record
the exact Vercel DNS record/value, resolver answers, and rollback owner. Change
only the API DNS during this cutover; the customer Vercel project is unchanged.

### [bpdeploy Tailscale SSH] 9.1 Prepare and prewarm primary

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/promote.sh --prepare
```

In every release, `--prepare` pulls and preloads both `api-primary` and `caddy`
under the deployment lock. It confirms that the local API image
`org.opencontainers.image.revision` label equals the candidate `RELEASE_SHA`,
confirms that the digest-pinned Caddy image is local, and validates the
production Caddyfile in the pinned Caddy image with `--pull never` and
`--network none`. The validation therefore cannot reach ACME, DNS, or any other
network service.

On the first release, `--prepare` starts and health-checks `api-primary` from
the candidate release. On a later release with an existing current release, it
leaves the running primary untouched. In both cases it validates
candidate state, immutable release integrity, hostnames, digests, and rollback
inputs. It then writes mode-600 `state/prepared`. That proof contains the
candidate `RELEASE_SHA` and a fingerprint bound to the `API_IMAGE` and
`CADDY_IMAGE` digests plus the checksum of `release-integrity.sha256`.
Preparation does not change Caddy, poll an external URL, or mutate
`state/current`, `state/previous`, or `state/candidate`.

The four locked deployment entrypoints, `deploy.sh`, `preflight.sh`,
`promote.sh`, and `rollback.sh`, acquire `state/deploy.lock` before they inspect
or reconcile `state/transition.journal`. Before any runtime mutation, the
mutating scripts durably create that mode 600 journal with the operation, phase,
target release, and the pre-transition values of `state/current`,
`state/candidate`, `state/previous`, and `state/prepared`. If a process is
interrupted, the next locked entrypoint reconciles the journal first: it restores
the recorded pre-transition current, candidate, and previous SHA state plus the
corresponding API/Caddy runtime before it starts the requested operation.
`state/prepared` is never restored from the journal. Recovery removes
`state/prepared` fail-closed because an interrupted runtime or rollback operation
invalidates the earlier preparation evidence.

The stable host contract is also release-invariant. `CANARY_HOST` and
`PRIMARY_HOST` must be different within one manifest. In addition,
`CANARY_HOST` and `PRIMARY_HOST` must each match between the current and
candidate releases. `deploy.sh`, `promote.sh`, `rollback.sh`, and journal
reconciliation enforce the same host pair across every current, candidate,
target, and recovery release they combine. Host drift is rejected before Docker
or state mutation. A hostname migration therefore needs its own DNS,
certificate, and rollback procedure; do not encode one as an ordinary
application release.

Confirm the prewarmed first-release primary locally without printing its
environment:

```bash
docker inspect --format '{{.Name}} {{.Config.Image}} {{.State.Health.Status}}' brand-pilot-api-primary-1
curl --fail https://canary-api.danbammsg.co.kr/ready
```

Do not run commit yet. A standalone `--commit` without
`--dns-cutover-confirmed` fails before Docker or any runtime/state change. This
fail-closed confirmation prevents accidentally requesting primary TLS before
the DNS cutover. `--commit --dns-cutover-confirmed` requires a valid
candidate-bound `state/prepared` proof, so always complete a successful
`--prepare` before changing DNS. Re-run `--prepare` if the candidate manifest,
image digests, or immutable release integrity changes.

### 9.2 Change DNS, confirm public resolvers, and commit

Change the A record for `api.danbammsg.co.kr` from the recorded Vercel value to
`<PUBLIC_IPV4>`. Do not change customer, admin, canary, or unrelated records.
Wait until both public resolvers return exactly `<PUBLIC_IPV4>`:

```bash
dig +short api.danbammsg.co.kr @1.1.1.1
dig +short api.danbammsg.co.kr @8.8.8.8
```

Only after both answers are correct, explicitly confirm that DNS has cut over:

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/promote.sh --commit --dns-cutover-confirmed
curl --fail https://api.danbammsg.co.kr/health
curl --fail https://api.danbammsg.co.kr/ready
openssl s_client -connect api.danbammsg.co.kr:443 -servername api.danbammsg.co.kr </dev/null 2>/dev/null |
  openssl x509 -noout -subject -issuer -dates
```

Confirmed commit verifies the candidate-bound proof and the already-local image
identities again. It starts or verifies the candidate `api-primary` and replaces
the canary-only edge with the production Caddy configuration using
`--pull never`; commit does not contact the registry. It then waits for the
external primary TLS `/ready` endpoint. In other words, it waits for the
primary TLS `/ready` response before it changes state. Only after readiness
does it transactionally preserve an older current value in `state/previous`,
atomically write `state/current`, and remove `state/candidate` and
`state/prepared`. Thus a successful state transition proves that the new public
TLS endpoint answered readiness rather than the former Vercel endpoint.

Verify from an external network:

- Kakao callback `/auth/kakao/callback`.
- Meta callback `/auth/meta/callback`.
- Meta trends callback `/auth/meta/trends/callback`.
- Meta webhook `/webhooks/meta/instagram`.
- Admin health and authentication.
- Customer application login, read-only navigation, and CORS.
- No scheduler, publication, worker, lease, or database mutation.

Observe for **60 minutes**: API 5xx, `/ready`, Caddy certificate errors, container
restart count, DB pool exhaustion/timeouts, OAuth errors, webhook validation,
credential decryption, and unexpected writes.

Cutover success requires all resolvers/certificate checks, OAuth/webhook/admin/
customer smoke, stable readiness, zero unexpected restarts, no pool exhaustion,
and no unexpected mutation for the whole observation window.

### 9.3 Failure and rollback

Restore the recorded Vercel DNS value immediately if readiness fails for five
minutes, any callback/webhook fails, credential decryption fails, DB pool
exhaustion appears, certificates fail, or any scheduler/publication/worker/DDL
mutation occurs. Verify 1.1.1.1 and 8.8.8.8 return the Vercel value and verify
the Vercel API again.

If the first confirmed commit fails, the script stops/removes its attempted
`api-primary`, restores the canary-only Caddy configuration from
`Caddyfile.canary`, leaves `state/candidate` intact, and creates no
`state/current`. Restore Vercel DNS, verify both public resolvers and the Vercel
API, then diagnose through the still-available canary.

More precisely, first promotion recovery restores `Caddyfile.canary` and removes
`api-primary`. Later promotion and production rollback recovery restore the
recorded pre-transition current primary and Caddy. Canary recovery restores the
recorded candidate. Every completed reconciliation restores the journaled
`state/current`, `state/candidate`, and `state/previous` SHA snapshot, removes
`state/prepared` fail-closed, and only then removes `state/transition.journal`.
After any interrupted-transition recovery, rerun `./scripts/promote.sh
--prepare` before commit; never reuse or reconstruct the former proof.

On a later release, a failed confirmed commit restores the exact current
primary and its production Caddy configuration and leaves both current and
candidate state available for recovery. If DNS already points to Ubuntu, verify
the restored current `/ready`; restore the recorded DNS value as well if the
service remains unhealthy.

Recovery is also fail-closed. If a runtime restoration command fails, or the
restored endpoint does not pass readiness, the script reports
`error=recovery_failed` and exits with status 70. Treat that as an active
incident: restore the recorded Vercel DNS value, verify both public resolvers,
and do not trust the Ubuntu runtime until its containers, Caddy configuration,
and `/ready` endpoint have been checked manually.

This applies both to an in-progress operation's failure trap and to a later
entrypoint that discovers a leftover journal: every locked entrypoint reports
`error=recovery_failed` and exits with status 70 when reconciliation fails. The
failure leaves `state/transition.journal` in place and blocks the requested
operation. The journal remains a mode 600, `bpdeploy`-owned recovery record. No
deployment operation may proceed until the underlying Docker,
release-integrity, host-pair, or readiness problem has been fixed and
reconciliation succeeds.

#### [bpdeploy Tailscale SSH] Inspect and retry interrupted-transition recovery

Do not print `api.env` or container environments. Inspect only the bounded
journal fields and runtime identity:

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
stat -c '%U %a %n' /opt/brand-pilot/state/transition.journal
grep -E '^(JOURNAL_SCHEMA|OPERATION|DEPLOYMENT_PHASE|TRANSITION_PHASE|FROM_CURRENT|FROM_CANDIDATE|FROM_PREVIOUS|FROM_PREPARED|TO_RELEASE)=' \
  /opt/brand-pilot/state/transition.journal
docker inspect --format '{{.Name}} {{.Config.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' \
  brand-pilot-api-primary-1 brand-pilot-api-canary-1 brand-pilot-caddy-1
```

Fix the reported Docker, immutable-release, or local readiness problem. Replace
`<VERIFIED_RELEASE_SHA>` below with an immutable release SHA whose directory and
manifest checksum were already verified. Use preflight as the recovery-only
entrypoint; it acquires the same lock and reconciles the leftover journal before
performing its ordinary checks:

```bash
./scripts/preflight.sh "/opt/brand-pilot/releases/<VERIFIED_RELEASE_SHA>/release.env"
test ! -e /opt/brand-pilot/state/transition.journal
for state_file in current candidate previous prepared; do
  if [ -e "/opt/brand-pilot/state/$state_file" ]; then
    stat -c '%U %a %n' "/opt/brand-pilot/state/$state_file"
  fi
done
```

Successful reconciliation must leave `state/prepared` absent. If promotion is
still intended, run the offline preparation again and inspect its newly created
proof before changing DNS or committing:

```bash
./scripts/promote.sh --prepare
stat -c '%U %a %n' /opt/brand-pilot/state/prepared
./scripts/promote.sh --commit --dns-cutover-confirmed
```

The operator must not delete `state/transition.journal` manually, rename it,
change its mode or owner, edit its `FROM_*` values, or run Docker Compose around
the scripts. Manual deletion is a recovery bypass: it discards the only durable
record that tells the entrypoints which runtime and state snapshot must be
restored. If the retry still fails, keep the journal intact, restore Vercel DNS
when applicable, collect the bounded evidence above, and fix the reported cause
before retrying the same preflight command.

For a later release with `state/previous`, roll the Ubuntu primary back:

#### [bpdeploy Tailscale SSH] Later-release production rollback

```bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/rollback.sh --previous --phase production
```

For the first all-Codex-worker release, `state/previous` may be the signed
legacy API-only release
`02aa2bcae3f66d494f16a26bec9055cac17464f9`. Keep that immutable release
directory and its original signed file set. The release validator recognizes
that exact SHA as `legacy-current`; `rollback.sh --previous --phase production`
still verifies its digest, revision, external `API_ENV_FILE`, host pair, and
readiness before committing the rollback. Do not retrofit worker manifest keys
or newer backup scripts into the legacy directory.

Production rollback requires an existing current or candidate runtime state.
When both `state/current` and `state/candidate` are absent, the script rejects
production rollback before Docker instead of inventing a runtime baseline.

For the first release there is no previous production SHA. DNS restoration to
Vercel is the production demotion; do not invent `state/previous`. Keep the
Ubuntu canary for diagnosis, or explicitly redeploy a verified release to the
canary phase. Keep the Vercel API available for at least 48 hours.

## 10. Final evidence and future releases

### [bpdeploy Tailscale SSH] Record release and service evidence

After successful cutover:

```bash
release_sha="$(cat /opt/brand-pilot/state/current)"
release_dir="/opt/brand-pilot/releases/$release_sha"
docker compose -p brand-pilot -f "$release_dir/compose.production.yml" --env-file "$release_dir/release.env" config --quiet
docker compose -p brand-pilot -f "$release_dir/compose.production.yml" --env-file "$release_dir/release.env" ps
docker inspect --format '{{.Name}} {{.Config.Image}} {{.RestartCount}} {{.State.Health.Status}}' \
  brand-pilot-api-primary-1 brand-pilot-api-canary-1 brand-pilot-caddy-1
grep -E '^(RELEASE_SHA|API_IMAGE|PUBLISH_SCHEDULER_IMAGE|DM_WORKER_IMAGE|WIKI_WORKER_IMAGE|CONTENT_PROPOSAL_WORKER_IMAGE|BRAND_INTELLIGENCE_WORKER_IMAGE|SUBJECT_ANALYSIS_WORKER_IMAGE|IMAGE_WORKER_IMAGE|CARD_NEWS_WORKER_IMAGE|BLOG_WORKER_IMAGE|MARKETING_WORKER_IMAGE|CADDY_IMAGE)=' \
  "$release_dir/release.env"
curl --fail https://api.danbammsg.co.kr/ready
```

### [Ubuntu 관리자 콘솔/기존 sudo 관리자] Record root-level port evidence

```bash
sudo ss -lntp
```

Record evidence that:

- The exact `RELEASE_SHA`, `API_IMAGE`, `PUBLISH_SCHEDULER_IMAGE`, nine worker image keys, and
  `CADDY_IMAGE` are immutable and digest-pinned.
- Every API, worker, and publish scheduler image has
  `org.opencontainers.image.revision=<RELEASE_SHA>`.
- Services are `api-primary`, `api-canary`, and `caddy`.
- All ten worker services remain behind explicit Compose profiles until their
  Section 13 gate, and `publish-scheduler-1` remains behind its Section 14 gate.
- Only TCP 80/443 are publicly bound by this stack.
- `LOCAL_SCHEDULER_ENABLED=false`, `INSTAGRAM_PUBLISH_ENABLED=false`,
  `AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=false`,
  `DEV_AUTH_ENABLED=false`, and DB pool maximum is 3.
- No database migration, worker, scheduler, or publication ran.
- The evidence explicitly records no database migration.
- OAuth, webhook, admin, CORS, customer smoke, reboot recovery, and rollback
  evidence are retained without secrets.

Do not print the resolved container environment to prove flags; verify the
reviewed mode-0600 source file locally and record only pass/fail evidence.

After 48 hours, a future API release uses the same immutable artifact,
canary verification, `--prepare`, DNS confirmation,
`--commit --dns-cutover-confirmed`, and rollback workflow. Worker deployment
remains disabled until the separate Section 13 gates cover each worker ID,
real job, lease, graceful shutdown, restart recovery, and rollback target. Do
not start a worker as part of the API DNS cutover.

## 11. AI content attachment lifecycle dark launch

The first rollout keeps
`AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=false` in the reviewed
mode-0600 source file, and both `api-canary` and `api-primary` force that same
safe value. Preflight accepts only the exact lowercase value `false`. Record
this pass/fail result in the final evidence without printing the resolved
environment.

The authenticated internal endpoint
`/internal/cron/ai-content-attachment-gc` is implemented-but-not-scheduled.
This release adds no cron call, systemd service/timer, or local scheduler
registration. Endpoint scheduling, alert-rule activation, and
`AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=true` each require a later
Operations/rollout approval.

While the flag is OFF, abandoned legacy uploads remain undiscoverable because
the legacy token flow creates no upload-session row. The abandoned-upload
discoverability guarantee begins only after approved upload-session issuance
and a full legacy-token TTL drain. Do not claim that dark launch alone closes
this residual risk.

Each approved future GC invocation emits a bounded
`ai_content_attachment_gc_completed` record. Its metric fields include
`sessions` scanned/claimed/confirmed/expired, `deletions`
claimed/started/succeeded/failed/retried/releasedUnstarted,
`leasesReclaimed`, `eligibleQueueDepth`,
`oldestEligiblePendingAgeSeconds`, `heldJobCount`, `oldestHeldAgeSeconds`,
`holdReasonCounts`, `attemptCountBuckets`, `deadLetterCount`, `durationMs`,
and `providerErrorCategories`. Never record Blob tokens, nonces, signed URLs,
or secret values.

Alert-rule wiring and activation are explicitly deferred until GC scheduling
is approved. At that later Operations gate, alert on any of:

- `deadLetterCount` greater than zero;
- `oldestEligiblePendingAgeSeconds` greater than 86,400 seconds (24 hours);
- any provider failure repeated for five consecutive scheduled runs.

For a threshold breach, keep issuance OFF or pause its activation, retain the
deletion obligations, capture only redacted run IDs and metric fields, inspect
the held-reason and attempt buckets, correct provider authorization or
availability, then run one explicitly approved bounded GC request. Do not
discard or manually mark jobs deleted. A dead letter requires named operator
ownership and evidence that the Blob was deleted or is already not found
before reconciliation.

Migration 065 is forward-only and is not rolled back. Application rollback is
flag OFF; cleanup obligations remain and must still converge through the later
approved GC operation. Activation evidence must therefore show the migration
is present, canary and primary remain healthy, the issuance flag change was
approved, the legacy-token TTL fully drained, and all three alert thresholds
and response ownership are active.

## 12. D rollout canary, backup, restore, and immediate rollback gate

This gate runs only after development is complete. The automated canary is
read-only: it never runs paid AI generation and never sends a real DM. It
never publishes to a real SNS channel. Keep `LOCAL_SCHEDULER_ENABLED=false` and
`INSTAGRAM_PUBLISH_ENABLED=false`; `/ready` must report scheduler, publishing,
and DM as disabled.

Prepare a mode-0600 Netscape cookie jar for an existing test operator session.
Do not put the cookie value on the command line or in evidence:

```bash
export CANARY_SESSION_COOKIE_FILE=/opt/brand-pilot/shared/canary/session.cookies
export CANARY_BRAND_ID=<TEST_BRAND_UUID>
./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr
```

The verifier reads `/health`, `/ready`, `/auth/me`, Brand Core, products, Wiki,
generation usage, and channel capabilities. It also checks allowed and denied
CORS, a Secure/HttpOnly/SameSite=Lax login cookie, the disabled development auth
route, DB readiness, and the safe flags. It performs no write request.

Before `promote.sh --prepare`, create the database provider backup and an
encrypted/provider-managed Caddy data backup outside these scripts. Record only
their identifiers and the Caddy data checksum:

```bash
candidate_sha="$(cat /opt/brand-pilot/state/candidate)"
./scripts/backup-state.sh \
  --provider-backup-id <PROVIDER_BACKUP_ID> \
  --caddy-backup-id <ENCRYPTED_CADDY_BACKUP_ID> \
  --caddy-data-sha256 <CADDY_DATA_SHA256> \
  --output "/opt/brand-pilot/state/backups/pre-promote-${candidate_sha}.env"
export PROMOTION_BACKUP_METADATA="/opt/brand-pilot/state/backups/pre-promote-${candidate_sha}.env"
./scripts/promote.sh --prepare
```

The metadata binds the current release SHA and image digest, candidate release
manifest checksum, external environment checksum, provider backup ID, and Caddy
backup ID. It never copies `api.env`, database URLs, OAuth secrets, credential
keys, access tokens, Caddy private keys, or other secret plaintext into an
archive. Promotion fails closed if the metadata no longer matches.

Restore rehearsal is allowed only into an explicitly named `*_restore_test`
database. The provider adapter must be a separately reviewed executable; the
database URL file, metadata, and row-count manifest must all be mode 0600:

```bash
export RESTORE_REHEARSAL_TEST_ONLY=I_UNDERSTAND_TEST_DATABASE_ONLY
export RESTORE_REHEARSAL_COMMAND=/opt/brand-pilot/ops/provider-restore-test-db
./scripts/restore-state.sh \
  --test-database-url-file /opt/brand-pilot/shared/restore/test-database.url \
  --backup-metadata "$PROMOTION_BACKUP_METADATA" \
  --expected-schema-version <LATEST_MIGRATION_FILE.sql> \
  --row-count-manifest /opt/brand-pilot/shared/restore/expected-row-counts.env
```

The rehearsal verifies the latest `schema_migrations` version and every
allowlisted `schema.table=count` entry. It refuses any database whose name does
not end in `_restore_test`.

Rollback uses the previous immutable image digest with the same external
`API_ENV_FILE`. Trigger immediate rollback on:

- OAuth repeated failure
- credential decryption failure
- duplicate DM or publish
- API interruption longer than 5 minutes
- migration mismatch

Record only checksums, immutable SHAs/digests, backup identifiers, safe canary
status, and row-count results. Never record cookies, tokens, database URLs, or
environment plaintext.

### Instagram publication activation (2026-08-03)

This dated gate supersedes only the publication-disabled instruction in the
earlier first-release baseline. Keep `LOCAL_SCHEDULER_ENABLED=false`, every
worker/profile gate unchanged, and set only
`INSTAGRAM_PUBLISH_ENABLED=true`. The API hostname remains
`https://api.danbammsg.co.kr`; this is not an API-address change. The canary
verification is read-only: make no unsolicited live Instagram post. Publishing
a generated artifact still requires a separately approved artifact and caption.

Before changing the shared environment, verify the exact regular file, owner,
mode, and single-key contract without printing its contents. Create a
recoverable mode-0600 backup under `state` and replace the one publication line
atomically:

```bash
api_env=/opt/brand-pilot/shared/env/api.env
backup=/opt/brand-pilot/state/api.env.instagram-publish-backup-<VERIFIED_RELEASE_SHA>
[[ -f "$api_env" && ! -L "$api_env" ]]
[[ "$(stat -c '%U:%G' "$api_env")" == "bpdeploy:bpdeploy" ]]
[[ "$(stat -c '%a' "$api_env")" == "600" ]]
[[ "$(grep -Ec '^INSTAGRAM_PUBLISH_ENABLED=' "$api_env")" == "1" ]]
[[ "$(grep -Ec '^LOCAL_SCHEDULER_ENABLED=false$' "$api_env")" == "1" ]]
[[ ! -e "$backup" ]]
cp --preserve=mode,ownership -- "$api_env" "$backup"
chmod 600 "$backup"

tmp_env="$(mktemp /opt/brand-pilot/shared/env/api.env.instagram-publish.XXXXXX)"
trap 'rm -f -- "$tmp_env"' EXIT
awk '/^INSTAGRAM_PUBLISH_ENABLED=/{print "INSTAGRAM_PUBLISH_ENABLED=true"; next} {print}' \
  "$api_env" > "$tmp_env"
chmod --reference="$api_env" "$tmp_env"
[[ "$(stat -c '%U:%G' "$tmp_env")" == "$(stat -c '%U:%G' "$api_env")" ]]
[[ "$(grep -Ec '^INSTAGRAM_PUBLISH_ENABLED=true$' "$tmp_env")" == "1" ]]
[[ "$(grep -Ec '^INSTAGRAM_PUBLISH_ENABLED=' "$tmp_env")" == "1" ]]
mv -- "$tmp_env" "$api_env"
trap - EXIT
```

Use the exact verified release. Preflight must accept publication enabled while
rejecting an enabled local scheduler or any other dark flag. Deploy canary only,
then run the authenticated read-only verifier:

```bash
cd /opt/brand-pilot/releases/<VERIFIED_RELEASE_SHA>
./scripts/preflight.sh "/opt/brand-pilot/releases/<VERIFIED_RELEASE_SHA>/release.env"
./scripts/deploy.sh /opt/brand-pilot/incoming/release.env --phase canary
export CANARY_SESSION_COOKIE_FILE=/opt/brand-pilot/shared/canary/session.cookies
export CANARY_BRAND_ID=<TEST_BRAND_UUID>
./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr
```

Canary `/ready` must report configuration/database OK, publishing enabled,
scheduler disabled, and DM disabled. The authenticated capability response must
show the connected Instagram professional account as publication-ready. Do not
call a generation, download, publish, or other write endpoint during this gate.

After the `api.env` mutation and successful canary, create a fresh provider
database backup and encrypted/provider-managed Caddy data backup. Then record
new promotion metadata so its `EXTERNAL_ENV_SHA256` binds the enabled
environment. Metadata created before the mutation is invalid and must not be
reused. The backup tools and restore-rehearsal rules in Section 12 still apply:

```bash
candidate_sha="$(cat /opt/brand-pilot/state/candidate)"
./scripts/backup-state.sh \
  --provider-backup-id <FRESH_PROVIDER_BACKUP_ID> \
  --caddy-backup-id <FRESH_ENCRYPTED_CADDY_BACKUP_ID> \
  --caddy-data-sha256 <FRESH_CADDY_DATA_SHA256> \
  --output "/opt/brand-pilot/state/backups/pre-instagram-promote-${candidate_sha}.env"
export PROMOTION_BACKUP_METADATA="/opt/brand-pilot/state/backups/pre-instagram-promote-${candidate_sha}.env"
```

Promote only the same immutable candidate after those checks and the fresh
metadata step pass:

```bash
./scripts/promote.sh --prepare
./scripts/promote.sh --commit --dns-cutover-confirmed
curl --fail https://api.danbammsg.co.kr/ready
```

If canary or primary verification fails, roll back to the previous immutable
release and restore the backed-up api.env. The historical release forces
publication off; restoring the backup also returns the shared configuration to
the prior state. Do not print or diff either environment file:

```bash
cd /opt/brand-pilot/releases/<VERIFIED_RELEASE_SHA>
./scripts/rollback.sh --previous --phase production
api_env=/opt/brand-pilot/shared/env/api.env
backup=/opt/brand-pilot/state/api.env.instagram-publish-backup-<VERIFIED_RELEASE_SHA>
rollback_env="$(mktemp /opt/brand-pilot/shared/env/api.env.rollback.XXXXXX)"
trap 'rm -f -- "$rollback_env"' EXIT
cp -- "$backup" "$rollback_env"
chmod --reference="$api_env" "$rollback_env"
[[ "$(stat -c '%U:%G' "$rollback_env")" == "$(stat -c '%U:%G' "$api_env")" ]]
[[ "$(grep -Ec '^INSTAGRAM_PUBLISH_ENABLED=false$' "$rollback_env")" == "1" ]]
[[ "$(grep -Ec '^INSTAGRAM_PUBLISH_ENABLED=' "$rollback_env")" == "1" ]]
mv -- "$rollback_env" "$api_env"
trap - EXIT
curl --fail https://api.danbammsg.co.kr/ready
```

## 13. Incremental Codex worker activation

This gate is separate from API DNS cutover. Do not begin it until the immutable
API release is current, Section 7.1 login checks pass, the remote/legacy worker
owner is known, and the rollback target is recorded. `COMPOSE_PROFILES` remains
unset so preflight can prove that a normal deploy cannot auto-start workers.

All worker root filesystems are read-only. The five manual-content workers mount
`/opt/brand-pilot/shared/codex-accounts` at `/codex-accounts`; generated-image
directories for both profiles are mode-0700, 512MB tmpfs mounts so generated
PNGs do not persist beside either `auth.json`. The brand-intelligence worker
mounts only `/opt/brand-pilot/shared/codex-accounts/primary` at
`/codex-accounts/primary`. Unrelated workers retain the single-profile `/codex`
mount.

### [bpdeploy Tailscale SSH] Prepare the immutable Compose command

```bash
unset COMPOSE_PROFILES
release_sha="$(cat /opt/brand-pilot/state/current)"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]
release_dir="/opt/brand-pilot/releases/$release_sha"
test -d "$release_dir"

export CODEX_ACCOUNT_POOL_ROOT_PATH=/opt/brand-pilot/shared/codex-accounts
export CODEX_HOME_PATH="$CODEX_ACCOUNT_POOL_ROOT_PATH/primary"
export CODEX_RUNTIME_UID="$(id -u bpdeploy)"
export CODEX_RUNTIME_GID="$(id -g bpdeploy)"

"$release_dir/scripts/preflight.sh" "$release_dir/release.env"

compose=(
  docker compose
  -p brand-pilot
  -f "$release_dir/compose.production.yml"
  --env-file "$release_dir/release.env"
)
"${compose[@]}" config --quiet

start_worker_profile() {
  local service="$1"
  "${compose[@]}" --profile "$service" up -d --no-deps --pull never "$service"
  "${compose[@]}" ps "$service"
}

stop_worker_profile() {
  local service="$1"
  "${compose[@]}" --profile "$service" stop -t 30 "$service"
  "${compose[@]}" --profile "$service" rm -f "$service"
}
```

These commands never render the resolved Compose configuration or container
environment. Review any application log locally before retaining a redacted
job/heartbeat line. Never include cookies, tokens, DB URLs, prompts containing
customer data, or `auth.json`.

The preflight above is the initial fail-closed deployment gate. Run it before
any rollout flag changes: `deploy.sh` and `preflight.sh` intentionally require
`AUTOMATED_CONTENT_ENABLED`, `CONTENT_PROPOSALS_ENABLED`, and
`DM_WORKERS_ENABLED` to be exactly `false`. Starting a profile-only worker
requires neither a flag change nor an API redeploy.

When a real job route requires one of those flags, obtain separate explicit
operator approval for that one key. In the same shell that owns the prepared
current-release `compose` array, update only the approved key in the external
mode-0600 `api.env` without printing the file, then recreate only
`api-primary` from the already-local immutable image:

```bash
rollout_flag='<APPROVED_ROLLOUT_FLAG>'
case "$rollout_flag" in
  AUTOMATED_CONTENT_ENABLED|CONTENT_PROPOSALS_ENABLED|DM_WORKERS_ENABLED) ;;
  *) printf '%s\n' 'invalid_rollout_flag' >&2; exit 1 ;;
esac

api_env=/opt/brand-pilot/shared/env/api.env
test "$(stat -c '%U:%G %a' "$api_env")" = "bpdeploy:bpdeploy 600"
test "$(grep -Ec "^${rollout_flag}=false$" "$api_env")" = "1"
test "$(grep -Ec '^(AUTOMATED_CONTENT_ENABLED|CONTENT_PROPOSALS_ENABLED|DM_WORKERS_ENABLED)=true$' "$api_env")" = "0"

sed -i -E "s/^${rollout_flag}=false$/${rollout_flag}=true/" "$api_env"
chmod 600 "$api_env"
test "$(stat -c '%U:%G %a' "$api_env")" = "bpdeploy:bpdeploy 600"
test "$(grep -Ec "^${rollout_flag}=true$" "$api_env")" = "1"
test "$(grep -Ec '^(AUTOMATED_CONTENT_ENABLED|CONTENT_PROPOSALS_ENABLED|DM_WORKERS_ENABLED)=true$' "$api_env")" = "1"

"${compose[@]}" up -d --no-deps --pull never --force-recreate api-primary
"${compose[@]}" ps api-primary
curl --fail --silent --show-error https://api.danbammsg.co.kr/ready >/dev/null
```

Do not run `deploy.sh` or `preflight.sh` while a rollout flag is `true`; that
failure is intentional. Do not enable a second rollout flag. After the bounded
job proof, or immediately if readiness or the job gate fails, restore the exact
safe value and recreate the same current `api-primary`:

```bash
test "$(grep -Ec "^${rollout_flag}=true$" "$api_env")" = "1"
sed -i -E "s/^${rollout_flag}=true$/${rollout_flag}=false/" "$api_env"
chmod 600 "$api_env"
test "$(stat -c '%U:%G %a' "$api_env")" = "bpdeploy:bpdeploy 600"
test "$(grep -Ec "^${rollout_flag}=false$" "$api_env")" = "1"
test "$(grep -Ec '^(AUTOMATED_CONTENT_ENABLED|CONTENT_PROPOSALS_ENABLED|DM_WORKERS_ENABLED)=false$' "$api_env")" = "3"

"${compose[@]}" up -d --no-deps --pull never --force-recreate api-primary
"${compose[@]}" ps api-primary
curl --fail --silent --show-error https://api.danbammsg.co.kr/ready >/dev/null
```

Record only the approved key name, change/recovery timestamps, readiness
result, and job evidence. Never record or render the rest of `api.env`. If the
exact-false recreation does not restore readiness, continue with the signed
production rollback procedure in Section 9.3.

### 13.1 Required activation order

1. Start only brand intelligence:

   ```bash
   start_worker_profile brand-intelligence-worker-1
   ```

   Submit one production onboarding URL/file job. Do not continue until its
   stable worker ID and `queued -> running -> completed` timestamps, saved Brand
   Core draft, re-entry behavior, duration, heartbeat, lease, and restart
   recovery are recorded. This onboarding QA is currently `pending`.

2. Start and verify subject analysis, then content proposal:

   ```bash
   start_worker_profile subject-analysis-worker-1
   ```

   Record one completed product/service analysis before running:

   ```bash
   start_worker_profile content-proposal-worker-1
   ```

   Record one completed proposal and confirm its dedicated worker token remains
   distinct from `WORKER_API_TOKEN`.

3. Start Wiki before DM:

   ```bash
   start_worker_profile wiki-worker-1
   ```

   Record an active Wiki version that retrieves grounded text with no embedding
   API. Only then start the first DM worker:

   ```bash
   start_worker_profile dm-worker-1
   ```

   Verify `DM_WORKER_1_HEARTBEAT` and one lease. Confirm the previous remote
   worker lease is expired and cannot claim again. Only then run:

   ```bash
   start_worker_profile dm-worker-2
   ```

4. Start generation profiles one at a time. After each command, retain one real
   completed job and restart-recovery result before running the next command:

   ```bash
   start_worker_profile image-worker-1
   ```

   ```bash
   start_worker_profile card-news-worker-1
   ```

   ```bash
   start_worker_profile blog-worker-1
   ```

   ```bash
   start_worker_profile marketing-worker-1
   ```

If any gate fails, stop only that profile with
`stop_worker_profile <service>`, leave queued jobs intact, and diagnose before
continuing. Do not use `docker compose down`; it would also disturb API/Caddy.
For an application-release regression, use the signed
`./scripts/rollback.sh --previous --phase production` path instead of composing
around the release scripts.

### 13.2 Production evidence record

Keep this record secret-free. Replace no field until the corresponding command
or real job has been observed.

| Field | Required value |
|---|---|
| Deployed release | `RELEASE_SHA=<pending>` |
| Immutable API/Caddy images | exact `@sha256:<pending>` references |
| Immutable worker images | all 9 manifest keys with exact `@sha256:<pending>` references |
| Image revision check | every API/worker `org.opencontainers.image.revision` equals deployed SHA |
| Worker identity | profile, service name, stable worker ID, heartbeat status |
| Job evidence | job ID, job type, `queued_at`, `running_at`, `completed_at`/failure, duration seconds |
| Lease/restart evidence | claim owner, remote lease expiry where applicable, graceful stop, restart recovery |
| Login method | `ChatGPT`; status pass/fail only, no credential material |
| Rollback target | previous or signed legacy SHA and exact API/Caddy digest |
| Product verification | Brand Core draft, saved progress, loader duration, re-entry result |

The Ubuntu ChatGPT login is verified. All deployed SHA/digest, worker, job,
duration, rollback, and product-verification fields remain `pending` until the
incremental production rollout is actually performed. Do not call login success
deployment success or onboarding QA.

## 14. Publish scheduler activation boundary

The publish scheduler is not part of the general API/worker activation sequence
above. Use [게시 스케줄러 활성화·중지 런북](PUBLISH_SCHEDULER.md) only after the
serving primary release is fixed, migration 092 evidence is already present,
all external due callers are confirmed absent, and the exact preview queue IDs
have been approved.

The scheduler component path may start or replace only
`publish-scheduler-1`. It must not run a DB migration or recreate API, Caddy,
UI, or an unrelated worker. Observe three successful heartbeat updates and
verify the approved target/attempt/provider result before recording activation.
If any stop condition occurs, disable the scheduler component first and preserve
the API/UI/DB, reservations, completed publications, and migration 092.

Running the full deployment test suite, regardless of duration, is not evidence
that these production activation gates passed. This section documents the gate;
it does not authorize or perform activation.
