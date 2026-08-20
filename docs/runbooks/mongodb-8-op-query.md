<!--
Written 2026-08-20 running S10 Step 5 -- "MongoDB 8.2.6 with nothing else
changed", the step the plan calls the only free experiment in S10.

It was free, and it was over in twenty seconds. The answer is not about the
storage engine at all.
-->
# Step 5: MongoDB 8.2.6, and why the experiment cannot be run

**Short version.** Under `MONGODB_BINARY_VERSION=8.2.6` the backend does not
boot. Not a test failure, not a slow failure — the first database call the
process makes is refused by the server, `index.js:210-213` catches it and
`process.exit(1)`s, and Playwright reports `Process from config.webServer was
not able to start`. The gate exits **2, DID NOT RUN**.

```
MongoError: Unsupported OP_QUERY command: find. The client driver may require an upgrade.
  code: 352, codeName: 'UnsupportedOpQueryCommand'
  at mongodb-core/lib/cursor.js:247
```

**The layer is the driver.** Not the storage engine, not parse-server, not
`cloud/`. And the consequence for the plan is bigger than the result: **Step 5's
premise is dead.** MongoDB cannot be moved as a single variable against the
unchanged stack, because `mongodb@3.1.1` cannot speak to any MongoDB that
removed the legacy opcodes. The mongo move is welded to the driver move, and the
driver move is welded to Step 13.

---

## 1. What was measured

| run | binary | gate | result |
|---|---|---|---|
| `s10-mongo826` | 8.2.6 | **exit 2** | run aborted; 0 tests returned a verdict; 448 baseline passes unmeasured |
| `s10-mongo-control` | 4.4.18 (default) | **exit 0** | 451 discovered, 448 still passing, 0 NEW-FAIL, 0 LOST, 3 skipped |

Both against `runs/s10-baseA.json`, both at `e5fe9b7`, nothing changed between
them but the environment variable. The control also passed both quarantined
tests (49 and 114) outright, so the tree was green at the time and the binary
version is the only variable in play.

## 2. The experiment was real — proof, not assumption

The obvious way to get a worthless answer here is for the environment variable to
be silently ignored and 4.4.18 to be measured twice. Four independent checks say
it was not:

- **Both binaries are cached and are what they claim.** `~/.cache/mongodb-binaries/`
  holds `mongod-x64-win32-4.4.18.exe` and `mongod-x64-win32-8.2.6.exe`; run with
  `--version` they self-report `db version v4.4.18` and `db version v8.2.6`.
- **The variable reaches a Playwright-started backend.** `playwright.config.js`'s
  `webServer[].env` sets five keys and does not mention this one, and Playwright
  merges `{...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...options.env}`
  (`node_modules/playwright/lib/runner/index.js:857-862`), so the parent's value
  survives. That is the source reading; the live proof is the failing run itself,
  where the backend that died was worker 0's — `In-memory MongoDB started at
  mongodb://127.0.0.1:9992/anotherstore_w0`, a database name only
  `playwright.config.js` sets. Had the variable been dropped, that backend would
  have booted on 4.4.18 and the suite would have run.
- **The server on the other end really is 8.2.6, over the wire.** A standalone
  probe using the same expression as `index.js:83` gets `maxWireVersion 27` from
  the handshake (4.4.18 gives 9), and `buildInfo` answers `{"version":"8.2.6"}`
  from the running instance.
- **The failure is version-specific, not environmental.** The identical probe
  against 4.4.18 does `find`, `insert` and `buildInfo` without complaint.

## 3. Which layer, and why it can only be the driver

The probe that fails contains **no parse-server, no cloud code and no
application code** — it is `mongodb@3.1.1` and a mongod, nothing else:

```
asked for   : 8.2.6      asked for   : 4.4.18
maxWireVersion=27        maxWireVersion=9
OK   buildInfo           OK   buildInfo
FAIL find    code=352    OK   find
FAIL insert  code=352    OK   insert
```

`mongodb-core@3.1.0` — the transport under `mongodb@3.1.1` — has exactly two
wire-protocol handlers, `2_6_support.js` and `3_2_support.js`, and **there is no
`OP_MSG` path in either**; `grep -r OP_MSG node_modules/mongodb-core/lib` is
empty. Every operation is framed as an `OP_QUERY`:

- writes — `wireprotocol/3_2_support.js:145`
- `find` — `:611`
- everything else, including plain `db.command()` — `:667`

MongoDB removed support for the legacy opcodes for ordinary commands, and 8.2.6
enforces it. What still answers over `OP_QUERY` is only the handshake pair:
measured on 8.2.6, `isMaster` and `buildInfo` succeed and **`ping`,
`listCollections`, `count`, `createIndexes` and `insert` all fail with 352**.
That is why the boot gets as far as connecting and printing a URI before dying —
the connection is genuinely established, and then the first real statement is
refused.

So there is no configuration, no flag and no code change in this repo that makes
this work. It is a wire-protocol incompatibility one layer below anything S10
was going to touch.

**It is not confined to the seeder either**, even though the seeder is what
happens to run first (`index.js:104` into `seed_db.js:171`, a `find` on
`_User`). parse-server 2.8.4 loads the same hoisted driver —
`MongoStorageAdapter.js:47` and `GridStoreAdapter.js:8` are both a bare
`require('mongodb')`, and there is no nested copy under
`node_modules/parse-server/` — so every query, every save and every file write
would take the same path.

## 4. What this does NOT mean

**It says nothing about a production upgrade.** Production is **5.0.32 Community,
self-hosted** (§7 of the plan, owner-stated). This experiment ran against the
harness's in-memory mongod and nothing else. Two things follow, and neither was
measured here:

- 5.0.32 is, upstream, the last release *before* the opcode removal — which is
  consistent with production working today, and is presumably why nobody has hit
  this. **Untested here; no 5.x binary is cached and none was downloaded.**
- Any production move to 5.1 or later is blocked by the same driver, in the same
  way, and therefore cannot be scheduled independently of Step 13. A storage
  upgrade that looks like an ops task is actually a dependency of the app bump.

**It does not answer the `filemd5` question.** That was the specific thing Step 5
was supposed to look at: `mongodb@3.1.1`'s GridStore issues `filemd5` on every
file write (`node_modules/mongodb/lib/gridfs/grid_store.js:1168`, and
`if (err) return callback(err)` on the next line, so a missing command is fatal
to the write rather than cosmetic). **The run never reached a portrait**, or any
test at all, so that unknown in §7 stays exactly as open as it was. It moves to
Step 13, where the driver will be new and the question becomes a different one.

## 5. Consequences for the plan

- **Step 5 is answered and closed, but not the way §5 expected.** It has removed
  a variable, in the sense that it has proven the variable cannot be moved alone.
  Budget spent: two gate runs and three scratch probes, well under the 30 minutes
  allowed.
- **The harness's mongod version is not a free knob.** It is pinned at 4.4.18 by
  `mongodb@3.1.1`, and anything from 5.1 up is unreachable until the driver
  changes. Do not spend another cycle on this before Step 13.
- **Re-run this experiment *after* the bump, not before**, and expect the pairing
  to invert: parse-server 9 pins a mongodb 7.x driver, and modern drivers drop
  support for old servers as readily as old drivers drop new ones. **Check the
  new driver's minimum supported server version at Step 13 — 4.4.18 may become
  the binary that fails.** Upstream knowledge, unverified here. This matters
  beyond the harness: it is the same question for production's 5.0.32.
- **This strengthens Step 13's "re-pin `mongodb`" note** (§0). The driver is not
  an incidental transitive dependency whose version is a tidiness concern; it is
  the component that decides which MongoDB releases the application can talk to
  at all.
