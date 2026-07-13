---
title: Composing Agent Workflows Across Layers
description: A working agent workflow moves through connect, procedure, and evidence—each layer checked before the next is trusted.
pubDate: 2026-07-03
author: Ultra Agentic
category: guide
tags:
  - workflows
  - agents
  - composition
---

A useful way to reason about an agent workflow is as three ordered layers: connect, procedure, evidence. Connect is the MCP server layer—what systems can the agent actually reach, and with what constraints? Procedure is the skill layer—given that access, what sequence of steps accomplishes the task safely? Evidence is the dataset layer—what has been observed about how well that sequence performs, and where does it fail?

Skipping the connect layer's constraints is the most common mistake. If a repository-inspection MCP server is read-only and scoped to one local work-tree root, no skill built on top of it should assume write access or cross-repository reach. The procedure layer has to respect the real boundaries of the connection layer, not the boundaries a workflow author wishes existed.

The procedure layer earns its own maturity independent of the layers around it. A deployment-readiness skill can be well-specified—clear steps, clear stop conditions—while the MCP servers it depends on are still in beta, and while no dataset yet documents its real-world failure rate. That is a coherent, honest state. It is not the same as claiming the whole workflow is production-proven.

Evidence is the layer most often missing entirely, and that is fine to say plainly. A workflow can be built and used today on a well-documented procedure and a working connector, without a dataset yet confirming its reliability at scale. What is not fine is implying that evidence exists when it does not—citing a benchmark that was never run, or a sample size that was never collected.

Composing across these three layers, in order, and being explicit about which layers are solid versus aspirational for a given workflow, is most of what makes an agent system legible to the people who have to trust it.
