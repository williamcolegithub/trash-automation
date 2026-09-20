# Trash-automation

Keep this outside `~/Documents`: macOS blocks launchd background jobs from reading `~/Documents`, so the scheduled runs silently failed there.

Submits two Baltimore 311 "Dirty Alley Cleaning" requests every Monday and Thursday at 11:30 AM via Playwright at https://balt311.baltimorecity.gov/citizen/s/.

## Why a browser, and not an API

Baltimore was an early Open311 adopter. In 2011 the city deployed the
[GeoReport v2](https://wiki.open311.org/GeoReport_v2/) standard with a public
endpoint at `311.baltimorecity.gov/open311/v2/`, issuing API keys to developers
so they could build apps that both read and file service requests. Open311
[wrote about it at the time](https://www.open311.org/2011/09/baltimore/).

That endpoint is gone. Checked 2026-09-20:

| URL | Result |
| --- | --- |
| `https://311.baltimorecity.gov/open311/discovery.json` | 404, redirects to the main city site |
| `http://311.baltimorecity.gov/open311/v2/services.json` | 404, redirects to the main city site |
| `https://balt311.baltimorecity.gov/open311/discovery.json` | 401, redirects to a login page |

Service requests now go through a vendor portal (Salesforce) with no documented
programmatic interface. Historical request data is still published on
[Open Baltimore](https://data.baltimorecity.gov/datasets/baltimore::311-customer-service-requests-2025/explore),
but reading past requests is not the same as filing one.

So filing a routine request without a human means driving the form.

## Terms of use

Checked 2026-09-20. Nothing found that prohibits automated submissions:

- **No terms of use document.** `baltimorecity.gov/terms-use` and
  `baltimorecity.gov/disclaimer` both return 404.
- **The [privacy policy](https://www.baltimorecity.gov/privacy-policy)** covers
  data collection only. It says nothing about automated access, bots or
  scraping, and references no separate terms document.
- **`balt311.baltimorecity.gov/robots.txt` allows all robots** (`User-agent: *`,
  `Allow: /`), excluding only the password reset page. This is the Salesforce
  platform default rather than a deliberate city policy, but it is the
  published instruction to automated clients.
- **No login is involved**, so no account terms are accepted. Contact details
  are submitted as ordinary form fields on a public page.

Absence of a prohibition is not the same as permission — no one has granted
anything, there is simply no rule. Re-check before relying on this; the portal
is a vendor product and its policies can change without notice.

**Independent of any of this: only file requests for conditions that are
actually there.** Knowingly filing false reports with a government agency is an
offense, and no terms analysis changes that.

## Configuration

Copy `config.example.js` to `config.js` and fill in your contact details and the
addresses you want submitted. `config.js` is not committed.

Each entry sets the side of the street, whether the debris is over 100 lb, whether
it obstructs traffic, and a free-text description. The `days` field controls which
scheduled weekdays that address is submitted on (Mon=1 ... Sun=0).

### Addresses the site cannot find

Some addresses are missing from the portal's address lookup — alley segments in
particular. Those entries set `mapTarget` instead of a search term, and the
location is chosen by clicking the map at its coordinates.

The usual way to do that is to reach the Leaflet map object from page
JavaScript and call `latLngToContainerPoint()`, which converts coordinates to
an exact pixel. That is not available here: the portal runs on Salesforce, and
the map instance is not reachable from an injected script.

So the projection is measured instead of assumed. Two probe clicks a known
distance apart give degrees per pixel on each axis. The target is panned into a
clear part of the map, away from the info panel that overlays one corner and
swallows clicks. Then each click is corrected against the coordinates the
site's own reverse-geocode response reports for it, because Leaflet pans with
inertia and the first attempt lands close but not exact. Two or three rounds
converge.

See `pickByMapClick` in `submit.js`.

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
