---
title: Building in Public Without Overclaiming Artifacts
description: Showing status truthfully means labeling planned work as planned, linking source only where it exists, and never implying a live deployment that isn't there.
pubDate: 2026-07-10
author: Ultra Agentic
category: roadmap
tags:
  - transparency
  - roadmap
  - catalog
---

Building in public is easy to say and easy to get wrong in the details. The failure mode is rarely an outright lie—it is usually a small overclaim: a "coming soon" that quietly becomes a working link before anything actually ships, a demo screenshot presented as a live system, a roadmap item described with the same confidence as a tested release. Ultra Agentic's catalog is built around avoiding that specific failure mode.

Concretely, that means a few rules are enforced rather than just stated. A `planned` catalog entry does not get a source link or a release block—no artifact exists, so nothing points to one. A `beta` entry may link to source and offer a versioned ZIP under the downloads path, but its description still says beta, because the interface can still change. No entry, at any maturity level, gets a claim about a hosted production deployment, because none exists yet; the project's site URL itself is intentionally left unset in configuration until a real domain is in place.

These rules produce a catalog that looks less impressive than a fully "stable, live, benchmarked" version would—and that is the trade-off being made on purpose. A reader who sees three beta downloads and three planned specifications knows exactly what they can pull down and inspect today, and what is still just a written intention. That is more useful than a catalog that looks finished but cannot survive someone actually clicking through it.

The same discipline applies to this blog. Posts describe what the catalog does now, what maturity labels mean, and where the roadmap is headed—without borrowing the language of a shipped feature for something still in progress. If a future post needs to reference a real deployment URL or a new stable release, that will only happen once the corresponding entry has actually earned it.

Readers evaluating any part of this project are encouraged to check the claim against the artifact directly: open the source link if one is given, download the ZIP if one is offered, and treat the absence of either as the honest signal it is meant to be.
