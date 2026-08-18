# The harness works. The suite has a 2-test noise floor.

**Measured 2026-08-17 on `claude/office-hours-upgrade-plan-092d60`**, at commit
`cd5443e` (the merge of `topic/massive-upgrades`) plus the S1 isolation fix.

This is the S4 gate from the unattended execution order, and it did not pass.
The gate exists so that this is discovered in 90 minutes rather than after six
hours of work built on an oracle that cannot be trusted.

## The measurement

Two full-suite runs, **same commit, same machine, nothing changed between them**,
compared with `diff-runs.js`:

```
  2  NEW-FAIL   regressions
  0  new-pass
421  same-pass
  1  same-fail  already broken
 26  skipped
  1  flaky
```

A run diffed against an unchanged copy of itself should be all `same-*`. The two
`NEW-FAIL` entries are false regressions — the noise floor:

| Test | File | Passes in isolation? |
|---|---|---|
| `49 A third user votes for the same option as the first; that tally reaches 2` | `admin-referendums.spec.js` | **yes** |
| `355b The log's own Next button advances the rendered page` | `lifecycle-werewolf.spec.js` | known-flaky, being diagnosed in `1d2b0cd` |

## Why this blocks the migration, specifically

Every phase exit in the modernization plan is "diff run clean". With a noise
floor of 2, a run showing three new failures after the `parse@8.6.0` swap is
ambiguous: it could be one real regression plus the usual two, or three
unrelated flakes. There is no way to tell without re-running, and re-running
changes which tests flake. The oracle stops being an oracle.

Fixing the noise floor is worth more than any single phase of the migration,
because every phase depends on it.

## Separately: test 114 is a real, reproducible failure

Not noise. `114 Renaming to collide with an existing character name succeeds`
in `assets-rename-portrait.spec.js` fails **solo, at one worker**, and fails
identically on the pre-S1 code — so it is pre-existing in the merged
`topic/massive-upgrades` work and not caused by the isolation fix.

```
Error: expected jQuery Mobile page "#character-rename" to become active within
20000ms; active page is "#character-log", hash is "#character/BfJhPSLHlU/rename"
    at waitForActivePage (e2e/helpers/jqm-helpers.js:68)
    at navigateToHash   (e2e/helpers/jqm-helpers.js:130)
    at renameCharacter  (e2e/assets-rename-portrait.spec.js:200)
```

The hash changes but jQuery Mobile never completes the transition off
`#character-log`. That is the same-page transition-queue problem `a6c978e`
("drain the jQuery Mobile transition queue on the same-page path") addresses,
so it is squarely in work already in flight rather than something new.

Because the specs in a file build shared `state` across tests, this one failure
strands the remaining 14 tests in that file as "did not run".

## Run-to-run variance observed

Five full runs of effectively identical code:

| Run | Workers | passed | failed | flaky | did not run |
|---|---|---|---|---|---|
| 1 | 8 | 446 | 0 | 1 | 0 |
| 2 | 8 | 444 | 0 | 3 | 0 |
| 3 | 8 | 421 | 3 | — | 23 |
| 4 | 8 | 431 | 1 | 1 | 14 |
| 5 | **4** | 426 | 2 | 1 | 18 |

Halving the worker count did not help, so this is not purely CPU contention.
Runs 1 and 2 were not "better code" — their flakes happened to recover on the
single retry.

## What would clear the gate

In rough order of value:

1. **Fix 114.** It is reproducible solo, which makes it the easiest to work on
   and the one blocking 14 other tests. Same root cause family as `a6c978e`.
2. **Fix 49 and 355b's waits.** Both pass in isolation and fail under load,
   which means the wait is racing an animation rather than asserting on a
   settled state. `retries: 1` currently hides them as "flaky" when they
   recover — that is honest reporting, but it is also why the noise floor was
   not obvious before it was measured.
3. **Re-run this gate.** `E2E_RUN_NAME=a npx playwright test`, then
   `E2E_RUN_NAME=b npx playwright test`, then
   `npm run test:diff -- runs/a.json runs/b.json`. It must report **0 NEW-FAIL**.
   That is the definition of the harness being quiet against itself.

Until then the differential harness is built, tested and ready, but it cannot
distinguish a migration regression from the suite's own jitter.

## What is safe to build in the meantime

Work whose correctness does not depend on the E2E oracle:

- Karma on headless Chrome, so the 120 stranded Jasmine tests run again.
- `parse-compat/` and its unit tests — the shims are plain modules and their
  contract is provable without a browser round trip.

Work that must wait for a clean gate: the `parse@8.6.0` client swap, the cloud
adapter, and the parse-server bump. All three are verified by "diff run clean"
and nothing else.
