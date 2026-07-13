# Decision

Decision: GO | CONDITIONAL_GO | NO_GO  
Artifact/version: `<immutable identity>`  
Generated at: `<ISO 8601 timestamp>`  
Decision owner: `<name/role>`  
Rationale: `<critical evidence and decision rule applied>`

## Evidence matrix

Status: PASS | BLOCKED | UNKNOWN | NOT_APPLICABLE

| Category | Critical | Status | Evidence reference | Observed at | Owner | Notes / next evidence |
| --- | --- | --- | --- | --- | --- | --- |
| artifact/version | Yes/No |  |  |  |  |  |
| build/tests | Yes/No |  |  |  |  |  |
| configuration/secrets | Yes/No |  |  |  |  |  |
| data/schema | Yes/No |  |  |  |  |  |
| security | Yes/No |  |  |  |  |  |
| observability | Yes/No |  |  |  |  |  |
| rollout/canary | Yes/No |  |  |  |  |  |
| rollback artifact/procedure/triggers | Yes/No |  |  |  |  |  |
| ownership | Yes/No |  |  |  |  |  |
| post-release validation | Yes/No |  |  |  |  |  |

## Blockers and conditions

Blockers: `<items, impact, owner, clearing evidence; or None>`  
Conditions: `<non-critical gap, owner, deadline, acceptance evidence; or None>`

## Rollout

Strategy and stages: `<plan>`  
Canary cohort: `<scope>`  
Success signals: `<measures>`  
Halt criteria: `<triggers>`  
Rollout owner: `<name/role>`

## Rollback

Rollback artifact: `<immutable identity>`  
Rollback procedure: `<tested steps or runbook reference>`  
Rollback trigger: `<observable threshold/event>`  
Rollback owner: `<name/role>`  
Data recovery or roll-forward: `<procedure, constraints, recovery point>`

## Owners

Release: `<name/role>`  
Technical: `<name/role>`  
Data/schema: `<name/role>`  
Security: `<name/role>`  
Observability/incident: `<name/role>`  
Post-release validation: `<name/role>`

## Next evidence required

| Evidence needed | Category/decision affected | Owner | Due | Expected reference |
| --- | --- | --- | --- | --- |
| `<item or None>` |  |  |  |  |
