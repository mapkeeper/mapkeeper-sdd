# Claude Code implementation contract

Claude Code is the implementation and repair agent for this repository. Orca may route Codex review findings back to Claude after a failed gate.

## SDD is the source of truth

All implementation decisions must be derived from the canonical SDD under
`docs/sdd/`. Before planning or editing, read the applicable documents in this
order:

1. `docs/sdd/constitution.md` — non-negotiable project principles
2. `docs/sdd/specify.md` — product scope and user-facing requirements
3. `docs/sdd/plan.md` — architecture and implementation baseline
4. `docs/sdd/data-model.md` — domain and persistence rules
5. `docs/sdd/api-contract.md` — request, response, and validation contract
6. `docs/sdd/tasks-frontend.md` and `docs/sdd/tasks-backend.md` — implementation boundaries

`docs/qa/` contains observed findings and regression evidence. Use it to
validate the SDD and identify gaps, but do not replace or silently override the
SDD with a QA note or an agent assumption. If the requested behavior conflicts
with the SDD, stop and record the required decision or update before coding.
System, developer, and explicit user instructions remain higher priority than
repository documentation.

The user-facing Orca sequencing contract is in `ORCA_COORDINATOR.md`. Orca
routes implementation and repair Tasks to Claude and sends Codex findings back
for repair when the review gate fails.

## Before editing

- Read the user's request, this file, the applicable `docs/sdd/` files, and the repository's current diff.
- Preserve unrelated work from other agents.
- Identify the exact user-visible acceptance scenarios before changing code.
- Map the planned change to the SDD requirement, API contract, data model, or task boundary it implements.

## Implementation requirements

- Implement the smallest complete fix in the existing architecture.
- Add or update a focused regression test for subtle behavioral fixes.
- Do not treat a prompt-only instruction as a data-integrity guarantee; enforce critical invariants at the application boundary.
- Do not silently drop part of a request. Surface unsupported or unmapped parts to the user.
- Keep mock/demo behavior aligned with the real backend contract.
- Keep code, tests, mocks, and documentation aligned with the SDD; update the affected SDD section when the approved behavior changes.
- Run focused tests, then `npm run lint`, `npm run typecheck`, and `npm run build` when frontend code changes.
- For backend changes, run the relevant `pytest`, Ruff, type, and contract checks available in the workspace.

## Completion report to Orca

```text
STATUS: IMPLEMENTED | BLOCKED
CHANGED_FILES: <comma-separated paths>
SCENARIOS: <what was exercised and the observed result>
TESTS: <commands and results>
KNOWN_GAPS: <anything not verified, including missing services or Docker>
```

A successful test command is not proof of completion until the original user scenario has also been exercised. After reporting, leave the worktree in a reviewable state and wait for Codex's independent gate.

## Agent routing

If Codex reports `FAIL`, address only the listed blockers, rerun the exact reproduction, and report the before/after result. Do not rewrite the review or weaken the acceptance criteria.
