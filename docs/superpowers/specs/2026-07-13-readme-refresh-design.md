# README Refresh Design

## Context

The root README currently describes Ultra Agentic as a framework, while the implemented product is a static Astro website that presents a transparent roadmap catalog of MCP servers, agent skills, and datasets.

## Goal

Replace the placeholder README with a concise, technically useful project overview that helps contributors understand the product, its current maturity, and how to run and verify the website locally.

## Content

The README will:

- identify the product as Ultra Agentic and use the existing tagline;
- describe the repository as an open roadmap catalog, not a released agent framework;
- state that current catalog entries are planned specifications without published artifacts;
- summarize the implemented catalog, filtering, detail pages, project guidance, and sponsorship information;
- list the verified Astro, Tailwind CSS, TypeScript, Bun, and Playwright stack;
- provide setup, development, build, preview, test, and verification commands from the `web/` directory;
- explain the main repository directories and where catalog content is maintained;
- document the unset production-domain constraint and link to the catalog policy and sponsor pages.

## Non-goals

The README will not claim that catalog artifacts are downloadable, production-ready, beta, or stable. It will not include unsupported adoption metrics, performance claims, pricing, or a live production URL.

## Verification

Review every factual statement against repository configuration and source content, confirm every documented command exists in `web/package.json`, and render-check the Markdown structure. No application build is required because the change is documentation-only.
