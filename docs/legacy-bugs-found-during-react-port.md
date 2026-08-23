# Bugs found in the legacy front end while porting it to React

Everything here is in `public/scripts/` on this branch **today**. None of it is
fixed by the React migration — the porting rule is that a migration which also
changes behaviour cannot be reviewed, because every diff then has two possible
explanations. The two places React deliberately diverges are marked as such.

This document is meant to be handed to a session that will fix them in the
legacy app. Each entry gives the file and line, what actually happens, how it
was confirmed, and what the fix is.

**Every entry below was confirmed against the running app**, not inferred from
reading. Where a claim could only be checked by running it, the measurement is
quoted.

## How each of these was found, and why that matters

This branch already carries the Parse 8 migration, and that work left long
comments behind explaining what it fixed. Those comments are written in the past
tense -- "used to be", "previously" -- and they are a changelog, not a list of
open defects. Reading one as a live bug is an easy mistake and I made it three
times; see "Not bugs" at the end.

So it is worth being explicit about where each entry came from, because a
difference a machine measured is worth more than one a person noticed while
reading:

**Found by the port itself.** `npm run compare:dom` renders a screen in both
front ends and diffs the DOM, or the port could not reproduce a screen without
first working out why the original failed. These five:

  #0 approval page unreachable, #1 troupe shortcuts, #2 sortbycreated,
  #4 memoised sub-view, #13 owner line, #14 leaked diff markers,
  #15 truncated ledger, #16 lost list corners.

#1 is the only one of the thirteen that is a Parse 8 regression -- a thing that
worked before that migration and does not now, which the migration did not
catch.

**Found by reading the legacy source while porting it.** These nine would have
turned up for anyone who read those files as closely, migration or not. The port
is why anyone did:

  #3, #5, #6, #7, #8, #9, #10, #11, #12.

Two of the first group are worth singling out, because a per-screen check would
not have caught either. **#14** appeared only when the comparison walked screens
in sequence within one browser session, the way a person does -- the history
screen matched alone and differed after the approval screen had been open.
**#0** was found because the port could not reproduce a screen that never
renders in the original.

Ordered below by how much a user would notice, not by how they were found.

---

## 0. A new character's approval page cannot be opened at all

**`public/scripts/app/views/CharacterApprovalView.js:317-319`**

```js
var right_id = self.model.recorded_changes.at(self.picked.get("right"));
right_id = right_id.id || right_id.cid || null;
```

`picked.right` is initialised to `recorded_changes.models.length - 1`. For a
character with no non-experience change rows -- which is every character that
has just been created -- that is **-1**, `at(-1)` is `undefined`, and reading
`.id` off it throws.

The route's tail is `.fail(PromiseFailReport)`, which writes a console line and
stops. Its `$.mobile.loading("hide")` sits inside the `.then()` rather than an
`.always()`, so nothing lowers the spinner.

**Confirmed** on the running app with a character holding zero non-XP changes:
opening `#character/ISZilUG8M4/approval` leaves the app on the **splash
screen**, hash changed, `#character-approval` never rendered, and the loading
overlay spinning permanently. Reproducing the line directly gives
`TypeError: Cannot read properties of undefined (reading 'id')` with
`rightIndex: -1, rowCount: 0`.

**Fix:** guard the empty timeline.

```js
var picked_change = self.model.recorded_changes.at(self.picked.get("right"));
var right_id = picked_change ? (picked_change.id || picked_change.cid || null) : null;
```

With a null id nothing matches, the whole (empty) timeline is undone, and the
sheet shows the character as at creation -- which is correct.

Worth fixing the spinner at the same time: move `$.mobile.loading("hide")` into
an `.always()`, or the next failure on this route strands the user again.

**Impact:** the highest here. A player or storyteller who opens Show Approval on
a new character is left staring at the splash screen with a spinner and has to
reload. React guards it; see the note on `transformedForRange` in
`web/src/parse/character/approvals.ts`.

---

## 1. The start page's troupe shortcuts have been empty since the Parse 8 upgrade

**`public/scripts/app/views/PlayerOptionsView.js:71`**

```js
var id = role.attributes.attributes.name;
```

The "Troupe View All Characters" section on the start page renders its heading
above an empty list, for every user, including storytellers who staff a troupe.

`role.attributes` is the plain attribute bag, so `.attributes` on it is
`undefined` and reading `.name` off that yields `undefined`. The id extraction
below it (`id.split('_')[1]`) then produces nothing, no troupe is ever matched,
and `self.troupes.reset([])` empties the list. Under Parse 1.5 the doubled path
resolved; under parse@8 it does not.

**Confirmed** against the running app with `devuser`, who holds
`LST_qvtD2RxzGG`. Both the role and the troupe were present in their caches and
`TroupeHelper.channel.reqres.request('get', 'qvtD2RxzGG')` returned the troupe —
so the data was all there. Replaying the view's own derivation showed
`role.get("name")` returning `"LST_qvtD2RxzGG"` and
`role.attributes.attributes.name` returning `undefined`. Re-firing the
collection event with both caches full still rendered zero rows.

**Fix:**

```js
var id = role.get("name");
```

**Impact:** highest of anything here. A whole feature is silently absent for
every storyteller and admin.

**React diverges here deliberately.** Reproducing it would mean writing code
whose only purpose is to render nothing. See `web/src/screens/PlayerOptions.tsx`.

---

## 2. `sortbycreated` has never worked

**`public/scripts/app/routers/mobileRouter.js:1250, 1273, 1312, 1368, 1412`**
and the comparators in **`collections/Vampires.js:16`**,
**`collections/Patronages.js:23`**, **`collections/Users.js:20`**

```js
var c = [];
if (Parse.User.current().get("username") == "devuser") { c.sortbycreated = true; }
// ...
self.characters.collection.reset(c);
```

```js
comparator: function (left, right) {
    if (_.has(self, "sortbycreated")) { /* by createdAt, descending */ }
    else                              { /* by name */ }
}
```

The flag is set on `c`, a plain array. The comparator reads it off `self`, the
collection. `reset(c)` copies the array's *elements*, not its properties, so the
flag never arrives and the creation-ordered branch is dead. Every listing has
always sorted by name.

**Confirmed:** logged in as `devuser` — the one account the flag is supposed to
apply to — the character list came back alphabetical (Aldous, Brenna, Corwin)
rather than newest-first.

**Fix:** decide whether the feature is wanted at all. It is a developer
convenience hard-coded to one username. Either delete the dead branch and the
five assignments, or set the flag on the collection:

```js
self.characters.collection.sortbycreated = true;
self.characters.collection.reset(c);
```

Note that "fixing" it changes the order of every listing for that account, so it
is a visible change, not a silent one.

**Impact:** none to users. Worth resolving because three copies of a dead branch
invite someone to trust it.

---

## 3. A dead "Link Account to Facebook" button still paints on the profile page

**`public/scripts/app/views/UserSettingsProfileView.js:85-120`**,
**`public/scripts/app/templates/profile-facebook-account.html`**

`FacebookLinkButtonView` renders a button whose click handler calls
`Parse.FacebookUtils.link(...)`. But `app/loadall.js` deliberately no longer
calls `Parse.FacebookUtils.init()` — under parse@8 it throws during bootstrap
("The Facebook JavaScript SDK must be loaded before calling init") and takes the
whole router down with it, so every route 404s.

The button therefore renders and cannot work. The template also calls
`Parse.FacebookUtils.isLinked()` to choose between "Link" and "Unlink".

**Fix:** remove the region and its view, matching the decision already taken for
Facebook login. `greensboro` already hides these buttons.

**Impact:** a visible control that does nothing. React does not port it.

---

## 4. The character sheet's identity block can show the wrong character's id

**`public/scripts/app/views/CharacterView.js:37`**

```js
this.subview = this.subview || new CharacterListItem(this.model);
```

The sub-view is created once per page load and memoised. Its element carries the
id and class of whichever character was opened **first**; later visits replace
the contents but not the wrapper. Open character A, then character B, and B's
details sit inside `<div id="<A's objectId>" class="Vampire">`.

**Confirmed:** opening a werewolf immediately after a vampire left the wrapper
reading `#9cYrGGv2w3.Vampire` — the vampire's id — while the content was the
werewolf's. Everything else on the sheet was correct.

Two separate things are going on. The memoisation is the bug. The presence of an
id and class at all is an accident: `new CharacterListItem(this.model)` passes
the *model* where `Backbone.View` expects an options bag, and the View
constructor picks `id` and `className` off whatever it is handed — so a
`Parse.Object` donates its `objectId` and its `className`.

**Fix:**

```js
this.subview = new CharacterListItem(this.model);
```

or keep the memo and update the element:

```js
this.subview.$el.attr("id", this.model.id);
```

**Impact:** low on its own — nothing reads that id today. It becomes a real
problem the moment anything selects a character by it.

---

## 5. Refusing a non-admin from an admin route creates a redirect loop

**`public/scripts/app/routers/mobileRouter.js:1559-1569`**

```js
admin_route_failed: function (context) {
    return function (error) {
        $.mobile.loading("hide");
        if (Parse.User.current()) {
            window.location.hash = "";
        }
        return ReportError(error, context);
    };
},
```

`window.location.hash = ""` is a **push**, not a replace. A non-admin who opens
`#administration` is bounced to the start page with `#administration` still in
history; pressing Back returns them there and bounces them again. They cannot
get back past it.

**Fix:** replace rather than push.

```js
window.history.replaceState(null, "", window.location.pathname + window.location.search);
```

(or `location.replace("#")`, which also avoids the extra entry).

**Impact:** a Back button that does not work, on every admin route, for every
non-admin who stumbles into one.

---

## 6. Admin status is read from a cache refreshed at most every five minutes

**`public/scripts/app/routers/mobileRouter.js:1504-1529`** and **`:1546`**

`enforce_admin` reads `Parse.User.current().get("admininterface")`. That field is
only reconciled against the `Administrator` / `SiteAdministrator` roles inside
`enforce_logged_in`, and only when `lastadminchecktime` is more than 300000ms
old.

So someone just promoted to admin is refused for up to five minutes, and someone
just demoted keeps access for up to five minutes.

**Fix:** this is a design decision rather than an outright defect — the recount
is a query on every route and the throttle exists to avoid it. If it matters,
either shorten the window, or have `enforce_admin` force a recount when the
cached answer is "no" (cheap: it only costs a query on the refusal path).

**Impact:** confusing during role changes; a mild security consideration on the
demotion side, though the server's own ACLs are what actually enforce access.

---

## 7. A troupe that fails to load says nothing

**`public/scripts/app/routers/mobileRouter.js:2182-2203`**

The `troupe` handler's chain is `.then(...).then(...).always(hide_the_loader)`
with **no `.fail`** anywhere. A troupe that cannot be fetched — wrong id,
permission refused, network — drops the spinner and leaves the user on whatever
page they were on, with nothing said and the URL changed.

**Fix:** add the failure tail the other handlers use.

```js
}).fail(ReportError.on("Couldn't open that troupe"))
  .always(function () { $.mobile.loading("hide"); });
```

Note `.fail` must come before `.always`, or the `always` handler's return value
resolves the chain and the failure never reaches the reporter — the same trap
`ReportError.js` documents at its tail.

**Impact:** a dead end with no explanation. React reports it; that is the one
addition made during the port, and it is called out in `Troupe.tsx`.

---

## 8. Specializing a trait in a category with no Description row throws

**`public/scripts/app/views/SimpleTraitSpecializationView.js:110`** and
**`public/index.html:845`**

```js
"description": this.collection.first()
```

```html
<p><%= description.attributes.help_specialization %></p>
```

`first()` on an empty collection is `undefined`, and the template reads
`.attributes` off it. The query behind the collection is
`equalTo("category", category).startsWith("name", trait.get_base_name())`, so any
trait whose base name matches no Description row in its category renders a
broken page rather than an empty help line.

**Fix:** guard in the template.

```html
<p><%= description ? description.attributes.help_specialization : "" %></p>
```

**Impact:** a blank/broken page on an uncommon path. React guards it; a row that
exists renders identically.

---

## 9. `update_creation_rules_for_changed_trait` throws on a null creation record

**`public/scripts/app/models/Vampire.js:76-96`**, and the same shape in
`Werewolf.js` and `ChangelingBetaSlice.js`

```js
var creation = creations[0];
if (creation && creation.get("completed")) {
    return Parse.Promise.as(self);
}
var stepName = ...;
creation.addUnique(listName, modified_trait);   // creation may be null here
```

The guard tests `creation &&` — acknowledging it can be missing — and then uses
it unguarded three lines later. A character with no creation record throws a
`TypeError`.

**Not reachable today**: every caller runs `ensure_creation_rules_exist` first.
It is a trap for the next caller who does not.

**Fix:**

```js
if (!creation || creation.get("completed")) {
    return Parse.Promise.as(self);
}
```

**Impact:** none today. React returns early instead — the one place the port
declines to reproduce legacy behaviour because reproducing it means crashing.

---

## 10. The troupe staff list prints an email column that is always blank

**`public/scripts/app/templates/troupe-staff-list.html:3`**

```html
<li><%= user.get("role") %>: <%= user.get("username") %> <%= user.get("email") %> <%= user.get("realname") %></li>
```

`get_troupe_staff` builds each staffer through `identity_of`, which copies an
allowlist of fields, and `cloud/main.js:1165` sets `IDENTITY_INCLUDES_EMAIL =
false` deliberately. parse-server also withholds another user's address from
every non-master read. So every row renders as `LST: devuser  ` with a double
space where the email would be.

**Fix:** drop `user.get("email")` from the template. Do **not** flip
`IDENTITY_INCLUDES_EMAIL` — that publishes staff email addresses to anyone who
can read the troupe.

**Impact:** cosmetic. Reproduced verbatim in React, double space and all.

---

## 11. The administration menu is a plain bullet list, not a listview

**`public/index.html`**, the `#administration` block

```html
<div role="main" class="ui-content">
    <ul>
        <li><a href="#troupes">Troupes</a></li>
```

No `data-role="listview"`, so jQuery Mobile leaves it alone and the admin front
door renders as bullet-point links — while `#player-options`, one click away, is
a proper inset listview of full-width buttons. Almost certainly unintended.

Two smaller things in the same block: one label is unspaced where every sibling
is spaced (`SummarizeCharacters`), and the first entry, "Troupes", points at
`#troupes` — not an administration route at all, and the same destination as the
footer's Troupes tab.

**Fix:** `<ul data-role="listview" data-inset="true">`, and fix the label.

**Impact:** visual inconsistency on a screen only admins see. Note that changing
it will make `compare:dom` fail for `#administration` until the React screen is
updated to match — which is the system working.

---

## 12. The clan-rule fetch takes the server's default page of 100

**`public/scripts/app/collections/BNSMETV1_ClanRules.js`**, via a plain
`query.find()`

No `limit`, so the query returns at most 100 rows. There are **42** clan rules on
the running server, so nothing is lost today. Above 100, rules would silently
disappear and in-clan disciplines would be priced at the out-of-clan rate —
which shows up as characters being over-charged experience, not as an error.

**Fix:** `q.limit(1000)`, or page with `each()`.

**Impact:** none today; a silent over-charge if the rule set grows. Worth fixing
before it does. The React port has the same cliff, and says so.

---

## 13. A player's own roster never shows the owner line

**`public/scripts/app/routers/mobileRouter.js:1253-1255`**

```js
var q = new Parse.Query(Vampire);
q.equalTo("owner", Parse.User.current());
q.include("portrait");
```

`character-list-item.html` prints the owner when `owner.get("username")` is
truthy, but no `include("owner")` means the pointer stays a stub, so the line is
skipped. The admin and troupe listings do show it, because they hydrate owners
through `UserWreqr`.

**This may well be intentional** — showing a player their own name on every row
of their own roster is noise. Listed because it is a difference between
listings that looks accidental, and because it interacts with the next point.

**Do not "fix" it by adding `include("owner")`.** There is a comment at
`Vampire.js:325` explaining why: including the owner made parse-server *delete*
the pointer when the owner was private, and `get_me_acl` reads a missing owner
as "no owner" and grants the **current** user read and write — so opening
someone else's sheet rewrote its ACL to the viewer. If the line is wanted,
hydrate the owner separately.

**Impact:** none, probably by design. The ACL trap next to it is the important
part.

---

## 14. The approval screen leaves diff markers on every sheet drawn afterwards

**`public/scripts/app/views/CharacterApprovalView.js:336-339`**

```js
self.model.transform_description = td;
if (c) {
    c.transform_description = td;
}
```

`c` is the clone the approval sheet renders. `self.model` is the character
itself -- and the router memoises that object across routes
(`_get_character_from_cache`), so the description outlives the screen that made
it.

`helpers/VampirePrintHelper.js` switches on `this.model.transform_description`
to decide whether to draw a value plainly or as "old struck through in red, new
in green". So the next screen that draws a character sheet inherits the
approval screen's diff and paints markers that mean nothing there.

**Confirmed** by opening `#character/9cYrGGv2w3/approval` and then
`#character/9cYrGGv2w3/history/0` -- Back then History, an ordinary click path.
`router._character.transform_description` holds 4 entries, and `#history-sheet`
renders 3 `fa-minus` and 3 `fa-plus` markers. Opening the history page on its
own renders none.

The history screen actively tries to avoid this: `MainView.update_picked` sets
`c.transform_description = []` on the clone it builds. That clears the clone and
not the cached original, which is the half that matters.

**Fix:** do not write to `self.model`. The line is not load-bearing -- the sheet
renders `c` -- so deleting it is enough:

```js
if (c) {
    c.transform_description = td;
}
```

If something does depend on reading it back off the model, clear it when the
approval screen closes instead.

**Impact:** a character's history reads as though changes were made that were
not. Cosmetic, but on a screen whose entire purpose is showing what changed, and
it appears only after a particular navigation, which is why it has survived.

React holds no state shared between screens, so it draws the plain sheet. This
is recorded as a deliberate divergence in `web/src/screens/CharacterHistory.tsx`.

---

## 15. The experience ledger is fetched 100 rows at a time, and the balances are recomputed against the truncated list

**`public/scripts/app/views/CharacterExperienceView.js:223-230`** and
**`public/scripts/app/models/Character.js:515`**

```js
var q = new Parse.Query(ExperienceNotation);
q.equalTo("owner", self.character).addDescending("entered").addDescending("createdAt");
self.collection.query = q;
return self.collection.fetch({reset: true});
```

`collection.fetch()` is a plain `find()` with no `limit`, so it takes the
server's default page of **100**. The same shape as #12, and worse in its
consequences: this is not a list that is merely displayed short.

`_propagate_experience_notation_change` walks exactly this collection to
recompute every entry's running `earned` / `spent`, and then writes
`experience_earned` and `experience_spent` onto the character from the newest
entry. With more than 100 notations the oldest ones are absent from the walk, so
the totals are rebuilt from a partial ledger and saved.

The view's own comment explains why it cannot simply page the query -- "Skipping
rows in that query would quietly corrupt the ledger, so the page is taken at
render time and the collection stays whole" -- which is right about *display*
paging and does not address the 100-row ceiling underneath it.

Not currently reachable: no character in the dev database is near 100 notations.
A long-running character in production could be.

**Fix:** raise the limit, or page the fetch with `skip` and concatenate.

```js
q.limit(1000);
```

Anything that changes what the walk sees changes the saved totals, so this wants
checking against a real character with a long ledger before it ships.

**Impact:** none today, silent experience corruption if a character ever crosses
100 notations. The React port has the same ceiling and says so in
`web/src/parse/character/experience.ts`.

---

## 16. Character lists lose their rounded ends after the first visit

**`public/scripts/app/views/CharactersListView.js:45-56`**

```js
render: function() {
    this.template = _.template( character_list_item_html )({ ... });
    this.$el.find("ul[data-role='listview']").html(this.template);
    return this;
}
```

No `enhanceWithin()` and no `listview("refresh")`. **41 of the app's view files
call `enhanceWithin()` at the end of render; this one does not.**

It looks fine the first time because jQuery Mobile enhances the whole page on
`pagecreate`, which happens after the rows are already in the `<ul>`. On any
later render the page is already enhanced, jQM does not touch it again, and the
freshly-written `<li>`s never receive `ui-first-child` / `ui-last-child` -- the
classes that round the top and bottom of an inset list.

**Confirmed:** open `#administration/characters/all` and then `#characters?all`
-- both render into `#characters-all` -- and the rows come back as bare
`li.ui-li-has-thumb`, where a first visit gives
`li.ui-first-child.ui-li-has-thumb` and `li.ui-last-child.ui-li-has-thumb`. The
same happens between `#characters?all` and a troupe roster.

**Fix:** re-enhance after writing the rows, as every other view does.

```js
this.$el.find("ul[data-role='listview']").html(this.template).listview("refresh");
```

`listview("refresh")` rather than `enhanceWithin()` is the narrower call and the
one jQM documents for exactly this.

**Impact:** visual, on the screen players use most, and only after they have
moved between two rosters. React always emits the position classes, so this is
recorded as a deliberate divergence in `web/src/screens/CharactersList.tsx`.

---

## 17. The character sheet's scroll-restore has never worked: three routes record the offset on the wrong object

**`public/scripts/app/routers/mobileRouter.js:737, 1779, 1796`**

`CharacterView` and `CharacterCreateViewNew` both carry the same helper:

```js
scroll_back_after_page_change: function() {
    $(document).one("pagechange", function() {
        var top = _.parseInt(self.backToTop);
        $.mobile.silentScroll(top);
    });
}
```

It reads `backToTop` off **the view**, and `show_character_helper` calls it on
`self.characterMainPage` (:858). But the three routes that leave the sheet
record the offset on the character model instead:

```js
self.character.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
```

- `:1779` `simpletextpick`
- `:1796` `simpletextunpick`
- `:737`  `charactercreateunpicksimpletext`

`self.characterMainPage.backToTop` is therefore never assigned,
`_.parseInt(undefined)` is `NaN`, and `silentScroll(NaN)` moves nothing. The
sheet always returns to the top.

The wizard's copy works, because its three routes (`:632`, `:689`, `:705`)
record on `self.characterCreateView` — the object the helper reads. That
asymmetry within four lines of each other is what makes this look like a slip
rather than a decision.

**Fix:** record on the view: `self.characterMainPage.backToTop = ...` at the
three sites above. Note that `:737` belongs to the *wizard*, not the sheet, so
it should be `self.characterCreateView` — it is the odd one out of the four
creation routes.

**In the React port:** the wizard's restore is ported and works
(`web/src/screens/CharacterCreate.tsx`). The sheet's is not, because what it
ports to is a no-op. Fixing the legacy means deciding what the sheet *should*
do, and then the React screen wants the same treatment the wizard got.

---

## Not bugs — checked and cleared

Recorded so nobody spends time on them again.

**`fauxtrait` staleness in `SimpleTraitChangeView` — already fixed.** The
comment at `:39` describes it in the past tense ("used to be rebuilt only
when…"), and line 45 now rebuilds it unconditionally. An earlier draft of my own
commit message described this in the present tense; that was wrong.

**`update_trait`'s fourth argument in `SimpleTraitChangeView` — already fixed.**
Line 158 passes `0` explicitly. The long comment above it explains the bug that
omitting it used to cause (writing to `<category>_undefined_remaining`, a key
nothing reads), not a bug that is still there.

**`VampireCosts.initialize`'s try/catch — not a bug.** It reads as a reference
to an identifier the module never declares, wrapped in a catch that builds a
fallback — so it looks like it must always throw. It does not.
`app/loadall.js` assigns `this.BNSMETV1_ClanRules = new ClanRules` at module
scope, which in that non-strict `require` callback is `window`, making the bare
identifier a global. **Measured on the running app:** the identifier resolves to
an object holding 42 rules, so the `try` branch is what runs and the fallback is
dead code. An agent working on the port reported the opposite, and I repeated it
in a commit message before checking; both were wrong.

The fallback being unreachable is still worth a look — dead code that appears to
be the live path is how the above happened — but it is a tidy-up, not a defect.

---

## Suggested order

1. **#0** — a whole page is unreachable and the app is left stuck.
2. **#1** — a whole feature is missing. One word.
3. **#5** and **#7** — both leave users stuck with no explanation.
4. **#3**, **#8**, **#11** — visible and small.
5. **#14** — one line to delete, on a screen built to show what changed.
6. **#16** — one call to add, on the screen players use most.
7. **#17** — three assignments, on a convenience players notice every time.
8. **#15** and **#12** — before either list grows past 100.
9. **#9**, **#2**, **#10** — tidy-ups with no user-visible effect today.
10. **#6** and **#13** — decide whether they are defects at all before touching
    them.

## Before you change any of these

The React port reproduces most of this behaviour deliberately, and
`npm run compare:dom` asserts that the two front ends render the same DOM. Fixing
a legacy bug will therefore make that comparison fail for the affected screen —
correctly. Update the React screen in the same change, and drop the
`@compare-known` marker if the divergence it records has just gone away.

`docs/react-migration/README.md` lists which divergences are currently
deliberate.
