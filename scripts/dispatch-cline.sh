#!/usr/bin/env bash
# Runs one Cline worker round on a task brief in its own git worktree, then checks the result.
#
#   scripts/dispatch-cline.sh <task> <brief.md> [base-ref]
#
# <task>      lower-case name, e.g. blk-10-review. Branch: agent/<task>. Worktree: ../<repo>-<task>.
# <brief.md>  the brief to give the worker (docs/briefs/<task>.md). Copied into the worktree as AGENT_BRIEF.md,
#             which git ignores. Run again with the same <task> and a new brief for a fix round.
# [base-ref]  where a new branch starts (default HEAD). Ignored when the worktree already exists.
#
# Environment: CLINE_PROVIDER (default deepseek), CLINE_MODEL (default deepseek-v4-flash), CLINE_RETRIES (default 6),
# CLINE_TIMEOUT in seconds (default 5400). Cline gets no keyboard input, so it cannot wait on a prompt.
# FIX_MYSELF_WORKER=1 is set for the worker, so the Chromium extension test skips itself instead of fighting the
# desktop app for port 42631. The report flags process-stopping commands in the log and user processes that vanished.
# Logs and the report go to .agent-runs/<task>/ in the main repository (git-ignored).
# Sending the code to the provider is the user's decision: see docs/MULTI_AGENT.md.
set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

task=$1
brief=$2
base=${3:-HEAD}
provider=${CLINE_PROVIDER:-deepseek}
model=${CLINE_MODEL:-deepseek-v4-flash}
retries=${CLINE_RETRIES:-6}
timeout_s=${CLINE_TIMEOUT:-5400}

if ! [[ $task =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]]; then
  echo "Task name must be lower-case letters, digits and dashes." >&2
  exit 2
fi
[ -f "$brief" ] || { echo "Brief not found: $brief" >&2; exit 2; }
command -v cline >/dev/null || { echo "The cline command is not installed." >&2; exit 2; }

repo=$(git rev-parse --show-toplevel)
worktree="$(dirname "$repo")/$(basename "$repo")-$task"
branch="agent/$task"
runs="$repo/.agent-runs/$task"
mkdir -p "$runs"
brief_abs=$(cd "$(dirname "$brief")" && pwd)/$(basename "$brief")

# Paths for Windows programs (cline is a Node program) when running under Git Bash.
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

exclude="$(git -C "$repo" rev-parse --git-common-dir)/info/exclude"
case $exclude in /*|[A-Za-z]:*) ;; *) exclude="$repo/$exclude" ;; esac
grep -qx 'AGENT_BRIEF.md' "$exclude" 2>/dev/null || echo 'AGENT_BRIEF.md' >> "$exclude"

if [ -d "$worktree" ]; then
  echo "Reusing worktree $worktree"
else
  git -C "$repo" worktree add -b "$branch" "$worktree" "$base"
  (cd "$worktree" && npm ci --no-audit --no-fund)
fi

round=$(( $(find "$runs" -maxdepth 1 -name 'round-*.log' | wc -l) + 1 ))
log="$runs/round-$round.log"
report="$runs/round-$round.report.md"
cp "$brief_abs" "$worktree/AGENT_BRIEF.md"
cp "$brief_abs" "$runs/round-$round.brief.md"
start_commit=$(git -C "$worktree" rev-parse HEAD)

# Processes the worker must leave alone (docs/MULTI_AGENT.md). Compared after the run.
watched() {
  if command -v powershell.exe >/dev/null; then
    powershell.exe -NoProfile -NonInteractive -Command \
      "Get-Process -Name electron,'Fix Myself',chrome,Code -ErrorAction SilentlyContinue | ForEach-Object { \$_.Id.ToString() + ' ' + \$_.ProcessName }" \
      2>/dev/null | tr -d '\r' | sort
  fi
}
before_procs=$(watched)
started=$(date +%s)

echo "Round $round of $task with $provider/$model. Log: $log"
set +e
(cd "$worktree" && FIX_MYSELF_WORKER=1 cline -P "$provider" -m "$model" -c "$(winpath "$worktree")" --retries "$retries" --timeout "$timeout_s" \
  "Read AGENT_BRIEF.md in the working directory and complete the task it describes. Follow every hard rule in it and in docs/MULTI_AGENT.md, section 'Quy tắc bắt buộc cho worker'.") \
  < /dev/null > "$log" 2>&1
cline_status=$?
set -e
duration=$(( $(date +%s) - started ))
vanished=$(comm -23 <(printf '%s\n' "$before_procs") <(watched) | sed '/^$/d')
stops=$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -n -i -E 'Stop-Process|taskkill|kill -|pkill|killall|\.Kill\(' | head -20 || true)

check() { # name, command...
  local name=$1; shift
  if (cd "$worktree" && "$@") > "$runs/round-$round.$name.txt" 2>&1; then echo "| $name | pass |"; else echo "| $name | **fail** (see round-$round.$name.txt) |"; fi
}

{
  echo "# $task, round $round"
  echo
  echo "- Worker: Cline ($(command -v cline)), $provider/$model. Exit status: $cline_status. Duration: $((duration / 60)) min $((duration % 60)) s."
  echo "- Branch: $branch. Worktree: $worktree. Started from: $start_commit."
  echo "- Brief: $brief (copy: round-$round.brief.md). Worker log: round-$round.log."
  echo
  echo "## New commits"
  echo '```'
  git -C "$worktree" log --oneline "$start_commit..HEAD"
  echo '```'
  echo
  echo "## Uncommitted changes"
  echo '```'
  git -C "$worktree" status --short
  echo '```'
  echo
  echo "## Process rule"
  if [ -z "$stops" ] && [ -z "$vanished" ]; then
    echo "Pass: no process-stopping commands in the log and no watched process ended."
  else
    echo "**Fail.** Check whether the worker stopped a process it did not start (docs/MULTI_AGENT.md)."
    [ -n "$stops" ] && { echo; echo "Log lines:"; echo '```'; echo "$stops"; echo '```'; }
    [ -n "$vanished" ] && { echo; echo "Ended during the run (PID name; may also be closed by you):"; echo '```'; echo "$vanished"; echo '```'; }
  fi
  echo
  echo "## Checks"
  echo "| Check | Result |"
  echo "|---|---|"
  check unit npm test
  check build npm run build
  check whitespace git diff --check "$start_commit"
  check browser node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js
  echo
  echo "The Chromium extension test is not run here; run \`npm run test:browser\` with the desktop app closed."
  echo
  echo "## Next"
  echo "Review the diff (\`git -C \"$worktree\" diff $start_commit\`), ideally with the reviewer subagent, then record the round in docs/agent-runs.md."
} > "$report"

cat "$report"
