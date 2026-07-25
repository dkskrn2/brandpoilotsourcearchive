# Brand Pilot React Conversion Notes

## React App

- App path: `apps/customer-ui`
- Stack: Vite, React, TypeScript, React Router
- Source prototype: `docs/prototypes/brand-pilot-customer-ui`

## Preserved Decisions

- No dashboard.
- Customer-only IA: onboarding, content, publish queue, sources, channels, brand settings.
- Auto approval is global in brand settings.
- Channels page has no auto approval tab or channel-level auto approval switch.
- Instagram preview remains a square card news format.
- Posting time is not user-editable.

## Implemented Screens

- Onboarding
- Content review
- Publish queue
- Sources
- Channels
- Brand settings

## Verification

- Unit tests cover navigation IA, global auto approval, channels tab regression, content preview, publish queue policy slots, and source tabs.
- Playwright E2E covers route reachability and mobile horizontal overflow.

## Deferred

- API integration.
- Real authentication.
- Real file upload.
- Real channel OAuth.
- Backend publish queue and worker integration.
