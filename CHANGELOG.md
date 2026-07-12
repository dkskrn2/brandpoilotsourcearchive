# Changelog

All notable changes to this project are documented in this file.

## [0.3.1] - 2026-07-12

### Added

- Added PostgreSQL-backed consultation inquiry storage and an administrator inquiry list.

### Changed

- Removed the Google Apps Script contact submission dependency in favor of direct database storage.

## [0.3.0] - 2026-07-12

### Added

- Added environment-configured administrator login with signed, secure session cookies and authorization checks for every content mutation.
- Added provider-neutral PostgreSQL persistence for Vercel Marketplace databases with automatic schema and seed initialization.
- Added Vercel deployment documentation, an environment template, server-side contact validation, and optional GA4 loading.

### Changed

- Converted service detail and legal documents from runtime HTML extraction to native React components and structured data.
- Made public content fall back to read-only seed data when a database has not yet been configured.

### Removed

- Removed legacy standalone marketing HTML files and unused Meta OAuth serverless endpoints from the deployment surface.

## [0.2.0] - 2026-07-11

### Added

- Rebuilt the marketing site as a responsive Next.js and React application while preserving the existing service, work, contact, and legal content.
- Added a local content administration area with SQLite-backed create, edit, publish, search, filter, and delete workflows.
- Added a content hub with individual article pages, published-state filtering, dynamic SEO metadata, sitemap entries, and structured data.
- Added the locally hosted Naver SmartEditor2 integration with server-side HTML sanitization and rich-content rendering.
- Added generated explanatory imagery and responsive visual systems across the home, service, work, and content pages.
- Added regression checks for content parity, administrator wiring, SEO behavior, contact handling, and Meta OAuth utilities.

### Changed

- Updated legacy HTML content and links so routes remain compatible during the React migration.
- Improved global navigation, mobile layouts, typography, accessibility focus states, and metadata sharing cards.

### Fixed

- Prevented seeded placeholder articles from entering search indexes, sitemaps, and article structured data.
- Escaped JSON-LD payloads and sanitized editor HTML before rendering to prevent stored markup injection.
