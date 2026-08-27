# The E2E suite runs against a build, not a dev server

This is a note for anyone porting the front end -- React, Vue, whatever comes
next -- and it exists because the mistake it describes is invisible. There is no
symptom. The suite runs, the tests pass or fail, and the results describe code
that is no longer on disk.

## The shape of the problem

`playwright.config.js` serves a *static document root*. The legacy app is
`public/`; a port is its build output (`dist-react/` for React). The config
deliberately does not build:

> The React build is not made here. Run `npm run build:react` first; building
> inside the config would rebuild once per worker process.

That is the right decision -- N workers must not each run Vite -- but it leaves
the freshness of the artifact to whoever typed the command. So:

| how it is run | builds first? |
| --- | --- |
| `node e2e/run-react.js` | yes, and a failed build aborts before any test |
| `YORICK_E2E_CLIENT=react npx playwright test` | **no** -- serves whatever is in `dist-react/` |

Both are things people type. The second is what you reach for when re-running a
single spec, which is exactly when you have been editing.

Two failure modes follow, and neither announces itself:

- **A green run that proves nothing.** You fix a bug, re-run the spec, it
  passes. It was passing before your fix, against this morning's build.
- **A red run you then debug.** You chase a defect you already fixed, in code
  the build predates.

Note that a dev server is not the answer. The suite must exercise the artifact
users are served -- a Vite dev server has different module resolution, no
minification, and its own HMR runtime. Test the build; just make sure it is
*this* build.

## The guard

`e2e/global-setup.js` compares the newest file mtime under the source directory
against the newest under the build directory, and refuses to run when source is
newer. It is the first thing global setup does -- before fixtures, before
seeding, before any server is touched -- because it invalidates the entire run
and nothing is gained by preparing databases for results nobody can believe.

```
[e2e] dist-react/ is older than web/ by 53 minute(s), so this run would test a
stale build rather than the working tree. Run `node e2e/run-react.js` (it builds
first), or set E2E_ALLOW_STALE_BUILD=1 to run against the build as it is.
```

Three behaviours worth copying exactly:

- **Missing build gets its own message.** "There is no `dist-react/` to serve"
  plus the command that makes one. A zero mtime compared against a real one
  would otherwise report the build as infinitely stale, which is true and
  unhelpful.
- **There is an escape hatch.** `E2E_ALLOW_STALE_BUILD=1` downgrades it to a
  warning, for the two legitimate cases: bisecting a build, and re-checking an
  old report against the artifact that produced it. The warning says the results
  describe the build rather than the working tree, so it stays in the log.
- **It only fires for the port.** The legacy path is untouched -- `public/` is
  the source, so there is nothing to be stale.

## Doing this for another port

Change three things and the rest transfers:

1. **The env var that selects the front end.** Here it is `YORICK_E2E_CLIENT=react`;
   use whatever yours is, and gate the check on it so legacy runs skip it.
2. **The two directories.** Source and build -- `web/` and `dist-react/` here.
   Point them at yours.
3. **The directories to skip while walking source.** `node_modules`, and
   anything a build *writes into* under the source tree. A build output inside
   the source directory will otherwise make every run look stale, because the
   build is by definition the newest thing in it.

The walk itself is a recursive `readdirSync(dir, {withFileTypes: true})` taking
`Math.max` of `statSync(...).mtimeMs`, and it should take single-digit
milliseconds. Only *file* mtimes count: directory mtimes change when a temp file
is created and deleted inside them, which would make the check fire at random.

Verify all four states before you believe it, because a guard that never fires
and a guard that always passes look identical from outside:

- fresh build -> proceeds
- source newer than build -> throws, with the age in the message
- source newer, `E2E_ALLOW_STALE_BUILD=1` -> warns, proceeds
- no build directory -> throws the "there is no build" message

The cheap way to test the middle two is `touch <source>/__probe.tmp`, run
`node -e "require('./e2e/global-setup.js')().catch(e => console.log(e.message))"`,
then delete the probe. That runs the real check without starting Playwright, and
because only file mtimes count, deleting the probe leaves no trace.

## The related trap, already guarded

Same family, different cause: Playwright **reuses a server already listening on
the port it wants**. The two front ends differ only in that server's document
root, so alternating a legacy run and a port run on one port silently tests
whichever app was still up. During the React port a "legacy regression check"
was really a second React run -- 26 green tests against the wrong app.

Two defences, both worth having:

- `e2e/ports.js` gives the port its own port block (`+50`), so the collision is
  unlikely.
- `e2e/global-setup.js` fetches `index.html` from every backend and refuses to
  start if the app serving it is not the one asked for, so the collision is
  impossible to believe.

Between them and the freshness check, the three ways a run can quietly describe
the wrong code -- wrong app, wrong build, no build -- all fail loudly instead.
