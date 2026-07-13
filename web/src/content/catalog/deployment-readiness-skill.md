---
title: Deployment Readiness Skill
type: skill
summary: A beta agent skill for producing evidence-based deployment readiness decisions and checklists.
capabilities:
  - Classify release gates as PASS, BLOCKED, UNKNOWN, or NOT_APPLICABLE
  - Organize evidence, ownership, rollout, and rollback requirements
  - Produce a reviewable GO, CONDITIONAL_GO, or NO_GO decision
compatibility:
  - Cursor project skills
  - Agent runtimes that load Markdown skill instructions
maturity: beta
tags:
  - deployment
  - release
  - checklist
source: https://github.com/deirs/ultra-agentic/tree/main/skills/deployment-readiness
release:
  artifact: deployment-readiness-skill
  version: 0.1.0
  download: /downloads/deployment-readiness-skill-0.1.0.zip
  quickStart:
    - label: Extract the release archive
      command: unzip deployment-readiness-skill-0.1.0.zip
    - label: Create the project skills directory
      command: mkdir -p .cursor/skills
    - label: Copy the extracted skill into this Cursor project
      command: cp -R deployment-readiness .cursor/skills/deployment-readiness
featured: true
---

Version 0.1.0 packages the skill instructions and checklist template. After extracting the ZIP in the directory where you downloaded it, copy the archive’s `deployment-readiness` directory to `.cursor/skills/deployment-readiness` in your Cursor project. The entry file should resolve to `.cursor/skills/deployment-readiness/SKILL.md`.

The skill requires traceable evidence for release gates and treats missing evidence as UNKNOWN rather than PASS. It does not deploy software or establish production suitability. This is a beta interface, so instructions and report contracts may change after review.
