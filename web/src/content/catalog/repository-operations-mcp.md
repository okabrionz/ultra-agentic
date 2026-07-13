---
title: Repository Operations MCP
type: mcp
summary: A beta MCP server for bounded, read-only inspection of one local Git repository.
capabilities:
  - Inspect repository structure and working-tree state
  - Review bounded staged or unstaged diffs
  - Read approved text files beneath the repository root
compatibility:
  - Model Context Protocol clients
  - Git repositories
  - Node.js 22.12.0 or newer
maturity: beta
tags:
  - repositories
  - automation
  - git
source: https://github.com/deirs/ultra-agentic/tree/main/packages/repository-operations-mcp
release:
  artifact: repository-operations-mcp
  version: 0.1.0
  download: /downloads/repository-operations-mcp-0.1.0.zip
  quickStart:
    - label: Enter the extracted package directory
      command: cd repository-operations-mcp-0.1.0
    - label: Install production dependencies
      command: npm install --omit=dev
    - label: Start the stdio server for one repository
      command: REPO_ROOT=/path/to/repository node dist/index.js
featured: true
---

Version 0.1.0 is a downloadable, read-only stdio MCP server. After extracting the ZIP, enter the versioned package directory, install its production dependencies, and set `REPO_ROOT` to the exact local Git work-tree root you want the server to inspect. The quick start uses concise POSIX syntax; Windows users should follow the PowerShell commands in the included `README.md`.

Repository status, bounded diffs, tree listings, and text reads stay scoped beneath that resolved root. The server exposes no mutation tools. This is a beta interface, so tool contracts and compatibility may change after review.
