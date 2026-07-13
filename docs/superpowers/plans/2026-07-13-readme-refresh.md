# Root README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inaccurate root placeholder with a truthful, useful README for the implemented Ultra Agentic roadmap catalog.

**Architecture:** Keep the application unchanged and make `README.md` the repository entry point. The document will summarize product status, implemented website features, contributor workflows, and production constraints while delegating detailed web-app documentation to `web/README.md`.

**Tech Stack:** Markdown documentation for an Astro 7, Tailwind CSS 4, TypeScript 6, Bun, and Playwright project.

## Global Constraints

- Write the README in English to match the site, source code, and existing technical documentation.
- Describe Ultra Agentic as an open roadmap catalog, not a released agent framework.
- State that all current catalog entries are planned specifications without published source artifacts.
- Do not claim production readiness, released downloads, adoption metrics, measured performance, pricing, or a live deployment.
- Document only commands that exist in `web/package.json`.
- Do not modify application code, dependencies, catalog data, or generated output.
- Do not create a Git commit unless the user explicitly requests one.

---

### Task 1: Replace and verify the root README

**Files:**
- Modify: `README.md:1-5`
- Reference: `web/README.md`
- Reference: `web/package.json`
- Reference: `web/src/config/site.ts`
- Reference: `web/src/content/catalog/*.md`

**Interfaces:**
- Consumes: product metadata, package scripts, catalog maturity values, and repository funding configuration.
- Produces: a root-level project overview and contributor quick-start document.

- [ ] **Step 1: Replace the placeholder with the approved README**

Use this complete content:

````markdown
# Ultra Agentic

> Composable tools for capable agents.

Ultra Agentic is an open roadmap catalog of Model Context Protocol (MCP) servers, reusable agent skills, and structured datasets for composable AI workflows. This repository currently contains the static website that presents and documents that roadmap.

## Project status

Ultra Agentic is in an early, specification-first stage. Every catalog entry is currently marked **planned**, and no source artifact has been published yet. The website is implemented and testable, but the listed MCP servers, skills, and datasets should not be treated as released packages.

## What the website includes

- A browsable catalog of MCP servers, agent skills, and datasets.
- Search and filters for catalog type and maturity.
- Detail pages covering capabilities, compatibility, tags, and release status.
- Guidance for evaluating planned catalog entries.
- Public project principles, catalog policy, and sponsorship information.
- Structured metadata, accessible navigation, responsive layouts, and a custom 404 page.

## Technology

- [Astro 7](https://astro.build/) for static site generation.
- [Tailwind CSS 4](https://tailwindcss.com/) for styling.
- TypeScript 6 for typed application code and configuration.
- [Bun](https://bun.sh/) for dependency management and unit tests.
- [Playwright](https://playwright.dev/) for browser coverage.

Node.js 22.12 or newer is required.

## Quick start

```sh
git clone https://github.com/deirs/ultra-agentic.git
cd ultra-agentic/web
bun install
bun run dev
```

Open `http://localhost:4321`.

## Commands

Run these commands from `web/`:

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

## Repository structure

```text
.
├── README.md
├── plan.md
├── web/
│   ├── public/
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

The application lives in `web/`. See [`web/README.md`](web/README.md) for architecture and testing details. `plan.md` contains sponsorship strategy notes and is not product documentation.

## Maintaining the catalog

Catalog entries live in `web/src/content/catalog/` as Markdown. Their frontmatter is validated by `web/src/content.config.ts`.

Keep maturity and source fields accurate:

- A `planned` entry describes intended behavior, not a released artifact.
- Add a source URL only when a real HTTPS artifact is publicly available.
- Avoid performance or compatibility claims that have not been verified.

## Production deployment

The site currently has no configured production origin. `web/src/config/site.ts` leaves `siteUrl` as `null`, so canonical URLs, absolute social-image URLs, the sitemap, and `robots.txt` remain disabled. Set a confirmed HTTPS origin before deploying publicly, then run `bun run verify`.

## Sponsorship

Ultra Agentic is supported through [GitHub Sponsors](https://github.com/sponsors/deirs). Sponsorship supports catalog development and future artifact implementation; it does not unlock private catalog content or imply that planned artifacts are already available.
````

- [ ] **Step 2: Check documented claims and commands**

Run:

```bash
rg -n "framework for building|ready-to-use|production-ready|2,000\\+|\\$50,000" README.md
bun -e "const p = await Bun.file('web/package.json').json(); const required = ['dev','build','preview','astro','test','test:dist','test:e2e','verify']; if (required.some((name) => !p.scripts[name])) process.exit(1); console.log('README command scripts exist')"
```

Expected: the first command prints no matches; the second prints `README command scripts exist`.

- [ ] **Step 3: Verify Markdown hygiene and review the final diff**

Run:

```bash
git diff --check -- README.md
git diff -- README.md
```

Expected: `git diff --check` prints no errors, and the diff contains only the intended README replacement.
