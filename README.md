# Trash-automation

Keep this outside `~/Documents`: macOS blocks launchd background jobs from reading `~/Documents`, so the scheduled runs silently failed there.

Submits two Baltimore 311 "Dirty Alley Cleaning" requests every Monday and Thursday at 11:30 AM via Playwright at https://balt311.baltimorecity.gov/citizen/s/.

## Configuration

Copy `config.example.js` to `config.js` and fill in your contact details and the
addresses you want submitted. `config.js` is not committed.

Each entry sets the side of the street, whether the debris is over 100 lb, whether
it obstructs traffic, and a free-text description. The `days` field controls which
scheduled weekdays that address is submitted on (Mon=1 ... Sun=0).

Addresses missing from the 311 site's address table can instead be located by
clicking the map at their coordinates — see `mapTarget` in `submit.js`.

## Files
- `submit.js` — the Playwright script. Reads `SUBMISSIONS`/`CONTACT` from `config.js`.
- `run.sh` — wrapper the scheduler calls.
- `logs/` — one log per run plus confirmation/error screenshots and `cron.log`.

## Usage
```sh
node submit.js                  # submit today's scheduled addresses (filters by weekday)
node submit.js --all            # submit every address regardless of day
node submit.js --only "Rose"    # submit matching addresses (comma-separated substrings)
node submit.js --dry-run        # fill everything but stop before Submit (combines with above)
```

## Schedule
Runs via launchd (not cron — crontab is blocked by macOS permissions in this setup):
`~/Library/LaunchAgents/com.example.trash311.plist` triggers `run.sh` at every login (RunAtLoad) and at Mon/Thu 11:30 AM. The wrapper tracks the last covered Monday and Thursday in `logs/last-run-{1,4}.txt` and submits any slot whose most recent occurrence hasn't run yet — so a day missed while the laptop was off or logged out is caught up at the next login, and nothing double-submits. A failed run leaves the state file untouched and retries at the next trigger.

Manage:
```sh
launchctl list | grep trash311                                        # status
launchctl bootout gui/$(id -u)/com.example.trash311                    # disable
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.trash311.plist  # re-enable
```
