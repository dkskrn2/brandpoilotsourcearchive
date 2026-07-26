# Current Ubuntu Baseline Evidence — 2026-07-26

## Release identity

- Baseline SHA: `02aa2bcae3f66d494f16a26bec9055cac17464f9`
- GitHub Actions run: <https://github.com/dkskrn2/main/actions/runs/30163351300>
- Workflow result: `completed / success`
- API image: `ghcr.io/dkskrn2/brand-pilot-api@sha256:17e19ff313497a07eb3b56eb5d3f5d8c6cb33252684458dd555be883bbdeeb53`
- Caddy image: `docker.io/library/caddy@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648`
- Production env SHA-256: `e5ffd7d6856dff052e69b6d8d410cca4a75d43fa4ebe5974ed660ad87d68a351`
- Production env owner/mode: `bpdeploy:bpdeploy / 0600`

No secret, token, cookie, connection string, or certificate body is included in this evidence.

## Host and ingress

- Ubuntu Tailscale address: `100.106.196.48`
- Ubuntu public IPv4: `220.72.230.157`
- Public hosts: `api.danbammsg.co.kr`, `canary-api.danbammsg.co.kr`
- Public A result from `1.1.1.1`: `220.72.230.157`
- Public A result from `8.8.8.8`: `220.72.230.157`
- Gabia TTL: `600` seconds (provider minimum; the planned `300` option was unavailable)
- External TCP 80: reachable
- External TCP 443: reachable
- No public SSH exposure was added; deployment SSH remains on Tailscale.

## Runtime verification

- External `/health`: HTTP `200`
- External `/ready`: HTTP `200`
- Windows curl TLS verification result: `0`
- Allowed CORS origin `https://www.danbammsg.co.kr`: exact origin returned
- Allowed CORS origin `https://app.danbammsg.co.kr`: exact origin returned
- Foreign origin `https://not-allowed.invalid`: no allow-origin header returned
- Development Meta completion route: HTTP `404`
- `LOCAL_SCHEDULER_ENABLED=false`
- `INSTAGRAM_PUBLISH_ENABLED=false`
- `DEV_AUTH_ENABLED=false`
- No migration, SNS publish, DM send, paid generation, or download quota mutation was run.

Running containers:

```text
brand-pilot-api-canary-1  healthy  image 17e19ff31349
brand-pilot-api-primary-1 healthy  image 17e19ff31349
brand-pilot-caddy-1       running  image 5f5c8640aae0
```

Runtime state:

```text
state/candidate = absent
state/current = 02aa2bcae3f66d494f16a26bec9055cac17464f9
state/previous = absent
state/prepared = absent
state/transition.journal = absent
```

GHCR authentication was supplied through SSH standard input only for image pulls and removed after each operation. Final `GHCR_AUTH_PRESENT=no`.

## Recovery rehearsal

The first Ubuntu release has no older Ubuntu SHA. The rollback entry point was therefore rehearsed against the same immutable candidate:

```text
rollback.sh --release 02aa2bcae3f66d494f16a26bec9055cac17464f9 --phase canary
rollback=ok
```

Post-rehearsal health, readiness, container count, candidate state, and GHCR logout were rechecked successfully. The user-facing rollback target remains the existing Vercel deployment.

## Findings handled during deployment

1. The private GHCR image pull initially failed because the Ubuntu Docker client had intentionally been logged out. A GitHub token with `read:packages` was used transiently and immediately removed.
2. The API started but readiness returned database error because `DB_SSL_CA_BASE64` was empty. The Supabase Root 2021 CA fingerprint was compared with the live Supabase pooler certificate chain and then added while keeping `rejectUnauthorized=true`.
3. `verify-canary.sh` reports a false CORS failure because its GNU `grep -E` expression treats `\r` as a literal `r` instead of the HTTP CR byte. The same check passed after normalizing CRLF before matching. The immutable release file was not edited during deployment.

## Production cutover

- `api.danbammsg.co.kr A 220.72.230.157` was added with TTL `600`.
- Both `1.1.1.1` and `8.8.8.8` returned the exact production IPv4 before commit.
- `promote.sh --commit --dns-cutover-confirmed` returned `promotion_commit=ok`.
- Production `/health` and `/ready` returned HTTP `200`; TLS verification returned `0`.
- Kakao login generated the production callback `https://api.danbammsg.co.kr/auth/kakao/callback`.
- Meta Instagram Business Login allows `https://api.danbammsg.co.kr/auth/meta/callback`.
- Meta Business Login allows both production Meta callback paths.
- The old provider callback entries were retained temporarily as rollback paths.

## Customer UI deployment

- Vercel project: `brand-pilot-app`
- Root directory: `brand_poilot/apps/customer-ui`
- Production URL: <https://brand-pilot-app.vercel.app>
- Custom domain: <https://app.danbammsg.co.kr>
- API bundle reference: `https://api.danbammsg.co.kr`
- SPA routing fix: <https://github.com/dkskrn2/main/pull/61>
- Production commit containing the routing fix: `05f9ad6431b1049a71d4f9e39d331c61df0a7702`
- `/`, `/login`, `/onboarding`, `/channels`, `/instagram-trends`, and `/brand-settings` returned HTTP `200` with TLS verification result `0`.
- A live browser session restored the Kakao-authenticated user, loaded onboarding data, and loaded channel state through the production API.

## Remaining runtime boundary

- The API and customer UI are cut over.
- The existing Vercel API remains available as a temporary rollback target.
- The Instagram DM worker is not running on Ubuntu yet; the UI correctly reports `워커 오프라인`.
- `INSTAGRAM_PUBLISH_ENABLED=false` remains intentionally fail-closed for the internal pilot.
