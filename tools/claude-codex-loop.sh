#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/claude-codex-loop.sh --task "<implementation objective>" [options]

Options:
  --run <run_id>          Reuse an existing Orca Run. Omit to create a new Run.
  --worktree <selector>   Orca worktree selector (default: current).
  --max-rounds <n>        Maximum Codex review rounds (default: 5).
  --timeout-ms <n>        Wait timeout per worker result (default: 900000).
  --help                  Show this help.
EOF
}

RUN_ID=""
WORKTREE="current"
MAX_ROUNDS=5
TIMEOUT_MS=900000
OBJECTIVE=""

while (($# > 0)); do
  case "$1" in
    --task) OBJECTIVE="${2:?--task requires a value}"; shift 2 ;;
    --run) RUN_ID="${2:?--run requires a value}"; shift 2 ;;
    --worktree) WORKTREE="${2:?--worktree requires a value}"; shift 2 ;;
    --max-rounds) MAX_ROUNDS="${2:?--max-rounds requires a value}"; shift 2 ;;
    --timeout-ms) TIMEOUT_MS="${2:?--timeout-ms requires a value}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf '알 수 없는 옵션: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$OBJECTIVE" ]]; then
  printf '%s\n' '--task가 필요합니다.' >&2
  usage >&2
  exit 2
fi

for command in orca jq rg; do
  command -v "$command" >/dev/null || { printf '%s 명령을 찾을 수 없습니다.\n' "$command" >&2; exit 2; }
done

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mapkeeper-orca-loop.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT

run_orca_json() {
  local output_file="$1"
  shift
  orca "$@" --json >"$output_file" 2>&1
}

last_json() {
  sed '/^{"_keepalive":/d' "$1" | jq -s '.[-1]'
}

create_run() {
  local output_file="$TEMP_DIR/create-run.json"
  run_orca_json "$output_file" orchestration run-create \
    --objective "Claude 구현 후 Codex 독립 검증 루프: $OBJECTIVE"
  RUN_ID="$(last_json "$output_file" | jq -r '.result.run.id')"
  printf 'RUN: %s\n' "$RUN_ID"
}

create_task() {
  local title="$1" spec="$2" slug="$3"
  local output_file="$TEMP_DIR/task-${slug}.json"
  run_orca_json "$output_file" orchestration task-create \
    --run "$RUN_ID" --task-title "$title" --spec "$spec"
  last_json "$output_file" | jq -r '.result.task.id // .result.taskId // .result.id'
}

start_worker() {
  local task_id="$1" agent="$2" slug="$3"
  local output_file="$TEMP_DIR/start-${slug}.json"
  run_orca_json "$output_file" orchestration worker-start \
    --run "$RUN_ID" --task "$task_id" --worktree "$WORKTREE" --agent "$agent"
  last_json "$output_file" | jq -r '.result.dispatchId // .result.dispatch_id'
}

release_worker() {
  local dispatch_id="$1"
  [[ -z "$dispatch_id" || "$dispatch_id" == "null" ]] && return 0
  orca orchestration worker-release --dispatch "$dispatch_id" --json >/dev/null
}

wait_for_worker() {
  local dispatch_id="$1" slug="$2"
  local output_file="$TEMP_DIR/wait-${slug}.json"
  orca orchestration check --run "$RUN_ID" --wait \
    --types worker_done,escalation,question --timeout-ms "$TIMEOUT_MS" \
    --json >"$output_file" 2>&1

  local result delivery_id message
  result="$(last_json "$output_file")"
  delivery_id="$(jq -r '.result.deliveryId // empty' <<<"$result")"
  if [[ "$(jq -r '.result.timedOut // false' <<<"$result")" == "true" ]]; then
    local worker_state worker_failure worker_wait worker_terminal
    worker_state="$(orca orchestration worker-show --dispatch "$dispatch_id" --json)"
    worker_failure="$(jq -r '.result.dispatch.last_failure // .result.worker.last_error // empty' <<<"$worker_state")"
    worker_wait="$(jq -r '.result.terminal.agentWait.reason // empty' <<<"$worker_state")"
    worker_terminal="$(jq -r '.result.terminal.handle // empty' <<<"$worker_state")"
    if [[ -n "$worker_failure" || -n "$worker_wait" ]]; then
      [[ -n "$worker_failure" ]] && printf 'Dispatch 실패: %s\n' "$worker_failure" >&2
      [[ -n "$worker_wait" ]] && printf '작업자 대기 사유: %s\n' "$worker_wait" >&2
      [[ -n "$worker_terminal" ]] && printf '터미널: %s\n' "$worker_terminal" >&2
      exit 3
    fi
    printf 'Dispatch 결과를 TIMEOUT까지 받지 못했습니다: %s\n' "$dispatch_id" >&2
    exit 3
  fi
  message="$(jq -c --arg dispatch "$dispatch_id" '
    .result.messages
    | map(select(.type == "worker_done" and ((.payload | try fromjson catch {}).dispatchId == $dispatch)))
    | .[-1] // empty
  ' <<<"$result")"
  if [[ -z "$message" ]]; then
    printf '%s\n' "$result" >&2
    [[ -n "$delivery_id" ]] && orca orchestration check --run "$RUN_ID" --ack "$delivery_id" --json >/dev/null
    printf '대상 Dispatch의 worker_done을 받지 못했습니다: %s\n' "$dispatch_id" >&2
    exit 3
  fi
  WAIT_MESSAGE="$message"
  WAIT_DELIVERY="$delivery_id"
}

ack_delivery() {
  [[ -z "${WAIT_DELIVERY:-}" ]] && return 0
  orca orchestration check --run "$RUN_ID" --ack "$WAIT_DELIVERY" --json >/dev/null
  WAIT_DELIVERY=""
}

[[ -z "$RUN_ID" ]] && create_run

claude_task="$(create_task "Claude 구현" "TASK: $OBJECTIVE

ROLE: 구현 및 수정 담당.
SOURCE OF TRUTH: 반드시 docs/sdd/constitution.md, specify.md, plan.md, data-model.md, api-contract.md, tasks-frontend.md, tasks-backend.md를 읽고 그 기준으로 구현하라.
REQUIREMENTS: 원래 사용자 시나리오를 실제 앱 또는 API에서 재현하고, 관련 회귀 테스트와 품질 검사를 실행하라. docs/qa는 관찰된 증거로만 사용하고 SDD를 임의로 덮어쓰지 말라.
REPORT: STATUS, CHANGED_FILES, SCENARIOS, TESTS, KNOWN_GAPS를 보고하라." "claude-initial")"
claude_dispatch="$(start_worker "$claude_task" claude "claude-initial")"
printf 'Claude started: task=%s dispatch=%s\n' "$claude_task" "$claude_dispatch"

for ((round = 1; round <= MAX_ROUNDS; round += 1)); do
  wait_for_worker "$claude_dispatch" "claude-${round}"
  claude_report="$(jq -r '.body' <<<"$WAIT_MESSAGE")"
  printf '\n[round %d] Claude completed\n%s\n' "$round" "$claude_report"

  codex_task="$(create_task "Codex 독립 검토 round $round" "TASK: $OBJECTIVE

ROLE: 독립 검토·재현 담당. Claude가 방금 수정한 현재 작업 트리를 검토하라.
SOURCE OF TRUTH: docs/sdd/ 전체를 읽고 모든 판정을 SDD와 대조하라. docs/qa는 검증 증거로 참조하라.
VERIFY: 원래 사용자 시나리오를 실제 앱 또는 API에서 재현하고, 테스트·lint·typecheck·build와 관련 통합 검사를 실행하라. silent data loss, fabricated content, PII, mock-only behavior, 계약 불일치를 확인하라.
OUTPUT: 반드시 VERDICT: PASS 또는 VERDICT: FAIL 또는 VERDICT: INCONCLUSIVE 중 하나를 포함하라. FAIL이면 파일·라인·입력·기대 결과·실제 결과·최소 수정 방향을 제시하라. 기본 검토에서는 파일을 수정하지 말라.
CLAUDE REPORT:
$claude_report" "codex-${round}")"
  codex_dispatch="$(start_worker "$codex_task" codex "codex-${round}")"
  printf 'Codex started: task=%s dispatch=%s\n' "$codex_task" "$codex_dispatch"
  ack_delivery
  release_worker "$claude_dispatch"

  wait_for_worker "$codex_dispatch" "codex-${round}"
  codex_report="$(jq -r '.body' <<<"$WAIT_MESSAGE")"
  codex_subject="$(jq -r '.subject' <<<"$WAIT_MESSAGE")"
  printf '\n[round %d] Codex result: %s\n%s\n' "$round" "$codex_subject" "$codex_report"

  if printf '%s\n%s\n' "$codex_subject" "$codex_report" | rg -q 'VERDICT:[[:space:]]*PASS|^PASS([:[:space:]]|$)'; then
    ack_delivery
    release_worker "$codex_dispatch"
    printf '\nPASS: Codex가 round %d에서 검증을 승인했습니다.\n' "$round"
    exit 0
  fi

  if printf '%s\n%s\n' "$codex_subject" "$codex_report" | rg -q 'INCONCLUSIVE|question|escalation'; then
    ack_delivery
    release_worker "$codex_dispatch"
    printf '\n자동 루프를 중지합니다. Codex 검토가 INCONCLUSIVE 또는 사용자 결정을 요구했습니다.\n' >&2
    exit 4
  fi

  ack_delivery
  release_worker "$codex_dispatch"
  claude_task="$(create_task "Claude 수정 round $round" "TASK: Codex의 FAIL 지적사항만 수정하라.

SOURCE OF TRUTH: docs/sdd/ 전체를 다시 읽고 SDD 기준으로 수정하라. 기존에 통과한 동작은 회귀시키지 말라.
VERIFY: Codex가 제시한 동일 입력을 실제 앱 또는 API에서 다시 재현하고, 관련 회귀 테스트와 품질 검사를 실행하라.
REPORT: STATUS, CHANGED_FILES, SCENARIOS, TESTS, KNOWN_GAPS를 보고하라.

CODEX FINDINGS:
$codex_report" "claude-${round}")"
  claude_dispatch="$(start_worker "$claude_task" claude "claude-${round}")"
  printf 'Claude repair started: task=%s dispatch=%s\n' "$claude_task" "$claude_dispatch"
done

printf '최대 검토 횟수(%s)에 도달했지만 Codex PASS를 받지 못했습니다.\n' "$MAX_ROUNDS" >&2
exit 5
