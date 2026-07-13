---
title: Skills vs MCP vs Datasets
description: Three catalog layers answer three different questions—connection, procedure, and evidence. Compose them; do not collapse them.
pubDate: 2026-06-19
author: Ultra Agentic
category: guide
tags:
  - mcp
  - skills
  - datasets
---

The catalog separates entries into three types because each answers a different question. An MCP server answers "what can an agent reach?" A skill answers "how should an agent use what it can reach, in what order, with what checks?" A dataset answers "what evidence exists that a given behavior works, or fails, in practice?" Collapsing these into one artifact makes each harder to evaluate on its own terms.

Consider a deployment task. An MCP server might expose repository inspection and read-only file access. A skill—say, a deployment-readiness check—describes the sequence: verify the build, check for uncommitted changes, confirm environment configuration, and stop before anything destructive. A dataset, if one existed, would record real outcomes of agents following that sequence: how often it caught a real issue, how often it produced a false positive. None of these three substitutes for either of the others.

This split also clarifies what maturity means for each type. A `beta` MCP server means the connector is downloadable but its interface may still change. A `beta` skill means the described procedure has been documented and is usable, but has not been hardened against every edge case. A `planned` dataset means the schema and intended scope have been written down, with no collection or records to date—no sample count, no benchmark, no license, because none of that exists yet.

Composing these layers well means picking the smallest correct entry for the job rather than reaching for one type to cover a gap in another. If a skill needs a capability that no MCP server exposes yet, that is a real dependency, not something to work around by embedding ad hoc network calls inside the skill's instructions. If a claim about reliability has no dataset behind it, say so, rather than implying a skill has been "tested" when what actually exists is a well-written procedure.

The catalog tries to keep this legible: browse by type, read the maturity label, and treat each entry as answering exactly the one question its type is meant to answer.
