# Ultra Agentic

> Composable tools for capable agents.

Ultra Agentic is an open catalog of Model Context Protocol (MCP) servers, reusable agent skills, and structured datasets for composable AI workflows. This repository contains downloadable beta artifacts, remaining planned roadmap entries, and the static website that presents the catalog.

## Project status

Ultra Agentic is early-stage. Catalog maturity is mixed:

- **Beta (downloadable):** Repository Operations MCP, Documentation Retrieval MCP, and Deployment Readiness Skill — source under `packages/` / `skills/`, ZIP releases under `web/public/downloads/`.
- **Planned (specification only):** remaining catalog entries such as Database Context MCP, Observability Triage Skill, and Tool Failure Dataset — no published artifact yet.

Beta interfaces may change after review. Planned entries must not be treated as released packages.

## What the website includes

- A browsable catalog of MCP servers, agent skills, and datasets.
- Search and filters for catalog type and maturity.
- Detail pages covering capabilities, compatibility, tags, release status, and download/quick-start when a release exists.
- Guidance for evaluating catalog entries.
- Public project [principles and catalog policy](web/src/pages/about.astro), plus [sponsorship information](web/src/pages/sponsors.astro).
- Structured metadata, accessible navigation, responsive layouts, and a custom 404 page.

## Technology

- [Astro 7](https://astro.build/) for static site generation.
- [Tailwind CSS 4](https://tailwindcss.com/) for styling.
- TypeScript 6 for typed application code and configuration.
- npm workspaces for MCP packages at the repository root.
- [Bun](https://bun.sh/) for website dependency management and unit tests.
- [Playwright](https://playwright.dev/) for browser coverage.

Node.js 22.12 or newer is required.

## Quick start

### Website

```sh
git clone https://github.com/deirs/ultra-agentic.git
cd ultra-agentic/web
bun install
bun run dev
```

Open `http://localhost:4321`.

### Packages and download zips

From the repository root:

```sh
npm install
npm run verify
npm run package:downloads
```

Packaged releases are written to `web/public/downloads/`.

## Commands

### Website (`web/`)

- `bun run dev` — start the development server.
- `bun run build` — generate the static site in `web/dist/`.
- `bun run preview` — serve the current production build locally.
- `bun run test` — run unit tests.
- `bun run test:dist` — validate generated production output.
- `bun run test:e2e` — build and test the site with Playwright Chromium.
- `bun run astro check` — run Astro and TypeScript diagnostics.
- `bun run verify` — run the complete unit, diagnostic, build, and browser verification suite.

If Playwright Chromium is unavailable, install it with:

```sh
bunx playwright install chromium
```

### Root workspace

- `npm run build` — build workspace packages.
- `npm run test` — run package tests.
- `npm run typecheck` — typecheck workspace packages.
- `npm run test:artifacts` — validate packaged download contents.
- `npm run package:downloads` — build packages and refresh ZIP releases.
- `npm run verify` — run package test, typecheck, build, and artifact checks.

## Repository structure

```text
.
├── README.md
├── plan.md
├── package.json
├── packages/
│   ├── documentation-retrieval-mcp/
│   └── repository-operations-mcp/
├── skills/
│   └── deployment-readiness/
├── scripts/
├── tests/
├── web/
│   ├── public/
│   │   └── downloads/
│   ├── src/
│   │   ├── components/
│   │   ├── config/
│   │   ├── content/catalog/
│   │   ├── layouts/
│   │   ├── lib/
│   │   ├── pages/
│   │   └── styles/
│   ├── tests/
│   └── README.md
└── .github/FUNDING.yml
```

The website lives in `web/`. See [`web/README.md`](web/README.md) for architecture and testing details. `plan.md` contains sponsorship strategy notes and is not product documentation.

## Maintaining the catalog

Catalog entries live in `web/src/content/catalog/` as Markdown. Their frontmatter is validated by `web/src/content.config.ts`.

Keep maturity and source fields accurate:

- A `planned` entry describes intended behavior, not a released artifact.
- A `beta` entry may ship a downloadable ZIP and source path; treat the interface as reviewable and changeable.
- Add a `source` URL and `release` block only when a real artifact is available.
- Avoid performance or compatibility claims that have not been verified.

## Production deployment

`web/src/config/site.ts` currently leaves `siteUrl` as `null`; therefore, canonical and absolute social-image URLs are omitted. A sitemap and `robots.txt` are not currently generated. Before public deployment, configure a confirmed HTTPS origin, add the required discovery files, update the related build-output expectations, and run `bun run verify` from `web/`.

## Sponsorship

Ultra Agentic is supported through [GitHub Sponsors](https://github.com/sponsors/deirs). Sponsorship supports catalog development and artifact maintenance; it does not unlock private catalog content or change published maturity labels.
