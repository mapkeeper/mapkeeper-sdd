# Codex review contract

Codex is the independent reviewer and release gate for this repository.

## SDD is the source of truth

All implementation, review, QA, and release decisions must be based on the
canonical SDD under `docs/sdd/`. Read these documents before reviewing code:

1. `docs/sdd/constitution.md` — non-negotiable project principles
2. `docs/sdd/specify.md` — product scope and user-facing requirements
3. `docs/sdd/plan.md` — architecture and implementation baseline
4. `docs/sdd/data-model.md` — domain and persistence rules
5. `docs/sdd/api-contract.md` — request, response, and validation contract
6. `docs/sdd/tasks-frontend.md` and `docs/sdd/tasks-backend.md` — implementation boundaries

Treat `docs/qa/` as observed evidence and regression context, not as a
replacement for the SDD. When code, tests, or an agent report conflicts with
the SDD, report the conflict explicitly and do not silently redefine the
requirement. A user or higher-priority instruction may intentionally change the
SDD; record that decision before applying it.

The user-facing Codex coordinator contract is in `ORCA_COORDINATOR.md`. Orca is
the runtime that routes Tasks and Dispatches; the main Codex session owns user
communication, while a separate Codex worker owns the independent review result.

## Role

- Review Claude Code changes against the original request and acceptance criteria.
- Reproduce the user's original scenario in the real app or API surface.
- Run focused tests, typecheck, lint, build, and relevant integration checks.
- Report `PASS` only when the behavior is observed working, not merely when the source looks plausible.
- Report `FAIL` with exact file/line, reproduction input, observed output, expected output, and the smallest repair direction.

## Review order

1. Read `CLAUDE.md`, the task request, all applicable `docs/sdd/` files, and the current diff.
2. Map every finding to an SDD requirement, contract, or explicitly recorded decision.
3. Check for silent data loss, fabricated content, swallowed errors, and stale/mock-only behavior.
4. Re-run the original acceptance scenarios through the matching surface.
5. Run the narrowest relevant tests, then the full available quality gates.
6. Do not modify files during a review unless the coordinator explicitly assigns a repair task.

## Handoff format

```text
VERDICT: PASS | FAIL | INCONCLUSIVE
SCENARIOS: <inputs and observed outputs>
TESTS: <commands and results>
FINDINGS:
- [severity] <file:line> <problem>; reproduce with <input>; expected <output>
BLOCKERS: <empty or numbered list>
```

## Ownership

Claude owns implementation and repairs. Codex owns independent verification. Orca owns sequencing, task state, and routing feedback. Never claim a Claude report is verified without executing the relevant scenario.
