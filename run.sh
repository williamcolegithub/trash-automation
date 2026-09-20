#!/bin/zsh
# Wrapper for the Baltimore 311 dirty-alley submissions.
# Called by launchd at login and at Mon/Thu 11:30. For each slot (Monday=1,
# Thursday=4) it checks whether the most recent occurrence of that weekday has
# already been covered (state files in logs/) and runs it if not — so a day
# missed while the laptop was off/logged out is caught up at the next login.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")"
mkdir -p logs

today_w=$(date +%u)   # 1=Mon .. 7=Sun

for slot in 1 4; do
  diff=$(( (today_w - slot + 7) % 7 ))
  due=$(date -v-${diff}d +%Y-%m-%d)
  state="logs/last-run-${slot}.txt"
  last=$(cat "$state" 2>/dev/null)
  if [[ "$last" != "$due" ]]; then
    echo "[$(date)] slot $slot due $due (last: ${last:-never}) — running" >> logs/cron.log
    if /opt/homebrew/bin/node submit.js --day $slot >> logs/cron.log 2>&1; then
      echo "$due" > "$state"
    else
      echo "[$(date)] slot $slot run FAILED; will retry at next trigger" >> logs/cron.log
    fi
  fi
done
