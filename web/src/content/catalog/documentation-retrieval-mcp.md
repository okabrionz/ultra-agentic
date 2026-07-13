---
title: Documentation Retrieval MCP
type: mcp
summary: A beta MCP server for bounded search and excerpts across approved local documentation roots.
capabilities:
  - Search configured local documentation roots
  - Return line-addressable excerpts and citations
  - Restrict reads to approved text formats and limits
compatibility:
  - Model Context Protocol clients
  - Local Markdown, MDX, text, and reStructuredText files
  - Node.js 22.12.0 or newer
maturity: beta
tags:
  - documentation
  - retrieval
  - context
source: https://github.com/deirs/ultra-agentic/tree/main/packages/documentation-retrieval-mcp
release:
  artifact: documentation-retrieval-mcp
  version: 0.1.0
  download: /downloads/documentation-retrieval-mcp-0.1.0.zip
  quickStart:
    - label: Enter the extracted package directory
      command: cd documentation-retrieval-mcp-0.1.0
    - label: Install production dependencies
      command: npm install --omit=dev
    - label: Start the stdio server for approved documentation roots
      command: DOC_ROOTS=/path/to/docs:/path/to/team-docs node dist/index.js
featured: true
---

Version 0.1.0 is a downloadable, read-only stdio MCP server. After extracting the ZIP, enter the versioned package directory, install its production dependencies, and set `DOC_ROOTS` to the local documentation directories the server may search. The quick start uses concise POSIX syntax; Windows users should follow the PowerShell commands in the included `README.md`.

This release is local-only: it does not fetch URLs, make HTTP requests, or expose a network transport. Search and excerpt reads remain within the configured roots and return bounded, line-addressable citations. This is a beta interface, so tool contracts and compatibility may change after review.
