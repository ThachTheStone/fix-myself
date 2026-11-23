# Task: Block rule activity in the weekly review (BLK-10)

## Goal
The Review page shows, for each site, how many visits a **Block** rule stopped, how many visits a **Pause** rule paused,
and how many passes were taken, with the hours of the day they happened, plus the reasons entered for passes. This is
separate from the existing focus "blocked attempts" report.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: BLK-03, BLK-04, BLK-10, REV-03, acceptance test A-11 (last sentence).
- Code: `extension/worker.js` (`KEEP_DAYS`, `localDay`, `recentDays`, `report`, `recordAttempt`, `grantPass`,
  `describe`), `extension/manifest.json`, `desktop/focus-bridge.cjs` (`validReport`, `MAX_REPORT_BYTES`),
  `app/model.js` (`recordChromeReports`, `attemptsBetween`, `distractionReview`), `app/main.js` (`renderReview`,
  `renderDistractions`), `index.html` (Review view), `tests/bridge.test.js`, `tests/model.test.js` (REV-03 tests).

## Decisions already made
**Extension (`extension/worker.js`)**
- New `chrome.storage.local` key `ruleEvents`, shaped `{ [day]: { [host]: { block: { [hour]: n }, pause: { [hour]: n },
  pass: { [hour]: n } } } }`. `day` comes from `localDay()`, `hour` is `String(new Date().getHours())` ("0" to "23").
  Only the kinds that happened are present.
- New key `passReasons`, shaped `{ [day]: [{ host, hour, reason }] }`, holding only non-empty reasons, at most 20 per
  day (drop new ones past 20). `reason` is already trimmed to 200 characters in `grantPass`.
- Add `recordRuleEvent(kind, host, reason)`. It updates both keys and keeps only `recentDays(...)` days, like
  `recordAttempt`.
- In `describe(host)`, after the target is found: when `target.mode` is `'block'`, record `'block'`; when it is
  `'pause'`, record `'pause'`. Do not record for `'focus'`, because focus attempts are already counted by `recordAttempt`.
- In `grantPass`, after storing the pass, record `'pass'` with the reason.
- `report()` also sends `ruleEvents` and `passReasons` for the same recent days as `attempts`.
- Manifest version `0.3.0` → `0.4.0`.

**Bridge (`desktop/focus-bridge.cjs`)**
- `MAX_REPORT_BYTES` 16_384 → 65_536.
- `validReport` accepts optional `ruleEvents` and `passReasons`; missing → `{}`. Reject the whole report (return
  `null`) when: more than 40 days; a day key fails `DAY`; more than 100 hosts in a day; a host fails `DOMAIN`; a kind
  that is not `block`, `pause` or `pass`; an hour key that is not `"0"` to `"23"`; a count that is not a safe integer
  from 0 to 100_000; more than 20 reasons in a day; a reason entry whose `host` fails `DOMAIN`, whose `hour` is not an
  integer 0 to 23, or whose `reason` is not a string of 1 to 200 characters. The cleaned report carries both fields.

**Model (`app/model.js`)**
- `recordChromeReports` stores `ruleEvents` and `passReasons` on the profile exactly like `attempts` (newer report's
  days replace the old ones per day).
- New `export function ruleReview(state, startDay, endDay, today)`: sums all profiles over the days from `startDay` to
  `min(endDay, today)`. Returns `{ connected, bySite, reasons }`:
  - `bySite`: `[{ domain, block, pause, pass, hours }]`, where `block`, `pause` and `pass` are totals and `hours` is an
    array of 24 numbers (all three kinds added together per hour). Sort by `block + pause + pass` descending, then
    domain. Leave out sites with zero of everything.
  - `reasons`: `[{ day, domain, hour, reason }]`, newest day first, then hour descending.
  - `connected` as in `distractionReview`.

**Review UI**
- In the Review view, add a section after the existing distraction section: heading "Block rules", help text
  "Visits your block rules stopped or paused, separate from focus sessions." and an empty state "No block rule
  activity in this period." when `bySite` is empty.
- Each site is a list item: the domain, then "{block} blocked · {pause} paused · {pass} passes" (use plural keys as in
  existing `t()` usage), then "Busiest hours: 21:00 (4), 22:00 (2)" listing at most the 3 hours with the highest
  non-zero counts, ordered by count then hour, with times formatted `HH:00`.
- Below, "Reasons for passes" with each reason as "Mon 23 Nov, 21:00 · youtube.com: <reason>" using the existing date
  formatter, or "No reasons entered." when empty. Reasons are shown as text, never as HTML.
- Every new string goes through `t()` with English and Vietnamese, under the `ruleReview.` prefix.

## Steps
1. Extension recording and report fields.
2. Bridge validation, with tests in `tests/bridge.test.js` (a valid report passes; one invalid case per rule above
   returns `null`; an old report without the new fields still passes).
3. `recordChromeReports` and `ruleReview`, with tests in a new `tests/rulereview.test.js` (two profiles summed, day
   range limited to today, hours array, sort order, zero sites left out, reasons order).
4. Review UI. Add to `tests/browser.e2e.js` a test that seeds `localStorage` `fix-myself:v1` with a state containing
   `chrome.profiles` with `ruleEvents` and `passReasons` for today (build it by loading the page once, reading the
   saved state, editing it in `page.evaluate`, then reloading), opens Review, and checks the counts line, the busiest
   hours line and one reason.
5. README "Block rules" section: one sentence about the review. `docs/ARCHITECTURE.md` BLK row: move BLK-10 from
   "remaining" to done.

## Out of scope
- Do not change how rules are enforced, the pause page (`extension/blocked.js`), focus attempt counting, `SRS.md`,
  or anything about app presets.

## Tests that define "done"
- `npm test`, `npm run build`, `git diff --check`, `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test. It skips itself because `FIX_MYSELF_WORKER` is set; leave that alone.

## Commit
- Branch: `agent/blk-10-review`. Base: the commit the worktree starts from.
  Commit trailer: `Co-Authored-By: Cline (DeepSeek) <noreply@cline.bot>`.
- Commit your work before you finish; uncommitted work counts as not done. Do not commit `AGENT_BRIEF.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Never stop, kill or restart any process you did not
start, whatever holds a port. Stay inside this worktree, do not rewrite history, do not change `SRS.md`. If a decision
above seems wrong, stop and say so in your final message instead of choosing differently.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
