# TODOS

## Deployment verification

### Rotate the initial administrator password

**Priority:** P0 · operator action

The requested initial credential is `ROOT/ROOT`. Replace `ADMIN_PASSWORD` with a long random password immediately after the first successful sign-in.

### Verify production integrations

**Priority:** P1 · operator action

Submit one real contact request, create and publish one administrator article, redeploy, and confirm that the article persists. If analytics is required, set `NEXT_PUBLIC_GA_MEASUREMENT_ID` and confirm a realtime event.

## Completed in code

- Replaced local SQLite with provider-neutral PostgreSQL using `DATABASE_URL` or `POSTGRES_URL`.
- Added administrator login, signed session cookies, proxy protection, and authorization checks in every mutation.
- Converted legal and service detail content to native React data and removed legacy runtime HTML files.
- Added server-side contact validation, a bot honeypot, and PostgreSQL inquiry storage.
- Added optional GA4 loading through an environment variable.
- Removed unused legacy Meta OAuth serverless endpoints from the deployment surface.
