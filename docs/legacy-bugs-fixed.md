# Resolutions for the bugs found during the React port

Companion to `legacy-bugs-found-during-react-port.md` (written on the React
port branch, `claude/migrate-project-react-69c438`). That document catalogues
fifteen defects in `public/scripts/`; this one records what was done about
each, and where the resolution differs from what it prescribed.

Every entry is covered by a test. Two files hold them:

- `test/legacy-bug-regressions.test.js` — 20 tests, `npm run test:node`, about
  150ms. Anything decidable without a browser: collection ordering, the
  clan-rule page size, template guards, markup shape.
- `e2e/legacy-bug-regressions.spec.js` — 20 tests, `npx playwright test
  e2e/legacy-bug-regressions.spec.js`, about a minute. Anything that needs a
  rendered page and a real server.

Both suites were run against the **unfixed** sources before being trusted.
Twelve of the twenty node tests and fifteen of the twenty E2E tests fail there.
The rest are deliberate controls — a correct-behaviour anchor beside each
defect, so a test cannot pass by breaking the thing next to it.

## What changed

| # | Resolution | Files |
|---|---|---|
| 0 | Guarded the empty timeline; `loading("hide")` moved into `.always()` and a failure report added | `views/CharacterApprovalView.js`, `routers/mobileRouter.js` |
| 1 | `role.get("name")`, plus skips for a role with no name and for a global role that names no troupe | `views/PlayerOptionsView.js` |
| 2 | Dead branch deleted, all three copies and all five assignments | `collections/{Vampires,Users,Patronages}.js`, `routers/mobileRouter.js` |
| 3 | Region, view, template and the orphaned import removed | `views/UserSettingsProfileView.js`, `views/ReferendumView.js`, `templates/user-settings-profile.html`, `templates/profile-facebook-account.html` (deleted) |
| 4 | Sub-view rebuilt every render; container emptied first | `views/CharacterView.js` |
| 5 | `window.location.replace("#")` instead of assigning to the hash | `routers/mobileRouter.js` |
| 6 | `enforce_admin` forces a recount on the refusal path | `routers/mobileRouter.js` |
| 7 | `.fail(ReportError.on(...))` before `.always(...)` | `routers/mobileRouter.js` |
| 8 | Guarded in the template | `public/index.html`, `views/SimpleTraitSpecializationView.js` |
| 9 | `!creation ||`, **and** `_.compact` on the fetch list | `models/{Vampire,Werewolf,ChangelingBetaSlice}.js` |
| 10 | Email column dropped | `templates/troupe-staff-list.html`, `views/TroupeView.js` |
| 11 | `data-role="listview" data-inset="true"`, label spaced | `public/index.html` |
| 12 | `query.limit(1000)` on the collection's own query | `collections/BNSMETV1_ClanRules.js` |
| 13 | Not fixed, by design. Reason recorded at the call site and pinned by a test | `routers/mobileRouter.js` |
| 14 (mine) | `<%= name %>` instead of `<%= attributes.name %>`. Not in the document — found here; see below | `views/UserSettingsProfileView.js` |
| 14 (theirs), tested as **#15** | Stopped writing `transform_description` onto the router-cached character | `views/CharacterApprovalView.js` |

## Where this departs from the document

**#0's stated trigger is wrong, and the difference matters to anyone hunting
it.** The document says an empty approval timeline is "every character that has
just been created". It is not. `Vampire.create` seeds Humanity, three health
levels and Willpower before it returns, so a freshly created character has
**five** timeline rows, `right` is 4, and its approval page opens normally —
measured, and pinned by a control test. My first attempt to reproduce the crash
used exactly such a character and could not.

What actually has an empty timeline is a character whose `VampireChange` rows
do not exist at all: `char_sampprivate`, which `seed_db.js` writes straight
into Mongo, and in production anything imported or migrated without its
history. Measured against that fixture, before the fix:

```
rowCount 0, rightIndex -1, at(-1) === undefined
reproducing the line   → TypeError: Cannot read properties of undefined (reading 'id')
activePage             → "splashscreen"     (not "character-approval")
htmlHasUiLoading       → true               (a full-page click-swallowing overlay)
console                → info: Error in promise {}
```

Had the document's trigger been right, the E2E suite would have been failing on
every approval test it has.

Three things were changed rather than the one the document prescribes. The
guard, as written there; `$.mobile.loading("hide")` moved out of the `.then()`
and into an `.always()`, which the document suggests; and a
`.fail(ReportError.on("Couldn't open the approval page"))` before it, which it
does not. The third is the same judgement as #7: a route whose only failure
handler is `PromiseFailReport` leaves the user on a dead end being told
nothing, and here it was literally logging `{}`. A third test pins that
failure path on its own, because with the guard in place the first two tests
never reach it.

**The document's #14 is tested here as #15, and there is a numbering clash to
be aware of.** This file's #14 — the profile page's Roles section — was found
while writing these tests and is not in the document. The document later gained
its own #14, the leaked diff markers. Rather than renumber a landed test, the
document's #14 is `#15` in the spec file, and both are called out in the table
above. Anyone reconciling the two lists should read by description, not number.

**The document's #14 is real, but its visible symptom is timing-dependent and I
could not reproduce it as written.** The document reports 3 `fa-minus` and 3
`fa-plus` in `#history-sheet` after approval-then-history. On my fixture the
markers never reached the DOM. What is measurable, and what the test asserts,
is one layer down:

```
after visiting the approval screen:
  router._character.transform_description        7 entries
  history sheet's attributes view, v.model       === router._character
  v.format_attribute_value(<Physical, value 4>)  "<i class='fa fa-minus'></i>2 …
                                                  <i class='fa fa-plus'></i>4"
```

So the leak reaches the renderer and the renderer does produce the markers —
for a trait whose value had simply been raised to 4, on a screen with nothing
to diff. Whether they land in the DOM depends on when that view last rendered,
which is precisely why the document says it "appears only after a particular
navigation, which is why it has survived". Counting `.fa-minus` would be a
flaky test of a real bug, so the test asserts the leak and calls the renderer
directly. It fails against the unfixed source.

**A second copy of both #0 and #14 exists, and is dead.**
`views/CharactersPrintView.js` carries a byte-identical
`update_override_character_and_transform` — the same unguarded
`at(picked.right)` and the same write to `self.model`. It is inside a
`LayoutView` the module never exports: the file ends `//return LayoutView;` and
returns a `CollectionView` built from `CharacterPrintView` instead. Nothing
constructs it. Left untouched rather than "fixed", because editing dead code to
look maintained is how it gets mistaken for the live path — the same trap the
document's own "Not bugs" section records. If it is ever revived, both defects
come back with it.

**#9's prescribed fix is necessary but not sufficient, and the failure it
describes happens earlier than stated.** The document says a character with no
creation record throws a `TypeError` at `creation.addUnique(...)`, three lines
past the `creation &&` guard, and prescribes changing that guard to
`!creation ||`. Measured against the installed parse 8.6.0:

```
Parse.Object.fetchAllIfNeeded([undefined])
  → TypeError: Cannot read properties of undefined (reading 'className')
    at ParseObject.js:1775
```

`fetchAllIfNeeded` reads `.className` off every member of the list it is
handed, so with no creation pointer at all the throw is **synchronous, inside
the fetch, before the guard is reached** — and the prescribed fix alone would
not have prevented it. Both changes are applied: the list is `_.compact`ed so a
missing pointer produces `[]` (which resolves with `[]`), and the guard then
handles `creations[0]` being `undefined`. The E2E test calls the method
directly on a bare model for each of the three venues and asserts it resolves;
it fails against the source with only the documented change applied.

**#2 is resolved by deletion, not by moving the flag.** The document leaves the
choice open. Deleting is what keeps every listing's order unchanged — the flag
was hard-coded to `devuser`, which is the account the whole E2E suite runs as,
so enabling it would have silently reordered the fixtures a dozen specs read.

**#6 is resolved rather than left as an open design question.** The document
treats it as a judgement call because the throttle exists to avoid a query on
every route. The recount now happens only inside `enforce_admin`, and only
after the cached answer has already come back "no" — the path that was about to
refuse anyway. The throttle is untouched for every other navigation. Note this
only tightens the promotion side; a demoted admin still sees the interface
until the cache expires, which is cosmetic, since the server's ACLs are what
actually refuse the writes.

**#4's class observation was wrong, and the test says so.** The document reports
the stale wrapper as `#9cYrGGv2w3.Vampire` "while the content was the werewolf's",
which reads as though the class were stale too. It is not: all three venues
deliberately register the Parse className `Vampire` (they share one table — see
`VenueClass.js` and the note in `models/Vampire.js`), so the wrapper reads
`Vampire` for a werewolf before and after this change. Only the **id** was ever
wrong, and only the id can distinguish the two. Measured both ways.

**#13 is deliberately not fixed**, per the document. The reason is now recorded
at `get_user_characters` beside the query, and a test pins the owner pointer as
unhydrated so the change cannot be made by accident: adding `include("owner")`
makes parse-server delete the pointer for a private owner, and `get_me_acl`
reads a missing owner as "no owner" and grants the **viewer** read and write.

## Still to do, elsewhere

None of this can be done from this branch, which carries no `web/`.

- The React port reproduces most of this behaviour on purpose, and
  `npm run compare:dom` asserts the two front ends render the same DOM. Every
  screen touched here will now diverge — correctly. `#administration` (#11),
  the profile page (#3 and #14), the troupe staff list (#10) and the character
  sheet header (#4) are the visible ones.
- `docs/react-migration/README.md` lists which divergences are currently
  deliberate. Five of them have just gone away: the port's divergence on #0
  (it guards `transformedForRange`, legacy crashed), on #1
  (it renders the troupe shortcuts, legacy did not), on #7 (it reports a troupe
  failure, legacy did not), on #9 (it returns early, legacy crashed) and on the
  document's #14 (React holds no state between screens, so it drew the plain
  sheet). Their
  `@compare-known` markers should be dropped when this lands.

## #14 — the profile page's Roles section, found while writing these tests

Not one of the thirteen. `views/UserSettingsProfileView.js`'s `RoleView`
rendered `_.template("The one: <%= attributes.name %>")`, and Marionette hands
a template `model.toJSON()` (`serializeModel`, `backbone.marionette.js:1708`).
A parse@8 `Parse.Role`'s `toJSON()` is the flat attribute bag —
`{createdAt, updatedAt, name, users, roles, ACL, objectId}` — with no
`attributes` key. The same defect class as #1.

**Measured on the running app as `devuser`, who holds `Administrator`:**

```
#user-roles-available innerHTML  =  "<div></div>"      (the role name absent)
console during the render        =  info: Error in promise {}
current template on a real role  =  THREW: attributes is not defined
`<%= name %>` on the same role   =  "The one: Administrator"
```

Two details the source alone would have got wrong:

- The error is a **ReferenceError**, `attributes is not defined`, not the
  property read one might expect. lodash compiles a template body inside
  `with (obj)`, so a key that is not on the object is a bare undeclared
  identifier.
- It surfaced **nowhere**. The throw happened inside the `q.each` callback in
  `setup`, so the Parse chain caught it and rejected into
  `.fail(PromiseFailReport)` — and a ReferenceError has no enumerable own
  properties, so `JSON.stringify` rendered it as `{}` and even the log line
  said nothing.

A third measurement rules out the obvious alternative explanation: a Marionette
`CollectionView` **does** render a child added after construction, which is how
these roles arrive. With `<%= name %>` the identical late add produced
`<div>The one: Administrator</div>`. So the template was the cause, not the
asynchronous population.

Fixed to read `name`. Covered by two E2E tests — `devuser` sees
`Administrator`, `sampast` sees their `AST_` troupe role and not
`Administrator`, so the section is proved to show the current user's roles
rather than a fixed string. Both fail against the unfixed template.
