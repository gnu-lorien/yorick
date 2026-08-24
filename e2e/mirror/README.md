# mirror — drive several builds at once and diff them

Record a click-through once, replay it against every build of Yorick you have
running, and get back a page showing where they stopped agreeing.

This is not part of the E2E suite. The suite starts its own backends on 1337+
and asserts known-good behaviour; the mirror talks to servers you started
yourself, asserts nothing, and reports differences. Use it when the question is
"are these two builds the same?" rather than "is this build correct?".

## Run it

Start each build on its own port first — one per checkout. Then:

```bash
node e2e/mirror/record.js login
```

Click through the flow in the window that opens, then close it. That writes
`e2e/mirror/recordings/login.js`. Replay it everywhere:

```bash
node e2e/mirror/run.js e2e/mirror/recordings/login.js --targets "legacy=http://127.0.0.1:41337,react=http://127.0.0.1:43337,vue=http://127.0.0.1:42337"
```

Windows tile left to right in target order. Every action screenshots all of
them, diffs each against the first, and prints a line:

```
  [ ok ] 001 goto("http://127.0.0.1:41337/")
  [DIFF] 002 getByRole("button", {"name":"Login"}).click() 4.10%
```

The run lands in `mirror-out/<timestamp>/` with `report.html` — screenshots
side by side, diff masks under them, and a toggle to hide everything that
matched. Exit code is 1 if anything diverged, so it works in a script.

Set `MIRROR_TARGETS` in your environment to stop passing `--targets` every
time. See `targets.js` for the default.

## Logging in once

Recording the login every time gets old:

```bash
node e2e/mirror/record.js --save-storage e2e/mirror/.auth.json
```

Log in, close the window, then start every later recording already
authenticated:

```bash
node e2e/mirror/record.js character-sheet --load-storage e2e/mirror/.auth.json
```

That only affects *recording*. Replay always starts from a clean context, so a
recording that needs a login must contain one.

## How it works

`page` in a recording is not a Playwright page. It is a recursive proxy
(`fanout.js`) wrapping one real page per build: reading a property reads it
from all of them, and calling a method calls it on all of them. Locator chains
work because a call returning locators produces another proxy, and only a call
returning promises is awaited.

Three things follow from that, and they are the whole reason this is a
directory rather than a snippet:

- **Awaited values come back as arrays**, one entry per build, in target order.
  Codegen output never reads values so this never bites a raw recording, but
  hand-written ones must not branch on a returned value as if it were a scalar.
  It is also the easiest way to compare state that never reaches the screen —
  see the count check in `recordings/example-module.js`.

- **`expect()` does not work through the mirror.** Assert against entries in
  the `pages` array instead.

- **Failures are attributed per build.** If a click works on two builds and
  times out on the third, the error names the third, and a screenshot is taken
  before the run stops. That moment is usually the finding.

Recorded absolute URLs are re-pointed at each build's own origin
(`targets.js`), so a session recorded against legacy does not quietly send
every window to legacy — which would show three builds in perfect agreement
for the worst possible reason.

## Tuning

Anti-aliasing, carets and half-finished jQuery Mobile transitions all produce
pixel noise. Defaults that matter:

| Flag | Default | What it is for |
| --- | --- | --- |
| `--settle <ms>` | 300 | Pause before shooting, so animations land |
| `--tolerance <ratio>` | 0.005 | Differing-pixel ratio still called a match |
| `--threshold <0..1>` | 0.15 | How different one pixel must be to count |
| `--timeout <ms>` | 10000 | How long an action waits before it is a divergence |
| `--window <WxH>` | 640x1000 | Size of each tiled window |
| `--full-page` | off | Capture whole scroll height, not just the viewport |
| `--headless` | off | No windows; still screenshots and diffs |
| `--slow-mo <ms>` | 0 | Slow the replay down enough to watch |

Raise `--settle` first if steps diverge and the diff mask is a blur of moving
content. Raise `--tolerance` if it is a scatter of single pixels along text
edges. If the diff is a solid block, it is real.

## Limits

- Screenshots must be the same size to compare cleanly. Different window sizes
  are padded to match and the padding counts as a difference, deliberately.
- Targets are assumed to be bare origins. A target URL with a path prefix will
  not have that prefix applied to recorded absolute URLs.
- Dynamic content — timestamps, ids, anything ordered by insertion — diffs
  every run. Either seed the builds identically or accept a noise floor and set
  `--tolerance` above it.
- `e2e/helpers/auth.js` and friends mostly work when handed the mirror, but
  `loginAs` branches on an awaited `page.evaluate` result. Through the mirror
  that value is an array, which is always truthy, so it takes the "already
  logged in as someone else" path. Record the login instead, or call the helper
  once per entry in `pages`.
