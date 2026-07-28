# OAuth cutover

This runbook changes public OAuth and webhook routing without changing secrets
by default. It does not authorize reading or editing a real environment file,
provider console, or production deployment. Execute it only during an approved
cutover with a named operator and rollback owner.

## Fixed production contract

Use these exact public addresses:

```text
Kakao callback: https://api.danbammsg.co.kr/auth/kakao/callback
Meta login callback: https://api.danbammsg.co.kr/auth/meta/callback
Meta trends callback: https://api.danbammsg.co.kr/auth/meta/trends/callback
Meta webhook: https://api.danbammsg.co.kr/webhooks/meta/instagram
Frontend: https://app.danbammsg.co.kr
```

The API contract is:

```text
AUTH_FRONTEND_URL=https://app.danbammsg.co.kr
CORS_ALLOWED_ORIGINS=https://app.danbammsg.co.kr
```

Allow only the exact app origin. Reject an arbitrary origin, including preview,
generated hosting, localhost, `www`, alternate scheme, or alternate port. A
preview origin needs its own reviewed preview-auth procedure and must not leak
into the production API file.

## Secret reuse and rotation

- Reuse the Kakao REST key and client secret, Meta app ID and app secret,
  webhook verify token, Supabase key, and Blob token when there is no suspected
  exposure, revocation, or provider policy change.
- **NEVER arbitrarily rotate `CREDENTIAL_ENCRYPTION_KEY`.** Existing stored
  OAuth credentials depend on this exact key for token decryption. A planned
  encryption-key migration requires a separate decrypt/re-encrypt design,
  verified rollback, and explicit approval.
- The worker/admin/cron tokens may be rotated in a planned change. Keep the
  rollback value protected, accept or deploy both sides in the documented
  order, verify the new token, and only then retire the old value.
- On suspected exposure, immediately rotate every affected secret through the
  provider-approved incident process. Revoke the exposed value after all
  consumers have changed, and record only identifiers and timestamps—not
  secret values.

Never paste secrets, authorization codes, access/refresh tokens, encrypted
credential blobs, or decrypted values into shell output, logs, tickets, chat,
screenshots, or evidence.

## Provider-console order

For Kakao and each Meta integration, add the new callback before removing the old callback.
Keep the old route available through canary validation and the rollback window:

1. Record the current callback/webhook configuration and rollback owner without
   recording secret values.
2. Add the exact new callback or webhook URL.
3. Keep the old callback registered.
4. Complete canary and production validation.
5. Observe the approved rollback window.
6. Remove the old callback only after the new route is stable.

Never replace the old callback in one destructive step. For the Meta webhook,
verify the challenge and one bounded delivery before changing the subscription.

## Pre-cutover checks

- Confirm the five shared env files are under
  `/opt/brand-pilot/shared/env`, owned by `bpdeploy`, and mode 600; confirm the
  directory is mode 700.
- Confirm `AUTH_FRONTEND_URL` and `CORS_ALLOWED_ORIGINS` are the exact app
  origin without printing their surrounding secret-bearing file.
- Confirm the Kakao, Meta login, Meta trends, and webhook addresses match the
  fixed contract.
- Confirm the current `CREDENTIAL_ENCRYPTION_KEY` is preserved by comparing a
  secret-manager version/fingerprint, never the key itself.
- Confirm the old API route, provider callbacks, and DNS value remain available
  for rollback.

Run the repository deployment contracts and preflight before any cutover:

```bash
npm run test:deployment
deploy/scripts/preflight.sh /opt/brand-pilot/releases/<sha>/release.env
```

## Canary checklist

Use an approved test account and redact identifiers. Capture pass/fail,
timestamps, HTTP status classes, correlation IDs, and provider error categories
only. The canary must prove:

- Kakao login completes and returns to `https://app.danbammsg.co.kr`.
- Kakao cancel returns a controlled user-visible result without a session leak.
- Kakao state mismatch is rejected and creates no authenticated session.
- Meta login completes and returns to the fixed frontend.
- Meta cancel returns a controlled user-visible result.
- Meta state mismatch is rejected.
- Meta trends authorization uses its dedicated callback.
- Meta webhook verification and one bounded test delivery succeed.
- An existing stored credential completes token decryption and a harmless
  authenticated read. Do not rotate the encryption key for this test.
- A request from `https://app.danbammsg.co.kr` passes CORS, while an arbitrary
  origin is rejected and receives no credentialed CORS allowance.

The canary and application **must not log secrets**. Search bounded application
logs for known event names and redaction markers only; never search for or print
the secret, token, authorization code, cookie, or decrypted credential value.

## Cutover and rollback

Change only the approved DNS/provider records. Keep the former API route and old
callbacks through the observation window. Roll back immediately if login,
cancel, state mismatch rejection, webhook verification/delivery, token
decryption, frontend redirect, or exact-origin CORS fails.

Rollback restores the recorded DNS/API target while leaving both old and new
provider callbacks registered. After the old route is healthy, investigate with
redacted evidence. Do not compensate by rotating
`CREDENTIAL_ENCRYPTION_KEY`, widening CORS, adding arbitrary callbacks, or
logging credentials.
