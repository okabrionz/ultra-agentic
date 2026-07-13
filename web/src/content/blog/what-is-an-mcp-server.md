---
title: What Is an MCP Server?
description: MCP servers expose bounded capabilities to agents—connections, not procedures or evaluation datasets.
pubDate: 2026-06-05
author: Ultra Agentic
category: guide
tags:
  - mcp
  - agents
  - connections
---

A Model Context Protocol (MCP) server is a connection layer. It exposes a bounded set of tools an agent can call—read a file, inspect a repository, query documentation—over a defined protocol. What it does not do is decide when or why to call those tools. That decision belongs to the agent, or to a skill guiding the agent.

This distinction matters because it is easy to conflate "the thing that connects to a system" with "the thing that knows how to use it well." An MCP server for repository inspection can report diffs and file contents; it has no opinion about when a diff review should happen during a release process. That judgment lives elsewhere in the stack.

MCP servers also are not datasets. A server that reads text files beneath a repository root does not ship examples of good or bad reads, and it does not claim to have been evaluated against a benchmark. If a catalog entry blends "here is a connector" with "here is proof it works well," those are two different kinds of evidence and should be labeled separately.

In this catalog, MCP servers are cataloged with explicit compatibility constraints (client protocol, runtime version, host system) and a maturity label. A `beta` MCP server may ship a versioned ZIP and a source path; a `planned` one is a specification only, with no downloadable artifact or hosted endpoint implied. Read the maturity label before assuming an interface is stable.

The practical takeaway: when evaluating an MCP server, ask what capabilities it exposes, what it explicitly does not do, and what maturity stage it is at. Everything else—how an agent should sequence those capabilities, and whether the results have been measured—is a separate concern, covered by skills and datasets respectively.
