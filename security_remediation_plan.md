# Security Remediation Plan: Anonymously Writable Parse Classes

Follow-on to commit `8473dc2`, which closed the same hole for `Vampire`. That
fix was scoped to one class because that is what was reported; this plan covers
the rest of the classes that share its shape.

Everything below was measured against a running server with its own in-memory
database, not inferred from the schema. The probe scripts are described in
[Appendix: how this was measured](#appendix-how-this-was-measured) so the
results can be reproduced before anyone acts on them.

---

## What is actually true right now

One bare REST `POST` per class, carrying only the public application id and **no
session token at all**:

| Class | Anonymous create | Rows in dev DB | Legitimate creator |
|---|---|---|---|
| `Vampire` | refused (code 141) | — | `Model.create`, logged in — **fixed in `8473dc2`** |
| `VampireApproval` | refused (code 141) | — | already guarded, see `cloud/main.js:634` |
| `SimpleTrait` | **accepted** | 3096 | `Character.js`, client-side as the owner |
| `ExperienceNotation` | **accepted** | 901 | `Character.js:421`, client-side as the owner |
| `LongText` | **accepted** | 148 | `Character.js:1013`, client-side as the owner |
| `VampireCreation` | **accepted** | 297 | `Vampire.js:99`, client-side as the owner |
| `Description` | **accepted** | 1784 | `DescriptionsView.js:55`, admin bulk editor |
| `ReferendumBallot` | **accepted** | 0 | `vote_for_referendum` cloud function, `cloud/main.js:746` |
| `ChangeType` | **accepted** | 6 | nothing — zero code references |
| `InClanDisciplines` | **accepted** | 0 | nothing — zero code references |

`Vampire` and `VampireApproval` refusing is what makes the rest trustworthy:
the probe reaches a real authorization decision, so an "accepted" is a genuine
result and not a malformed request.

### The finding that sets the priority

This is not orphaned junk. An anonymous, session-less request can write rows
onto **a named player's existing character**, and the owning player sees them:

```
anonymousTraitCreated: true
anonymousXpCreated:    true
victimSeesTraits:      [{ "name": "INJECTED BY ANONYMOUS", "value": 5 }]
victimSeesXp:          [{ "reason": "INJECTED BY ANONYMOUS", "earned": 99999 }]
injectedTraitACL:      "(none - Parse default)"
```

The victim's character was created with the master key and owned by `sampmem`;
the two child rows were written with no session; the read-back was performed
**as `sampmem`**, exactly as that player's browser would. So this is live
tampering with another player's sheet and with the XP economy, by an attacker
who needs nothing but the app id — which every visitor's JavaScript already has.

Two aggravating details:

- The injected rows land with **no ACL**, so Parse defaults them to public
  read/write. They are readable and further editable by anyone.
- `SimpleTrait`'s `beforeSave` writes a `VampireChange` audit row, so injected
  traits also write into the audit log the approvals workflow reads.

### A second, smaller finding

The first version of the probe omitted `owner` and **hung `SimpleTrait`'s
`beforeSave` indefinitely** — the hook walks off the missing pointer and never
calls `response.success` or `response.error`, so the connection is held open
with no answer. Unauthenticated, and repeatable. Guarding at the top of the hook
closes this incidentally, which is an argument for putting the guard there
rather than relying on class-level permissions alone.

---

## The deployment problem, which has to be solved first

**A class-level permission change in `database_seed/_SCHEMA.json` does not reach
an existing database.** `seed_db.js:116` imports the seed directory only when
`_User` is empty. Every already-seeded deployment keeps whatever permissions its
live `_SCHEMA` collection was built with.

This is not hypothetical: the long-running dev server still reports
`create={"*":true}` for `Vampire` even though the seed file now says
`requiresAuthentication`. The commit that fixed `Vampire` is safe only because
its cloud guard does the real work.

There is already a tool for this. `audit_db_permissions.js` reads the live
`_SCHEMA` collection, reports drift, and repairs it under `--fix`; it is how
commit `07f88aa` locked down the rule classes. It also already checks for
record-level `_wperm: '*'` on `Vampire`, `SimpleTrait`, `ExperienceNotation` and
`VampireChange` — meaning it would have flagged the injected rows above after
the fact.

**So every step below has three parts, and the third is not optional:**

1. cloud guard (protects existing deployments immediately),
2. `_SCHEMA.json` (protects fresh installs),
3. `audit_db_permissions.js` expectation + `--fix` run (reconciles the two).

---

## Step 1 — Character child rows

**`SimpleTrait`, `ExperienceNotation`, `LongText`, `VampireCreation`**

The whole of the finding above. Do this first and separately from everything
else; it is the only step that touches hot write paths.

All four are per-character child rows created client-side by the character
models, always as the logged-in owner, always with
`setACL(self.get_me_acl())`. Cloud code touches them only with `useMasterKey`.
So the legitimate shape is narrow and easy to state.

**Two layers, and they are not the same layer.**

`requiresAuthentication` on create stops the anonymous attack, but it does *not*
stop a logged-in user injecting rows onto somebody else's character — every
account can still write to every character. Closing that needs an ownership
check in `beforeSave`: resolve `request.object.get("owner")` and confirm the
requesting user may write to that character.

`beforeSave("VampireApproval")` (`cloud/main.js:634-690`) already does exactly
this — owner resolution plus a role check — so it is the pattern to copy rather
than something to design. Factor it into one shared helper used by all four
classes plus `beforeDelete("SimpleTrait")` (`cloud/main.js:348`), which needs
the same treatment and currently has none.

Recommended order, so a regression is attributable:

1. Add the bare `!request.master && !request.user` guard to all four, mirroring
   the `Vampire` fix verbatim. Run the suites. This alone closes the anonymous
   attack and the hung-request vector.
2. Then add the ownership check on top, as its own commit.

**Regression risk: the highest in this plan.** These are the hottest write paths
in the app — every trait edit, every XP change, every long-text save, and the
entire creation wizard. Note that `SimpleTrait` already has a `beforeSave` doing
audit logging, so the guard goes at the top of an existing hook, as it did for
`Vampire`.

**Verify:** `traits-lifecycle`, `xp-history`, `long-texts`, `approvals`,
`character-history`, all three `creation-*`, all three `lifecycle-*`. Re-run the
injection probe and expect refusals. This is the step where the dual audit-log
parity checks in the `lifecycle-*` suites earn their keep.

---

## Step 2 — Ballot integrity

**`ReferendumBallot`**

Currently a plain client can bypass the vote flow entirely and `POST` a ballot
directly, with any `choice`, any `caster`, any `owner`, any ACL, and **as many
times as it likes**. The `vote_for_referendum` cloud function
(`cloud/main.js:746`) is where the patronage requirement and the
one-ballot-per-user check live, and none of it is reached. Zero rows exist
today, so this is a hole to close before the feature is used rather than damage
to repair.

Note the naming: `vote_for_referendum` is the cloud function;
`cast_ballot` is the *view* method that calls it, in `ReferendumView.js:59`.
Client code otherwise only ever queries ballots, never writes them.

The fix has an ordering constraint worth noticing: the function saves with
`ballot.save()` and **no master key** (`cloud/main.js:833`), so it currently
depends on the public create permission it is supposed to be the gatekeeper for.

1. Change that save to pass `{useMasterKey: true}`.
2. Only then set create/update/delete to `{}` — nobody. The master key bypasses
   class-level permissions, so the cloud function keeps working and becomes the
   *only* way a ballot can exist.

Reversing these two steps breaks voting.

**Verify:** `admin-referendums`. Add a direct-`POST` refusal case and a
double-vote attempt through the real function.

---

## Step 3 — Global reference data

**`Description`**

1784 rows feeding every picker in the app — clans, archetypes, kiths, gifts.
Anonymous create means anyone can inject options into those pickers. Existing
rows are already safe: their per-row ACLs grant write to `role:Administrator`
only, which is what `access-control` test 391 proves (code 101). It is only
*create* that is open.

Set create to `{"role:Administrator": true}`, matching the rule classes whose
identical treatment tests 382 and 383 already prove works (code 119). The only
other writer is `seed_extra.js`, which goes straight to Mongo and bypasses
class-level permissions entirely, so the backfill is unaffected.

**Verify:** `admin-rules`, `descriptions-by-creature`, `access-control` 391.

---

## Step 4 — Dead classes

**`ChangeType`** (6 rows, seeded from `database_seed/ChangeType.json`) and
**`InClanDisciplines`** (0 rows, no seed file) have **zero references** anywhere
in `public/scripts/app/` or `cloud/main.js`.

Lock both to `{}` on create/update/delete. Zero regression risk and no code to
change, so this is the cheapest item — but confirm the grep independently before
deciding whether to drop the classes and the `ChangeType.json` seed outright.
Locking is reversible; deleting seeded rows is not.

**Verify:** full suite once, since nothing should reference them.

---

## Step 5 — Make it stick

Without this, the next schema edit silently fails to deploy again.

- Add expected CLPs for every class above to `audit_db_permissions.js`, so drift
  between `_SCHEMA.json` and a live database is reported rather than assumed.
- Extend its record-level ACL audit to `LongText` and `VampireCreation`; it
  already covers `Vampire`, `SimpleTrait`, `ExperienceNotation` and
  `VampireChange`.
- Add a check for the root cause: **any** class whose live create permission is
  `{"*": true}`, so a newly added class fails the audit by default instead of
  being noticed years later. `LongText` and `ReferendumBallot` were invisible to
  the current audit precisely because they have no `class_permissions` entry in
  the seed file at all and inherit Parse's fully public default.
- Consider a permanent E2E case in the spirit of `access-control` 390b that
  sweeps the class list, so a future class added with default permissions fails
  a test rather than a manual review.

---

## Sequencing

Steps 4 and 3 are the safest and can land immediately. Step 1 is the urgent one
but carries all the regression risk, so it wants a clean run of its own. Step 2
is self-contained. Step 5 should land last, once the expectations it encodes are
final.

Suggested: **4 → 3 → 2 → 1 → 5**, by risk. Or **1 → 2 → 3 → 4 → 5** by severity
if the injection finding warrants closing first, which is defensible — it is a
live data-integrity hole and the others are not.

Each step's `--fix` run must be applied to any real deployment separately, since
none of the schema changes travel on their own.

---

## Open questions

1. **Drop or keep `ChangeType` and `InClanDisciplines`?** Locking is reversible;
   deleting the 6 seeded `ChangeType` rows is not.
2. **Ownership check now or later?** Step 1's second half is what stops
   *authenticated* cross-character tampering. It is a bigger change and could
   reasonably be its own piece of work — but leaving it undone means any logged-in
   account can still edit any character's traits and XP.
3. **Is `dist/` in scope?** It is stale, minified, and predates this branch, so
   none of these fixes reach a dist-served deployment until gulp runs. Server-side
   fixes are unaffected. This is the same caveat noted in `8473dc2`.

---

## Appendix: how this was measured

Three throwaway scripts, run against a server started from this worktree on port
1338 with its own in-memory MongoDB, so the long-running dev database on 1337
was never written to:

- **`probe.js`** — anonymous vs. authenticated create for a single class.
  Establishes the baseline and cleans up with the master key.
- **`probe-all.js`** — the same sweep across every class with public create.
  Sets a realistic `owner` pointer so unguarded hooks do not wander off a
  missing pointer, and gives every request its own timeout, because a hook that
  never answers otherwise hangs the survey.
- **`probe-injection.js`** — the severity check. Creates a character owned by
  `sampmem` with the master key, writes child rows to it with no session, then
  reads back **as `sampmem`** to see what the victim sees.

The scripts live in this session's scratchpad rather than the repo; the
permanent form of this coverage belongs in the E2E suite per step 5.
