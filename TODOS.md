# TODOS

## Deployment

### Replace local SQLite before production deployment

**Priority:** P0

Move `content_articles` to a serverless Postgres provider before enabling administrator writes on Vercel.

### Protect administrator routes

**Priority:** P0

Add authentication and authorization for `/admin` and all content mutation actions before public deployment.

### Consolidate API routes

**Priority:** P1

Move the remaining Meta OAuth handlers from `api/auth/meta` into Next.js Route Handlers, then remove the legacy serverless API directory.

## Migration

### Finish legacy HTML removal

**Priority:** P1

Convert the remaining service-detail and legal HTML documents to native React components before deleting the legacy files.

### Restore production analytics

**Priority:** P1

Port the existing Google Analytics property into the React root layout and verify production events.

## Quality

### Expand automated behavior coverage

**Priority:** P1

Add executable integration coverage for content CRUD, contact error handling, HTML sanitization, public route rendering, and responsive browser flows.

## Completed
