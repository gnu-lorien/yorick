# Runbook: close the anonymous-write holes in production

**Status:** not yet applied to production.
**Severity:** live remote data-integrity vulnerability.
**Evidence:** `toimport/20260703.archive` (production dump, `heroku_hj6ccl7z`,
2026-07-03), inspected read-only during the 2026-08-17 engineering review.
**Independent of the modernization project.** Nothing here needs a Parse,
MongoDB, or Node upgrade. Run it whenever you like; sooner is better.

---

## What is wrong

`seed_db.js:114` imports `database_seed/` **only when `_User` is empty**:

```js
if (userCount === 0) {
  console.log('Seeding database from database_seed directory...');
```

Production has had users continuously. So every class-level permission
hardened by `26d07f2`, `f080012`, `8473dc2`, and `a90664e` landed in
`database_seed/_SCHEMA.json` and in freshly-seeded test databases, and **never
reached production**. The 397 Playwright tests cannot see this: they always run
against a cold, seeded database that does receive the hardened schema.

`audit_db_permissions.js` already documents this exact failure mode in the
`EXPECTED_CREATE_CLP` docstring — `--fix` was written to reconcile it. It has
simply never been pointed at production.

### Measured production state (2026-07-03)

382 users, 2,857 characters, 107,115 traits. 29 `_SCHEMA` entries, **2 with no
`class_permissions` key at all**, and **23 classes publicly writable**.

Eleven allow anonymous `create`, `update`, and `delete`:

```
ChangeType          CharacterPortrait   ExperienceNotation  InClanDisciplines
SimpleTrait         TroupePortrait      Vampire             VampireApproval
VampireCreation     bnsmetv1_ClanRule   bnsmetv1_ElderDisciplineRule
bnsmetv1_RitualRule bnsmetv1_TechniqueRule
```

Eight more allow anonymous `addField` only (schema pollution, lower severity):
`CategoryProperties`, `CharacterRelationship`, `Patronage`, `PaymentPaypal`,
`Payment_PayPal`, `Troupe`, `VampireChange`, `_Role`.

### Which holes are real

Parse checks the class-level permission **and** the row's ACL. A loose CLP is
survivable when every row carries a restrictive `_wperm`. Row-level coverage in
the same archive:

| Collection | Rows | rows with no `_wperm` | Anonymously writable |
|---|---:|---:|---:|
| VampireChange | 174,875 | 0 | 0 |
| SimpleTrait | 107,115 | 0 | 0 |
| ExperienceNotation | 78,506 | 0 | 0 |
| Vampire | 2,857 | 0 | 0 |
| **VampireCreation** | **2,856** | **2,856** | **2,856** |
| **VampireApproval** | **544** | **544** | **544** |
| LongText | 413 | 0 | 0 |
| CharacterPortrait | 243 | 0 | 0 |

So the exposure is:

1. **Anonymous `create` on every class in the list above.** Not protected by row
   ACLs — there is no row yet. This is what `8473dc2` ("anonymous visitors could
   create characters") fixed in the seed file.
2. **Anonymous `update`/`delete` on `VampireCreation` (2,856) and
   `VampireApproval` (544).** No `_wperm` on any row, so nothing backstops the
   loose CLP.
3. Anonymous write to the five `bnsmetv1_*` game-rule classes.

**`--fix` alone does not close #2.** For classes in `EXPECTED_CREATE_CLP` it
sets only `class_permissions.create` (`audit_db_permissions.js:180-184`) and
deliberately leaves `update`/`delete` alone, on the reasoning that row ACLs
filter them. That reasoning holds everywhere except these two classes.

---

## The commands

Run from a checkout of this branch. Substitute your production URI.

```bash
export PROD_URI='mongodb://USER:PASSWORD@your-droplet:27017/heroku_hj6ccl7z?authSource=admin'
```

### Step 0 — back up first, and prove the backup restores

```bash
mongodump --uri="$PROD_URI" --archive=./pre-clp-fix-$(date +%Y%m%d).archive --gzip
```

Restore it somewhere disposable and confirm it opens before you change anything.

### Step 1 — read-only audit, so you see the real current state

```bash
node audit_db_permissions.js "$PROD_URI"
```

Exits 1 if it finds errors. Expect failures; capture the output for comparison.

### Step 2 — apply the auditor's repair

```bash
node audit_db_permissions.js "$PROD_URI" --fix
```

This sets `create` per `EXPECTED_CREATE_CLP`, replaces the whole CLP on the five
`bnsmetv1_*` / `bnsctdbs_*` rule classes with `EXPECTED_RULE_CLP`, and catches
any class with a missing `class_permissions` key.

### Step 3 — close update/delete on the two classes with no row ACLs

`--fix` does not do this. Run it directly against `_SCHEMA`:

```bash
mongosh "$PROD_URI" --eval '
  ["VampireCreation", "VampireApproval"].forEach(function (c) {
    var r = db.getCollection("_SCHEMA").updateOne(
      { _id: c },
      { $set: {
          "_metadata.class_permissions.update": { requiresAuthentication: true },
          "_metadata.class_permissions.delete": { requiresAuthentication: true },
          "_metadata.class_permissions.addField": { "role:Administrator": true }
      } }
    );
    print(c + ": matched=" + r.matchedCount + " modified=" + r.modifiedCount);
  });
'
```

`requiresAuthentication` is the minimum that stops anonymous writes without
guessing at role structure. Tighten further once step 5 backfills real ACLs.

### Step 4 — close the addField-only classes

Lower severity (schema pollution, not data loss), but they are the classes a
future audit will trip over:

```bash
mongosh "$PROD_URI" --eval '
  ["CategoryProperties","CharacterRelationship","Patronage","PaymentPaypal",
   "Payment_PayPal","Troupe","VampireChange","_Role"].forEach(function (c) {
    var r = db.getCollection("_SCHEMA").updateOne(
      { _id: c },
      { $set: { "_metadata.class_permissions.addField": { "role:Administrator": true } } }
    );
    print(c + ": matched=" + r.matchedCount + " modified=" + r.modifiedCount);
  });
'
```

### Step 5 — restart parse-server

Parse caches the schema in memory. The CLP changes do not take effect on a
running dyno.

```bash
heroku restart --app greensboro-yorick
```

### Step 6 — verify

```bash
node audit_db_permissions.js "$PROD_URI"        # expect exit 0
npm run test:e2e                                # against staging, not production
```

Then confirm by hand that a logged-out browser cannot create a character.

---

## Follow-up, not urgent

**Backfill `_wperm` on `VampireCreation` and `VampireApproval`.** Steps 3 and 4
close the CLP, which stops anonymous writes, but these 3,400 rows still carry no
row-level ACL — so any *authenticated* user can write any of them. Every other
character-owned class derives `_wperm` from the owning character. The correct
fix is a one-time migration setting each row's `_wperm`/`_rperm` from its owning
`Vampire`, after which the CLPs can drop back to matching the other classes.

**Gate the seeder.** `index.js:57` runs `seed_db.seedDatabase()` unconditionally
at boot with no `NODE_ENV` guard, and `seedTestUsers` upserts `devuser` with a
known password and `admininterface: true`, matching on `username` alone. Any
deploy of this branch against production data plants an admin account. Gate it
before deploying anything.

**Two payment classes.** Production has both `PaymentPaypal` and
`Payment_PayPal`. One is probably dead. Worth finding out which.
