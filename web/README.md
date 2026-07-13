# Ultra Agentic web

Static Astro site for the Ultra Agentic catalog of MCP servers, agent skills, and datasets.

## Setup

Requires Bun and Node.js 22.12 or newer.

```sh
bun install
bun run dev
```

The development server is available at `http://localhost:4321`.

## Architecture and content

- `src/pages/` defines public routes and catalog detail pages.
- `src/layouts/Layout.astro` owns shared metadata, structured data, and page landmarks.
- `src/components/` contains navigation, catalog, sponsor, and visualization components.
- `src/content/catalog/` contains catalog entries as Markdown.
- `src/content.config.ts` validates catalog frontmatter and loads the content collection.
- `src/lib/` contains catalog filtering/sorting and SEO metadata builders with Bun tests.
- `public/` contains fonts, icons, and social-card assets.
- `tests/build-output.smoke.ts` verifies generated files and metadata.
- `tests/e2e/` runs Chromium coverage against the built site through `astro preview`.

Add or update catalog entries in `src/content/catalog/`. Keep maturity and source fields truthful:
planned entries must not imply that an artifact is released.

## Commands

- `bun run dev` — start the Astro development server.
- `bun run build` — generate the production site in `dist/`.
- `bun run preview` — serve the current production build.
- `bun run test` — run Bun unit tests.
- `bun run test:dist` — verify generated production output.
- `bun run test:e2e` — build, preview, and test the production site with Playwright Chromium.
- `bun run astro check` — run Astro and TypeScript diagnostics.
- `bun run verify` — run unit tests, diagnostics, build checks, and browser tests.

If Chromium is not installed for Playwright, install only that browser:

```sh
bunx playwright install chromium
```

## Verification

Before handing off changes, run:

```sh
bun run verify
```

The browser suite covers all generated routes at desktop and 375px widths, catalog interactions,
keyboard navigation, custom 404 behavior, and reduced-motion preferences.

## Production domain

`src/config/site.ts` intentionally leaves `siteUrl` as `null`. Canonical URLs and absolute Open
Graph/Twitter image URLs remain omitted until a real production domain exists. Once the site has a
confirmed HTTPS origin, set `siteUrl` to that origin and rerun `bun run verify`; do not use a
placeholder domain.
