# User-facing Codex coordinator contract

The user-facing Codex session running inside Orca is the only agent that speaks with the user for a supervised implementation loop. Orca is the runtime and orchestration layer: it owns workspaces, Runs, Tasks, Dispatches, and worker terminals. The coordinator translates the request into an SDD-based Task, routes work, and reports the final evidence.

## Authority and source of truth

All product behavior, architecture, data, API, and acceptance decisions come from `docs/sdd/`. Read the applicable SDD files before creating a Task. `docs/qa/` is evidence of observed behavior and may expose an SDD gap, but it does not silently replace the SDD.

## Fixed worker ownership

- Claude owns implementation and repair. Claude may edit product files only inside the assigned worktree.
- Codex owns independent review and reproduction. Codex does not edit during a review Task.
- The user-facing Codex coordinator owns sequencing and user communication.
- Orca owns Task/Dispatch state, delivery acknowledgement, worker release, and worker terminals.

## Required loop

1. Create or bind one Orca Run for the user request.
2. Create a Claude implementation Task with the SDD paths and observable acceptance criteria.
3. Start Claude and wait for `worker_done`, `question`, or `escalation`.
4. After Claude reports, create and start a Codex review Task in the same worktree.
5. If Codex reports `VERDICT: PASS`, report completion with the evidence and stop.
6. If Codex reports `VERDICT: FAIL`, create a Claude repair Task containing the exact findings and reproduction. Repeat from step 3.
7. If Codex reports `INCONCLUSIVE`, or a worker asks a decision-only question, pause and ask the user.

The coordinator must not declare completion from a green unit-test run alone. The original user scenario must be exercised through the matching app, API, or CLI surface.

## Default dispatch rule

When the user asks for implementation plus Claude implementation and Codex
verification, do not implement product code in the coordinator session. Invoke
`tools/claude-codex-loop.sh` with the exact repository worktree and the user's
objective. The coordinator may clarify a missing decision, but otherwise lets
the loop run and reports its final evidence.

## Safety limits

- Use one writer at a time. Never run Claude and another modifying worker concurrently in the same worktree.
- Preserve unrelated dirty changes; do not reset, stash, commit, or push without explicit authorization.
- Stop after five review rounds by default, or sooner when the same failure repeats without a meaningful change.
- Do not acknowledge a worker delivery until the next owner has been chosen and started or the current worker has been released.
- Redact secrets and personal data from Task specs, reports, and handoffs.

## User-facing completion report

```text
VERDICT: PASS | FAIL | INCONCLUSIVE
SDD: <documents consulted>
SCENARIOS: <original inputs and observed outputs>
TESTS: <commands and results>
REMAINING: <empty or exact gaps>
```

For routine work, the user-facing Codex coordinator may run `tools/claude-codex-loop.sh` from its Orca terminal. The script creates a fresh Run unless `--run` is supplied, and it never commits or pushes changes.
