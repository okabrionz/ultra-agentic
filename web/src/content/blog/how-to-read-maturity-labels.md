---
title: How to Read Catalog Maturity Labels
description: Planned, beta, and stable describe artifact maturity only—not popularity, adoption, or fitness for your production system.
pubDate: 2026-06-26
author: Ultra Agentic
category: guide
tags:
  - catalog
  - maturity
  - transparency
---

Every catalog entry carries one maturity label: `planned`, `beta`, or `stable`. The label describes exactly one thing—how far the artifact has progressed toward a usable, documented release—and nothing else. It says nothing about how popular an entry is, how many teams use it, or whether it is the right fit for a specific production system. That evaluation is still the reader's job.

`planned` means a documented concept or intended scope exists and nothing more. There is no downloadable artifact, no hosted endpoint, and no tested behavior to point to. A planned dataset entry, for example, might describe the labels and fields a future schema will use, but it will not claim a record count, a license, or a benchmark result, because none of those exist yet. If you see a planned entry with a source link or a ZIP download, that is a bug in the catalog, not a feature.

`beta` means an artifact is available—usually a versioned ZIP with a source path—but interfaces or compatibility can still change between releases. Treat a beta entry's quick-start commands as accurate for that specific version, and re-check after any version bump. Beta is an invitation to validate directly, not a promise of long-term stability.

`stable` means a maintained release contract is intended: the project aims to avoid breaking changes without notice. It is still not a substitute for your own review of source code, security posture, compatibility with your runtime, and operational fit. No maturity label removes that responsibility.

The practical rule: read the label before reading anything else about an entry. It tells you what kind of trust the entry has earned so far, and it constrains what claims the rest of the entry is allowed to make.
