<!--
Written 2026-08-21, for the owner, deliberately in plain language.

The other runbooks in this directory are working documents: they use lettered
blockers, numbered commits and internal shorthand that only makes sense from
inside them. This one does not refer to any of that. It is the single list of
what has to happen to put the migrated app in front of real players, in the
order it has to happen, with what to check after each step.

Everything here was verified against the tree and a locally running server on
2026-08-21, EXCEPT the items explicitly marked as unverified. Nothing in this
file has been run against production.
-->

# Going live

**Where things stand: the code is done and the deployment is not.**

The server upgrade and the private-accounts work are both complete and pushed
to `topic/parse8-migration`. What is left is nine steps, of which only two are
code. The rest is configuration, one maintenance window, and looking at the
real site afterwards.

Read step 0 before scheduling anything, because it is the one that is owed and
has not been done.

---

## 0. Run the test suite against all of it

**Nobody has done this yet, and it is the single biggest gap in what has been
handed to you.**

Every change since the migration bump has been checked with unit tests, with
`curl` against a local server, and with JavaScript run in a browser console.
Those found real defects. But the 448-test Playwright suite — the thing this
repo is actually built around — has not run against any of it.

```bash
node gate.js --name pre-deploy --baseline runs/s10-baseA.json
```

This runs the suite and compares it to the recorded pre-migration results. It
takes a while and starts eight backends.

**Only exit code 0 means proceed.** `1` means something regressed, `2` means the
run did not actually happen, `3` means it could not tell. Do not read `1` as
"the only bad case" — a wrapper that checks for `1` alone treats "did not run"
as success, which is the exact hole this script exists to close.

If it exits `3`, it prints a narrower command to re-run; require a `0` from
that.

**One thing to expect:** the private test account added during this work
(`sampprivate`) is new. If a test asserts an exact number of accounts somewhere,
it will fail, and that is the fixture doing its job rather than a regression.
It lives in a troupe the Playwright suite never touches, so this is unlikely —
but if a count assertion fails, that is why.

---

## 1. Decide the mail question

Password reset does not work and cannot work until this is answered.

With no mail provider configured, the server uses an in-memory adapter that
captures outgoing mail and sends nothing. That is deliberate — it is what stops
the test suite mailing real people — but on a live site it means the reset
button appears to work and no email ever arrives.

You need to either pick a provider and set `MAIL_ADAPTER_MODULE` to a module
that exports a factory, or decide that password reset stays broken for now and
tell players so. **There is no third option where it quietly works.**

This is the only item on this page that needs a decision rather than an action.

---

## 2. Set the configuration on the server

These go on the `greensboro-yorick` Heroku app before the first boot, not after.

| variable | value | why |
|---|---|---|
| `DB_URI` | already set | Confirmed present. The code now reads either `DB_URI` or `MONGODB_URI`, so no rename is needed. |
| `PUBLIC_SERVER_URL` | `https://greensboro-yorick.herokuapp.com/parse/1` | See below — this one is not optional. |
| `MASTER_KEY` | your existing key | Rotate it once the permissions work below is done; it has been sitting in a file on a local disk. |
| `APPLICATION_ID` | your existing id | |
| `MAIL_ADAPTER_MODULE` | from step 1, or leave unset | |

**Two that must NOT be set:**

- **`MOUNT_PATH`** — this used to do nothing and now really works. Setting it
  moves where the API lives, and every URL the front end has been built with
  would then 404.
- **`YORICK_ALLOW_SEED`** — this permits the database to be seeded with test
  accounts, including one whose password is published in this repository, as an
  administrator. It matches on username alone, so it would also overwrite a real
  player who happens to have that name. It belongs to the test harness and
  nowhere else. If you are ever copying an environment block from the test
  configuration, this is the line to delete.

**Why `PUBLIC_SERVER_URL` is not optional.** The server tells itself where it
lives using this value, and character portraits are the thing that depends on
it: when a portrait is uploaded, the server fetches the file back over HTTP
from this address in order to crop and thumbnail it. If the address is wrong,
that fetch fails and the portrait save is **refused outright** — not a broken
thumbnail, no portrait at all — and each attempt leaves an abandoned file in
the database that nothing ever cleans up. It is also the address baked into
password-reset links.

The old default pointed at a hosting service that shut down years ago. The
server now refuses to start rather than fall back to it, so a missing value
fails loudly at deploy instead of quietly at the first upload.

---

## 3. Check how the front end is built

**This is a genuine unknown and only you can answer it.**

The front end is a static site, built by `gulp` and published separately from
the server. This branch now has a `greensboro` build target that produces the
correct output, verified locally:

```bash
npx gulp greensboro
```

What nobody can determine from the repository is **what Netlify actually runs.**
There is no `netlify.toml`, no build script in `package.json`, and no workflow
file that names a build command. "Netlify runs `gulp greensboro`" is an
assumption inherited from the other branch.

Open the Netlify site's Build & deploy settings and confirm the build command.
If it is something else, that something else needs to exist on this branch.

Note also that the `dist/` directory committed in this repository is a build
from **August 2021**. It cannot run the migrated app — it still bundles the
2015 version of the Parse client library. Do not treat it as a fallback, and be
careful not to commit a rebuilt one by accident, because that directory is what
gets published and rebuilding it points the live site at whichever target the
rebuild used.

---

## 4. Deploy the server

Push the branch to Heroku. Then, before doing anything else:

```bash
heroku logs -a greensboro-yorick --tail
```

**Look for the server refusing to start.** Two of the changes deliberately
crash on a misconfiguration rather than starting up wrong: a missing database
address, and a missing `PUBLIC_SERVER_URL`. If either is wrong you will see a
plain-English error naming the variable. That is the design working. Fix the
variable and redeploy.

If it starts, log in as yourself and confirm the site loads before going
further.

---

## 5. The maintenance window

Two database repairs, in this order, in one window, with one restart at the end.
**Take a database backup first and prove it restores.**

### 5a. Permissions

Right now, 23 classes in production are publicly writable, and eleven of those
allow anonymous create, update **and delete** — meaning someone who is not
logged in can alter character data. That is a live vulnerability and it has
nothing to do with the migration; it predates it.

```bash
node audit_db_permissions.js "$PROD_URI"        # look first, changes nothing
node audit_db_permissions.js "$PROD_URI" --fix  # then repair
```

The same command also repairs a second problem the upgrade introduced. The new
server has a permission for counting rows that the old one did not, and your
database has no setting for it — which the new server reads as "nobody may
count anything." The app uses counting to decide whether you are an
administrator, so **without this repair the entire admin section goes dead for
everyone, including you, on the first page load after deploy.**

The order matters and is handled inside the tool: it repairs the broad
permissions first and the counting permission second, because doing it the
other way round silently undoes the second.

### 5b. Existing accounts

New accounts are now private automatically. The 382 that already exist are not,
and never will be on their own — the setting only applies when an account is
created. You approved closing them.

```bash
node close_user_acls.js "$PROD_URI"            # dry run, the default
node close_user_acls.js "$PROD_URI" --apply    # writes
node close_user_acls.js "$PROD_URI" --verify   # re-read and confirm
```

**Run the dry run first and keep its output.** This is the only irreversible
step on this page. It saves every row's original permissions into a backup
collection before touching anything and aborts if that backup is incomplete;
`--restore` puts it back.

`--verify` prints a line reading `MISSING THEIR OWN ID`. **If that line names
any account, restore from the backup immediately.** An account that loses its
own permission entry does not fail to log in — it logs in successfully with no
information attached, every permission check silently failing, and nothing in
the server log. It would do that to everyone at once.

### 5c. Restart

```bash
heroku restart -a greensboro-yorick
```

Not optional. The server caches permissions in memory and neither repair takes
effect until it restarts.

---

## 6. Check the admin section works

Log in as yourself and open the administration pages. This is the only check
that the counting repair worked; nothing automated covers it.

If the admin section is dead, the counting permission did not apply — re-run
`audit_db_permissions.js` and confirm you restarted.

---

## 7. Test PayPal before a payment window

**Do this before real money moves through it, not after.**

Payments arrive at `/deez`, create a payment record, and a trigger turns that
into a subscription. Nothing in any test suite touches this path, and it has a
property worth knowing: **if the subscription fails to save, the error is
written to the log and nothing else happens.** The payment succeeds, the player
gets nothing, and no one is told. That was true before this migration too.

Point a PayPal **sandbox** notification at the deployed `/deez` with the item
name exactly `Underground Theater Yearly Yorick`, status `Completed`, and the
custom field set to a real account id. Then confirm three things in order,
because each failure looks like the next:

1. a payment record was created;
2. the log says `afterSave PaymentPaypal Received a paypal payment`;
3. a subscription exists for that account, expiring one year after payment.

If 1 worked and 3 did not, the reason was swallowed and is in the application
log, not the error log.

While you are in there: production has both a `PaymentPaypal` and a
`Payment_PayPal` class. One is probably dead. Worth settling.

---

## 8. Then look at the rest of it

In rough order of what costs most to get wrong:

- **Upload a new character portrait, and open an old one.** File storage
  changed underneath this upgrade. Existing files should still be readable, but
  no test covers files that already exist.
- **Log in as a real player** and confirm their character sheet and their
  troupe's character list look right.
- **Have someone sign up a brand-new account**, give it a character in a
  troupe, and confirm a storyteller can see that character *and* the owner's
  name on the troupe list. This is the whole point of the private-accounts
  work, and it is the one thing that could not be tested against anything but a
  fabricated account.
- **Open someone else's character sheet as a storyteller, edit one trait, then
  confirm the player can still open their own sheet.** There was a defect where
  doing this transferred the character's permissions to whoever opened it. It
  is fixed, but any character edited by a storyteller *since the upgrade* may
  already have wrong permissions stored. This is how you find out.
- **Password reset end to end**, if you configured mail in step 1.

---

## One thing that is still open

The permission change that closes the member list is in this repository's
schema file, and that file only ever reaches an **empty** database. It will not
apply itself to production.

Reconciling it into the live database is a step nobody has written yet, and it
is the last piece of the private-accounts work. It is safe to defer: everything
else in that work stands without it, and the member list is already served
through the server rather than read directly by the browser. What it buys is
that no future code *can* re-open the member list by accident.

Do the rest first and come back to it.
