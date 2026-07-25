# Brand Pilot Ubuntu API deployment

This runbook moves only the Brand Pilot **API + Caddy only** runtime to one
Ubuntu host. It assumes there are **no external customers** and no continuity
critical webhook traffic yet. The first release runs no db:migrate, no worker,
no scheduler, and no publication. Keep the current Vercel API available for at
least **48 hours** as the rollback target.

LM Studio is not used. Tailscale is for private SSH, code transfer, and
operations only: **private SSH, never public ingress**. Do not enable a
Tailscale exit node, Funnel, Serve, subnet routing, or any other public routing.

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
DEV_AUTH_ENABLED=false
DB_POOL_MAX=3
```

No worker process is installed in this runbook. Worker, scheduler, publication,
and database schema changes remain out of scope.

## 2. Network prerequisites

Confirm all of the following before installing software:

- Ubuntu 24.04 LTS, `amd64`, with current security updates.
- A static LAN IP or a DHCP reservation for the Ubuntu machine.
- A real public IPv4. Compare the router WAN address with an external IP check.
  If they differ, investigate double NAT or CGNAT with the ISP before continuing.
- The router forwards only TCP 80/443 to the static LAN IP. **Never forward TCP
  22**.
- If the public address is dynamic, define a tested dynamic public IP / DDNS
  update method and its recovery owner.
- `canary-api.danbammsg.co.kr` and later `api.danbammsg.co.kr` have DNS A
  records to the public IPv4. Do not publish an AAAA record without working IPv6
  routing and firewall policy.
- ISP/router/firewall paths allow inbound 80 and 443. Caddy ACME needs public
  reachability to issue and renew certificates.

Useful read-only checks:

### [Ubuntu 관리자 콘솔/기존 sudo 관리자] Network diagnostics

```bash
dpkg --print-architecture
. /etc/os-release && printf '%s %s\n' "$ID" "$VERSION_ID"
ip -brief address
curl -4 --fail https://ifconfig.me
sudo ss -lntp
```

Record the router WAN IPv4, Ubuntu LAN IPv4, intended public IPv4, DNS values,
and the person able to change the router. The router forwards only TCP 80/443.
Operational rule: never forward TCP 22.

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
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

The router forwards only TCP 80/443 and never port 22. Verify from an external
network, not only from the LAN.

### 3.5 Windows operations

Use the Tailscale IP/name for administration:

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
WORKER_API_TOKEN ADMIN_SERVICE_TOKEN CRON_SECRET SOURCE_CRAWL_BATCH_SIZE
SOURCE_CRAWL_DISCOVERY_LIMIT SOURCE_CRAWL_TIME_BUDGET_MS
LOCAL_SCHEDULER_ENABLED WORKER_CODEX_MAX_CONCURRENCY
WORKER_CODEX_DM_RESERVED_SLOTS CREDENTIAL_ENCRYPTION_KEY
INSTAGRAM_PUBLISH_ENABLED IMAGE_JOB_COOLDOWN_MS META_GRAPH_VERSION META_APP_ID
META_APP_SECRET META_OAUTH_REDIRECT_URI META_TRENDS_OAUTH_REDIRECT_URI
META_WEBHOOK_VERIFY_TOKEN DM_PROFILE_REFRESH_AFTER_HOURS KAKAO_REST_API_KEY
KAKAO_CLIENT_SECRET KAKAO_REDIRECT_URI BRAND_PILOT_DEV_BRAND_ID
BRAND_PILOT_DEV_WORKSPACE_ID BLOB_READ_WRITE_TOKEN
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
```

Keep the original `CREDENTIAL_ENCRYPTION_KEY`. Set `DB_SSL_CA_BASE64` only when
the database provider requires a private CA; use the strict canonical Base64 of
the CA certificate. Otherwise leave it empty and use the operating system trust
store. Do not paste command output containing environment values into tickets,
chat, logs, or shell history. Do not run `env`, `set`, or any Compose command
that renders the environment. On the secret-bearing machine, every Compose
validation must use `config --quiet`; never render the resolved configuration.

Do not copy a development `.env` wholesale. Do not add `api.env` to Git.

## 7. Publish and obtain an immutable release

The workflow
`.github/workflows/publish-brand-pilot-server-images.yml` verifies the source,
builds the linux/amd64 API image in CI, pushes it to GHCR, captures the immutable
API image digest and Caddy digest, and uploads:

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
grep -E '^API_IMAGE=ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$' release.env
grep -E '^CADDY_IMAGE=docker\.io/library/caddy@sha256:[0-9a-f]{64}$' release.env
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
grep -E '^(API_IMAGE|CADDY_IMAGE)=.+@sha256:[0-9a-f]{64}$' release.env
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
grep -E '^(RELEASE_SHA|API_IMAGE|CADDY_IMAGE)=' "$release_dir/release.env"
curl --fail https://api.danbammsg.co.kr/ready
```

### [Ubuntu 관리자 콘솔/기존 sudo 관리자] Record root-level port evidence

```bash
sudo ss -lntp
```

Record evidence that:

- The exact `RELEASE_SHA`, `API_IMAGE`, and `CADDY_IMAGE` are immutable and
  digest-pinned.
- Services are `api-primary`, `api-canary`, and `caddy`.
- Only TCP 80/443 are publicly bound by this stack.
- `LOCAL_SCHEDULER_ENABLED=false`, `INSTAGRAM_PUBLISH_ENABLED=false`,
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
remains a **future worker plan** covering DM1, DM2, Wiki, leases, graceful
shutdown, and its own canary. Do not add workers to this API cutover.
