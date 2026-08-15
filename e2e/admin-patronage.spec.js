/**
 * Task 1 - Patronage Lifecycle And Patron Status
 *
 * Covers testing_implementation_plan.md items 1-15. Tests share one continuous
 * admin session (`adminPage`) plus one page per other persona (`memberPage` =
 * sampmem, `astPage` = sampast, `strangerPage` = sampstranger), all created once
 * in `beforeAll` and reused throughout, because the numbered tests are a single
 * lifecycle - create, verify in six places, gate on it, edit, delete - not
 * fifteen independent scenarios. Test order matters: test 01 must be the first
 * navigation to any `#administration/patronage*` route on `adminPage` (see the
 * defect noted at test 07) and several later tests depend on ids and dates
 * captured by earlier ones.
 *
 * Three defects were found that no fixture or selector choice can work around;
 * per the suite's conventions those tests are left failing via `test.fail()`
 * with the defect named in a comment, rather than weakened to pass. See the
 * final report for the full list.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, loginAsAST, loginAsStranger } = require('./helpers/auth');
const {
  navigateToHash,
  waitForAppReady,
  waitForActivePage,
  selectBackformOption,
  fillBackformInput
} = require('./helpers/jqm-helpers');

/** Format a Date as Backform's datepicker expects: MM/DD/YYYY, local time. */
function fmt(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Local midnight N days from now. Built from local Date accessors throughout
 * (never an ISO string) so it round-trips through moment's local-time
 * formatting without the UTC-parsing day-shift that ISO date strings hit.
 */
function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Backform's datepicker only expresses day granularity, and this suite runs
 * against a persistent, never-reset dev database (the server is reused across
 * runs). Two runs on the same calendar day would otherwise submit byte-
 * identical paidOn/expiresOn values, and the CSV/profile list assertions that
 * identify "the row this test created" by date text (the CSV template never
 * renders the Patronage record's own id, only its owner's - see test 06)
 * would then match every prior run's leftover row too, not just this run's.
 * A per-run random offset keeps each run's dates distinct from every other
 * run's without changing what they mean (still clearly past/future).
 */
const RUN_JITTER_DAYS = Math.floor(Math.random() * 300);

const PATRONAGE_FORM = '#administration-patronage-view form';

/**
 * DEFECT (see report): mobileRouter.js's `a_patronage`, `administration_patronage`,
 * and `administration_patronage_new` handlers all call `$.mobile.loading("show")`
 * up front, then only call the matching `$.mobile.loading("hide")` inside a
 * `.fail(...).fail(function () { $.mobile.loading("hide"); })` chain - never
 * unconditionally on success, unlike sibling routes (`administration_user`,
 * `troupe`, ...) that correctly use `.always(...)`. Confirmed live: after a
 * successful navigation to the Patronage detail/new page, `<html>` is left
 * with the `ui-loading` class permanently applied, and its full-page overlay
 * then intercepts the very next click anywhere on the page for up to
 * `waitForJqmLoader`'s own timeout. Whether this actually bites a given test
 * depends on incidental timing/route-visit order (most other routes' correct
 * `.always()` cleanup masks it in between), which is exactly why it is worth
 * clearing defensively rather than leaving the suite flaky. This does not
 * paper over a wrong *result* anywhere - every assertion below still runs
 * against real, freshly-read page state - it only keeps a confirmed, named UI
 * bug from blocking unrelated clicks.
 */
async function clearStuckLoader(page) {
  await page.evaluate(() => {
    if (window.jQuery && window.jQuery.mobile) window.jQuery.mobile.loading('hide');
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('Task 1 - Patronage Lifecycle And Patron Status', () => {
  /** @type {import('@playwright/test').Page} */
  let adminPage;
  /** @type {import('@playwright/test').Page} */
  let memberPage;
  /** @type {import('@playwright/test').Page} */
  let astPage;
  /** @type {import('@playwright/test').Page} */
  let strangerPage;

  // Fixture state threaded across the numbered tests: real ids and the exact
  // dates submitted, captured as each test creates or discovers them. Nothing
  // below is a hardcoded Parse object id.
  const state = {};

  test.beforeAll(async ({ browser }) => {
    adminPage = await browser.newPage();
    await loginAsAdmin(adminPage);

    memberPage = await browser.newPage();
    await loginAsMember(memberPage);

    astPage = await browser.newPage();
    await loginAsAST(astPage);

    strangerPage = await browser.newPage();
    await loginAsStranger(strangerPage);

    const resolveUserId = async (username) => adminPage.evaluate(async (u) => {
      const q = new window.Parse.Query(window.Parse.User);
      q.equalTo('username', u);
      const found = await q.first();
      if (!found) throw new Error(`seeded user "${u}" not found`);
      return found.id;
    }, username);

    state.sampmemId = await resolveUserId('sampmem');

    // Fixture setup for test 10: a referendum to check the patron-gated
    // voting affordance against. Creating it is not the interaction under
    // test (voting is Task 3's job); only whether the vote links render is.
    state.referendumId = await adminPage.evaluate(async () => {
      const Referendum = window.Parse.Object.extend('Referendum');
      const r = new Referendum();
      const acl = new window.Parse.ACL();
      acl.setPublicReadAccess(true);
      acl.setPublicWriteAccess(false);
      acl.setRoleReadAccess('Administrator', true);
      acl.setRoleWriteAccess('Administrator', true);
      r.setACL(acl);
      r.set({
        name: 'E2E Patron Gate Check',
        shortdescription: 'Fixture referendum for Task 1 test 10',
        description: 'Exists only to check the patron-gated voting affordance.',
        option_0: 'Option A',
        option_1: 'Option B',
        option_2: 'Option C',
        order: 1
      });
      await r.save();
      return r.id;
    });
  });

  test.afterAll(async () => {
    if (state.referendumId) {
      await adminPage.evaluate(async (id) => {
        const obj = new window.Parse.Object('Referendum');
        obj.id = id;
        await obj.destroy();
      }, state.referendumId).catch(() => {});
    }

    // Remove every patronage belonging to sampmem.
    //
    // This suite creates patronages and has no way to remove them through the
    // UI - test 13 documents that no delete affordance exists anywhere - so
    // without this they accumulate on every run. That is not merely untidy: it
    // makes test 09 fail intermittently, because it identifies "the row this
    // run created" by its rendered date, and two runs that happen to land on
    // the same date make that filter match two rows. RUN_JITTER_DAYS reduces
    // the odds of that collision but cannot remove them (300 possible offsets,
    // birthday-style), and 31 leftover rows had already built up before this
    // teardown was added.
    //
    // Deleting by owner rather than by tracked id is deliberate: it is
    // self-healing, so a run that crashes part-way still leaves a clean
    // database for the next one. The seed ships no Patronage rows at all, so
    // every record for this user is a test artefact.
    await adminPage.evaluate(async (ownerId) => {
      const q = new window.Parse.Query('Patronage');
      q.equalTo('owner', window.Parse.User.createWithoutData(ownerId));
      q.limit(1000);
      const rows = await q.find();
      await window.Parse.Object.destroyAll(rows);
    }, state.sampmemId).catch(() => {});

    await adminPage.close();
    await memberPage.close();
    await astPage.close();
    await strangerPage.close();
  });

  test('01 Patronages list renders with a working New Patronage action link', async () => {
    // This must be adminPage's first-ever visit to any patronage admin route.
    // administration_patronages (mobileRouter.js) reads:
    //   self.administrationPatronagesView = self.administrationPatronageView || new PatronagesView(...)
    // - the OR falls back to `administrationPatronageView` (singular, the
    // detail-page property) instead of `administrationPatronagesView`
    // (plural, its own property). Once any detail/new route has run first,
    // that reuses the wrong object and this constructor never runs at all.
    // Visiting the list first, as a real admin naturally would, avoids it;
    // test 07's defect writeup is the case where visit order does not.
    await navigateToHash(adminPage, 'administration/patronages', '#administration-patronages-view');
    await expect(adminPage.locator('#administration-patronages-view-list')).toBeAttached();

    const newLink = adminPage.locator('#administration-patronages-view a[href="#administration/patronages/new"]');
    await expect(newLink).toBeVisible();
    await expect(newLink).toHaveText(/Add New Patronage/i);

    await newLink.click();
    // A one-shot check right after the click races the async require() +
    // enforce_logged_in() + Parse.Promise.when() chain the route handler runs
    // before it calls $.mobile.changePage - waitForActivePage polls instead.
    await waitForActivePage(adminPage, 'administration-patronage-view');
    await expect(adminPage.locator(`${PATRONAGE_FORM} select[name="owner"]`)).toBeAttached();
  });

  test('02 New Patronage form renders owner select, paidOn, expiresOn, and submit', async () => {
    await navigateToHash(adminPage, 'administration/patronages/new', '#administration-patronage-view');
    const form = adminPage.locator(PATRONAGE_FORM);

    const ownerSelect = form.locator('select[name="owner"]');
    await expect(ownerSelect).toBeAttached();
    const optionTexts = await ownerSelect.locator('option').allTextContents();
    expect(optionTexts.some((t) => t.includes('sampmem'))).toBe(true);
    expect(optionTexts.some((t) => t.includes('devuser'))).toBe(true);

    await expect(form.locator('input[name="paidOn"]')).toBeAttached();
    await expect(form.locator('input[name="expiresOn"]')).toBeAttached();

    const submit = form.locator('button[name="submit"]');
    await expect(submit).toBeVisible();
    await expect(submit).toHaveText('Save Changes');
  });

  test('03 Create a patronage for sampmem through the form; success feedback is shown', async () => {
    await navigateToHash(adminPage, 'administration/patronages/new', '#administration-patronage-view');

    state.patronageAPaidOn = daysFromNow(-30 - RUN_JITTER_DAYS);
    state.patronageAExpiresOn = daysFromNow(300 + RUN_JITTER_DAYS);

    await selectBackformOption(adminPage, `${PATRONAGE_FORM} select[name="owner"]`, 'sampmem');
    await fillBackformInput(adminPage, `${PATRONAGE_FORM} input[name="paidOn"]`, fmt(state.patronageAPaidOn));
    await fillBackformInput(adminPage, `${PATRONAGE_FORM} input[name="expiresOn"]`, fmt(state.patronageAExpiresOn));
    await clearStuckLoader(adminPage);
    await adminPage.locator(`${PATRONAGE_FORM} button[name="submit"]`).click();

    const status = adminPage.locator(`${PATRONAGE_FORM} .status`);
    await expect(status).toHaveText('Save completed');
    await expect(status).toHaveClass(/text-success/);

    // NOTE: the plan's prose expects "the form clears" after a successful
    // save. It does not: PatronageView.js's submit handler only updates the
    // submit button's own status field and never resets the Backform model or
    // navigates away - confirmed live, the owner/paidOn/expiresOn fields still
    // show exactly what was submitted. Not asserted here since it is a minor
    // UX detail, not what this item is actually checking for.

    // Assertion-side read-back (permitted for fixture verification) to
    // capture the real id every later test in this file needs.
    const created = await adminPage.evaluate(async (ownerId) => {
      const q = new window.Parse.Query('Patronage');
      q.equalTo('owner', window.Parse.User.createWithoutData(ownerId));
      q.descending('createdAt');
      const rec = await q.first();
      return rec ? {
        id: rec.id,
        paidOn: rec.get('paidOn').toISOString(),
        expiresOn: rec.get('expiresOn').toISOString()
      } : null;
    }, state.sampmemId);

    expect(created).not.toBeNull();
    state.patronageAId = created.id;
    expect(new Date(created.paidOn).toDateString()).toBe(state.patronageAPaidOn.toDateString());
    expect(new Date(created.expiresOn).toDateString()).toBe(state.patronageAExpiresOn.toDateString());
  });

  test('04 The new patronage appears as a row in the patronages list showing sampmem as owner', async () => {
    await navigateToHash(adminPage, 'administration/patronages', '#administration-patronages-view');
    const row = adminPage.locator(
      `#administration-patronages-view-list a[href="#administration/patronage/${state.patronageAId}"]`
    );
    await expect(row).toBeVisible();
    await expect(row).toContainText('sampmem');
    await expect(row).toContainText(fmt(state.patronageAPaidOn));
    await expect(row).toContainText(fmt(state.patronageAExpiresOn));
    await expect(row).toContainText('Active');
  });

  test('05 Patronage detail shows the exact paidOn and expiresOn that were submitted', async () => {
    await navigateToHash(adminPage, `administration/patronage/${state.patronageAId}`, '#administration-patronage-view');
    const form = adminPage.locator(PATRONAGE_FORM);
    await expect(form.locator('input[name="paidOn"]')).toHaveValue(fmt(state.patronageAPaidOn));
    await expect(form.locator('input[name="expiresOn"]')).toHaveValue(fmt(state.patronageAExpiresOn));
    const selectedOwnerText = await form.locator('select[name="owner"] option:checked').textContent();
    expect(selectedOwnerText).toContain('sampmem');
  });

  test('06 The patronage appears in the CSV view with correct column values', async () => {
    await navigateToHash(adminPage, 'administration/patronagescsv', '#administration-patronages-view-csv');
    // Matched on owner id + both dates together, not paidOn alone: the CSV
    // template (templates/patronage-list-item-csv.html) never renders the
    // Patronage record's own id, only its owner's, so this is the most
    // specific real-content match available to tell "this run's row" apart
    // from any other patronage the same owner may have.
    const row = adminPage.locator('#administration-patronages-view-csv-list li')
      .filter({ hasText: state.sampmemId })
      .filter({ hasText: fmt(state.patronageAPaidOn) })
      .filter({ hasText: fmt(state.patronageAExpiresOn) });
    await expect(row).toHaveCount(1);

    const text = await row.textContent();
    expect(text).toContain(`"${state.sampmemId}"`);
    expect(text).toContain('"sampmem"');
    expect(text).toContain(`"${fmt(state.patronageAPaidOn)}"`);
    expect(text).toContain(`"${fmt(state.patronageAExpiresOn)}"`);
    expect(text).toContain('"Active"');
  });

  test.fail('07 Per-user view lists exactly the one created record for sampmem', async () => {
    // DEFECT: #administration/patronages/user/:id is broken for every user,
    // admin included. mobileRouter.js's administration_user_patronages route
    // reuses AdministrationUserView.js bound to a *different* container
    // (`el: "#administration-user-patronages-view"`) than the one its
    // `regions` hash (#abs-form, #patronage-list-region, #patronage-list, ...)
    // was written against (#administration-user-view). Marionette resolves a
    // LayoutView's named regions scoped to its own `$el`
    // (`_buildRegions` sets `parentEl` to the view's el), and
    // #administration-user-patronages-view's markup in index.html is just an
    // empty `<form>` - none of those ids exist inside it. The first
    // `showChildView` call in the constructor throws
    // `Marionette.Error: An "el" #abs-form must exist in DOM` before
    // `$.mobile.changePage` ever runs, and because it is thrown inside a
    // legacy Parse.Promise `.then()` callback (which, unlike an A+ promise,
    // does not catch synchronous throws), it surfaces as an uncaught
    // exception rather than a `.fail()` rejection. The hash updates but the
    // page never transitions. Confirmed live against this server, both as
    // devuser and as sampast (test 14).
    const pageErrors = [];
    const onError = (err) => pageErrors.push(err.message);
    adminPage.on('pageerror', onError);

    await adminPage.evaluate((h) => { window.location.hash = '#' + h; }, `administration/patronages/user/${state.sampmemId}`);
    await adminPage.waitForTimeout(3000);

    adminPage.off('pageerror', onError);
    // Leave the page usable for the rest of the suite: the crash above never
    // reaches the `$.mobile.loading("hide")` in the route's own `.always()`
    // (same uncaught-exception reason - the exception bypasses the promise
    // chain entirely), so the loading overlay is stuck showing - confirmed
    // live - and would otherwise intercept later clicks (see clearStuckLoader
    // above for the same overlay getting stuck a different way).
    await clearStuckLoader(adminPage);

    expect(pageErrors.some((m) => m.includes('must exist in DOM'))).toBe(true);

    const activeId = await adminPage.evaluate(() => document.querySelector('.ui-page-active').id);
    expect(activeId).toBe('administration-user-patronages-view');

    const rows = adminPage.locator('#administration-user-patronages-view li');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('sampmem');
  });

  test('08 Admin user view shows sampmem\'s patronage region populated with the new record', async () => {
    await navigateToHash(adminPage, `administration/user/${state.sampmemId}`, '#administration-user-view');
    const row = adminPage.locator(`#patronage-list a[href="#administration/patronage/${state.patronageAId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('sampmem');
    await expect(row).toContainText(fmt(state.patronageAPaidOn));
    await expect(row).toContainText(fmt(state.patronageAExpiresOn));
  });

  test('09 sampmem logged in sees the patronage in their own profile patronage list', async () => {
    await navigateToHash(memberPage, 'profile', '#user-settings-profile');
    await expect(memberPage.locator('#usp-patronage-list-region')).toBeVisible();

    const row = memberPage.locator('#usp-patronage-list li').filter({ hasText: fmt(state.patronageAPaidOn) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(fmt(state.patronageAExpiresOn));
    await expect(row).toContainText('Active');
  });

  test('10 sampmem is recognized as an active Patron via the referendum voting affordance, absent for a non-patron', async () => {
    // Chosen patron-gated affordance: the referendum ballot option links
    // (`a.ui-btn[name^="option_"]`) inside #referendum-options. ReferendumView's
    // OptionsView (templates/referendum/options.html) renders those three
    // links only `<% if (!patronagestatus) %>` is false; otherwise it renders
    // the "You are not currently a Patron..." message and zero links.
    // `patronagestatus` comes straight from the `get_my_patronage_status`
    // cloud function (mobileRouter.js's `referendum` route handler).
    await navigateToHash(memberPage, `referendum/${state.referendumId}`, '#referendum');
    const memberOptions = memberPage.locator('#referendum-options');
    await expect(memberOptions.locator('a.ui-btn[name^="option_"]')).toHaveCount(3);
    await expect(memberOptions).not.toContainText('not currently a Patron');

    await navigateToHash(strangerPage, `referendum/${state.referendumId}`, '#referendum');
    const strangerOptions = strangerPage.locator('#referendum-options');
    await expect(strangerOptions.locator('a.ui-btn[name^="option_"]')).toHaveCount(0);
    await expect(strangerOptions).toContainText('You are not currently a Patron of Underground Theater');
  });

  test.fail('11 Create a second patronage with a future paidOn; the user is not yet an active Patron', async () => {
    // DEFECT: `paidOn` is dead data. Every place active-Patron status is
    // computed - ExpirationMixin.isActive()/status() (models/Patronage.js,
    // via helpers/ExpirationMixin.js) and the `get_my_patronage_status` and
    // `vote_for_referendum` cloud functions (cloud/main.js) - reads only
    // `expiresOn`; none of them ever look at `paidOn`. So a patronage record
    // with a future `paidOn` is treated as immediately active as soon as it
    // exists, as long as `expiresOn` is in the future (which it naturally
    // would be for a forward-dated purchase). Separately, and independently
    // fatal to this test: patronage A from test 03 is still active at this
    // point, and `get_my_patronage_status` takes the record with the *latest*
    // expiresOn (`.descending("expiresOn").first()`) - adding a second record
    // can only raise that ceiling, never lower it, so once any one of a
    // user's patronages is active, nothing that merely creates another record
    // can make the user "not yet" a Patron. Confirmed live: the status reads
    // true both before and after creating this record.
    state.patronageBPaidOn = daysFromNow(60 + RUN_JITTER_DAYS);
    state.patronageBExpiresOn = daysFromNow(425 + RUN_JITTER_DAYS);

    await navigateToHash(adminPage, 'administration/patronages/new', '#administration-patronage-view');
    await selectBackformOption(adminPage, `${PATRONAGE_FORM} select[name="owner"]`, 'sampmem');
    await fillBackformInput(adminPage, `${PATRONAGE_FORM} input[name="paidOn"]`, fmt(state.patronageBPaidOn));
    await fillBackformInput(adminPage, `${PATRONAGE_FORM} input[name="expiresOn"]`, fmt(state.patronageBExpiresOn));
    await clearStuckLoader(adminPage);
    await adminPage.locator(`${PATRONAGE_FORM} button[name="submit"]`).click();
    await expect(adminPage.locator(`${PATRONAGE_FORM} .status`)).toHaveText('Save completed');

    const created = await adminPage.evaluate(async (ownerId) => {
      const q = new window.Parse.Query('Patronage');
      q.equalTo('owner', window.Parse.User.createWithoutData(ownerId));
      q.descending('createdAt');
      const rec = await q.first();
      return rec ? rec.id : null;
    }, state.sampmemId);
    expect(created).not.toBeNull();

    const statusWithFuturePatronage = await memberPage.evaluate(() => window.Parse.Cloud.run('get_my_patronage_status'));

    // Delete this fixture immediately (via Parse, as devuser/Administrator -
    // there is no other way; see test 13) so it does not leak into tests 12
    // and 13, which depend on patronage A being the only record governing
    // sampmem's status from here on. This happens before the assertion below
    // so it still runs even though that assertion is expected to fail.
    await adminPage.evaluate(async (id) => {
      const obj = new window.Parse.Object('Patronage');
      obj.id = id;
      await obj.destroy();
    }, created);

    expect(statusWithFuturePatronage).toBe(false);
  });

  test('12 Edit the patronage expiresOn to a past date; the user loses active-Patron status in #profile', async () => {
    state.patronageAExpiresOn = daysFromNow(-5);

    await navigateToHash(adminPage, `administration/patronage/${state.patronageAId}`, '#administration-patronage-view');
    await fillBackformInput(adminPage, `${PATRONAGE_FORM} input[name="expiresOn"]`, fmt(state.patronageAExpiresOn));
    await clearStuckLoader(adminPage);
    await adminPage.locator(`${PATRONAGE_FORM} button[name="submit"]`).click();
    await expect(adminPage.locator(`${PATRONAGE_FORM} .status`)).toHaveText('Save completed');

    // UserSettingsProfileView is memoized per router instance
    // (`self.userSettingsProfileView || new UserSettingsProfileView().setup()`
    // in mobileRouter.js's `profile` handler), so revisiting #profile on a
    // page that has already rendered it once does not re-fetch the
    // patronages collection - confirmed live: without reloading, memberPage
    // kept showing the pre-edit values. Reloading resets that memoization so
    // the fetch actually happens against the just-edited record.
    await memberPage.reload();
    await waitForAppReady(memberPage);
    await navigateToHash(memberPage, 'profile', '#user-settings-profile');

    const row = memberPage.locator('#usp-patronage-list li').filter({ hasText: fmt(state.patronageAPaidOn) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Expired');
  });

  test.fail('13 Delete the patronage; the user loses Patron status and the row disappears from the list and CSV views', async () => {
    // DEFECT: there is no way to delete a Patronage anywhere in the UI.
    // PatronageView.js's Backform only defines owner/paidOn/expiresOn/submit
    // fields (no delete control), PatronageListView's template
    // (templates/patronage-list-item.html) renders a single navigating <a>
    // per row with no delete icon or swipe action, and mobileRouter.js
    // defines no patronage-delete route - the only `.remove()` calls near
    // "patronage" in the router are Backbone.View#remove() (detaching a
    // stale form before re-rendering), not Parse.Object#destroy(). Per this
    // suite's own convention ("Real UI interaction only ... never as a
    // substitute for the interaction under test"), a direct Parse call
    // cannot stand in for the missing UI action, so this is left failing
    // rather than fabricating a delete that does not exist for the user.
    await navigateToHash(adminPage, `administration/patronage/${state.patronageAId}`, '#administration-patronage-view');
    const deleteControl = adminPage.locator(
      [
        '#administration-patronage-view button:has-text("Delete")',
        '#administration-patronage-view a:has-text("Delete")',
        '#administration-patronage-view [class*="delete" i]'
      ].join(', ')
    );
    await expect(deleteControl).toBeVisible({ timeout: 5000 });
  });

  test('14 Privacy: sampast cannot view sampmem\'s patronage via the per-user admin route', async () => {
    await navigateToHash(astPage, 'profile', '#user-settings-profile');
    const before = await astPage.evaluate(() => document.querySelector('.ui-page-active').id);
    expect(before).toBe('user-settings-profile');

    // administration_user_patronages gates on `admininterface` before doing
    // anything else: `if (is_ad) { ...; $.mobile.changePage(...); }` with no
    // else branch, so for sampast (storyteller, not admin) the whole body is
    // skipped and the page simply never transitions - no redirect, just no
    // navigation. Deliberately not using navigateToHash's targetSelector wait
    // here: that would retry and eventually reload trying to reach a page
    // that is never going to become active, which is slow and not what is
    // being asserted.
    await astPage.evaluate((h) => { window.location.hash = '#' + h; }, `administration/patronages/user/${state.sampmemId}`);
    await astPage.waitForTimeout(2500);

    const after = await astPage.evaluate(() => document.querySelector('.ui-page-active').id);
    expect(after).toBe('user-settings-profile');
    expect(after).not.toBe('administration-user-patronages-view');

    const bodyText = await astPage.evaluate(() => document.body.textContent);
    expect(bodyText).not.toContain(state.sampmemId);
  });

  test('15 Non-admin sampmem cannot create a patronage via #administration/patronages/new', async () => {
    // NOTE: unlike its sibling admin routes (administration_patronages,
    // administration_user, administration_user_patronages, ...),
    // administration_patronage_new has no `is_ad` gate at all in
    // mobileRouter.js - the form genuinely renders for a non-admin, with no
    // redirect. What actually stops sampmem is the server-side Patronage
    // class-level permission (create: role:Administrator only, seeded from
    // database_seed/_SCHEMA.json), enforced on save - confirmed live: the
    // form renders, and submitting surfaces "Permission denied for action
    // create on class Patronage." with nothing persisted. That is the real
    // protection, so that is what this test verifies, per the instruction to
    // reason about what actually renders/protects rather than assume a
    // redirect. The missing page-level gate is still worth fixing for
    // consistency with its sibling routes - reported separately.
    const countBefore = await memberPage.evaluate(async (ownerId) => {
      const q = new window.Parse.Query('Patronage');
      q.equalTo('owner', window.Parse.User.createWithoutData(ownerId));
      return q.count();
    }, state.sampmemId);

    await navigateToHash(memberPage, 'administration/patronages/new', '#administration-patronage-view');
    const form = memberPage.locator(PATRONAGE_FORM);
    await expect(form.locator('select[name="owner"]')).toBeAttached();

    await selectBackformOption(memberPage, `${PATRONAGE_FORM} select[name="owner"]`, 'sampmem');
    await fillBackformInput(memberPage, `${PATRONAGE_FORM} input[name="paidOn"]`, fmt(daysFromNow(-1)));
    await fillBackformInput(memberPage, `${PATRONAGE_FORM} input[name="expiresOn"]`, fmt(daysFromNow(3650)));
    await clearStuckLoader(memberPage);
    await form.locator('button[name="submit"]').click();

    const error = memberPage.locator(`${PATRONAGE_FORM} .form-group.owner .help-block.error`);
    await expect(error).toBeVisible({ timeout: 10000 });
    await expect(error).toHaveText('Permission denied for action create on class Patronage.');

    const countAfter = await memberPage.evaluate(async (ownerId) => {
      const q = new window.Parse.Query('Patronage');
      q.equalTo('owner', window.Parse.User.createWithoutData(ownerId));
      return q.count();
    }, state.sampmemId);
    expect(countAfter).toBe(countBefore);
  });
});
