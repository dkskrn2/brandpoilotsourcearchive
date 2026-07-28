# Vercel Preview Authentication

This runbook enables authentication for one reviewed staging deployment without
allowing arbitrary pull-request origins into the production API trust boundary.
The only supported preview origin is:

```text
https://staging-app.danbammsg.co.kr
```

Do not use a generated `*.vercel.app` URL in API CORS or OAuth configuration.
Do not attach the stable alias to an unreviewed pull request. The staging alias
must point only to the reviewed D-hybrid branch deployment and should retain
Vercel Deployment Protection or an equivalent operator access control.

The browser sends only the opaque selector `destination=preview`. It never sends
a redirect URL. The API accepts that selector only when
`AUTH_PREVIEW_FRONTEND_URL` is configured, binds `preview` to the per-attempt
HttpOnly Kakao state cookie, and resolves the callback destination from that
cookie. Generated deployment URLs, wildcard origins, ports, paths, and arbitrary
`returnTo` values remain invalid.

## External activation steps

No Ubuntu host or Vercel project is changed by this repository commit. An
authorized operator must complete all of the following as a separate deployment
change:

1. Create DNS for `staging-app.danbammsg.co.kr` and attach that exact custom
   domain to the reviewed Vercel preview/branch deployment. Do not attach it to
   the rolling deployment for every pull request.
2. Set these variables for the Vercel **Preview** environment only:

   ```env
   VITE_API_BASE_URL=https://api.danbammsg.co.kr
   VITE_AUTH_DESTINATION=preview
   ```

   Keep `VITE_AUTH_DESTINATION` unset in the Vercel Production environment.
3. In the running API environment, preserve the existing production origin and
   add the exact staging origin:

   ```env
   AUTH_FRONTEND_URL=https://app.danbammsg.co.kr
   AUTH_PREVIEW_FRONTEND_URL=https://staging-app.danbammsg.co.kr
   CORS_ALLOWED_ORIGINS=https://app.danbammsg.co.kr,https://www.danbammsg.co.kr,https://staging-app.danbammsg.co.kr
   ```

4. Restart or redeploy the API through the separately approved production
   procedure, then redeploy the reviewed Vercel preview so its build receives
   the Preview variables.

The preview UI uses the production API and therefore production data. Only a
reviewed, access-protected deployment may receive the stable alias. A general PR
preview must remain unauthenticated.

## Verification

Verify that the stable origin receives credentialed CORS:

```bash
curl -i -X OPTIONS https://api.danbammsg.co.kr/auth/me \
  -H 'Origin: https://staging-app.danbammsg.co.kr' \
  -H 'Access-Control-Request-Method: GET'
```

The response must include:

```text
Access-Control-Allow-Origin: https://staging-app.danbammsg.co.kr
Access-Control-Allow-Credentials: true
```

Repeat with a generated Vercel origin. That response must not include either
CORS header:

```bash
curl -i -X OPTIONS https://api.danbammsg.co.kr/auth/me \
  -H 'Origin: https://untrusted-preview.vercel.app' \
  -H 'Access-Control-Request-Method: GET'
```

Then open `https://staging-app.danbammsg.co.kr/login` in a clean browser:

1. Confirm the Kakao start request is
   `https://api.danbammsg.co.kr/auth/kakao/login?destination=preview`.
2. Complete Kakao login.
3. Confirm the callback returns to
   `https://staging-app.danbammsg.co.kr/onboarding`, not the production app.
4. Open `/dashboard` and confirm `/auth/me` succeeds with the session cookie.
5. Recheck production login and `/dashboard`; both must still use
   `https://app.danbammsg.co.kr`.

## Rollback

Remove `VITE_AUTH_DESTINATION` from Vercel Preview, remove
`AUTH_PREVIEW_FRONTEND_URL`, restore `CORS_ALLOWED_ORIGINS` to the production
origins, and restart/redeploy through the approved procedure. Detach the staging
custom domain if it should no longer be reachable. With the preview variable
unset, `destination=preview` fails closed with HTTP 400 and normal production
login behavior is unchanged.
