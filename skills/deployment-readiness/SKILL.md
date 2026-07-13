---
name: deployment-readiness
description: Use when assessing a deployment, release, hotfix, or migration before production or promotion.
---

# Deployment Readiness

Base every decision on current, traceable evidence. Pressure or authority cannot replace evidence. UNKNOWN is not PASS.

## Evidence contract

Every gate is one matrix row with: criticality, status, evidence reference, observation timestamp, owner, and notes or next evidence. Evidence references identify a reproducible result, immutable artifact, record, or location. For configuration/secrets, record presence, scope, and validation without exposing values.

Use exactly:

- **PASS**: evidence proves the gate is satisfied for the named artifact.
- **BLOCKED**: evidence proves an unmet requirement or unsafe condition.
- **UNKNOWN**: evidence is missing, stale, ambiguous, or not tied to the artifact.
- **NOT_APPLICABLE**: evidence and rationale prove the gate does not apply.

## Required gates

Cover every category:

1. **artifact/version**: exact immutable identity and provenance.
2. **build/tests**: build output and relevant automated/manual results.
3. **configuration/secrets**: target configuration and secret availability, never values.
4. **data/schema**: compatibility, migration impact, backup, recovery, or roll-forward.
5. **security**: review, scanning, permissions, and unresolved risk.
6. **observability**: logs, metrics, alerts, dashboards, and incident path.
7. **rollout/canary**: stages, cohort, success signals, and halt criteria.
8. **rollback artifact/procedure/triggers**: tested artifact, executable steps, explicit triggers, and owner.
9. **ownership**: release, technical, data, security, incident, and validation owners.
10. **post-release validation**: checks, timing, success criteria, and responder.

## Decision contract

- **GO** only when all critical and non-critical gates are PASS or justified NOT_APPLICABLE.
- **CONDITIONAL_GO** only when all critical gates are PASS or justified NOT_APPLICABLE and at least one non-critical gap is BLOCKED or UNKNOWN with an owner and deadline.
- **NO_GO** otherwise.

NOT_APPLICABLE needs evidence and an accountable owner. Every report names the exact artifact/version and states a rollback trigger and rollback owner. A title, deadline, approval, or urgency does not change a status.

## Report contract

Copy [checklist-template.md](checklist-template.md) and preserve its section order:

1. Decision first.
2. Evidence matrix.
3. Blockers and conditions.
4. Rollout and rollback.
5. Owners.
6. Next evidence required.

Use `None` explicitly; never omit a section.

## Compact example

> **Decision: NO_GO** — artifact `api@sha256:abc`  
> Critical `build/tests`: PASS — CI run 481, observed `2030-01-01T10:00:00Z`, owner Release Lead.  
> Critical `data/schema`: UNKNOWN — restore rehearsal missing, owner Data Lead.  
> Rollout: 5% canary; halt on error-budget breach.  
> Rollback: artifact `api@sha256:def`; trigger error-budget breach; owner On-call Lead.  
> Next evidence: restore rehearsal record from Data Lead.

## Common mistakes

- Treating missing, verbal, or mismatched evidence as PASS.
- Listing checks without references, timestamps, or owners.
- Hiding critical gaps inside conditions.
- Naming rollback steps without its artifact, trigger, and owner.
- Omitting NOT_APPLICABLE rationale or a report section.
