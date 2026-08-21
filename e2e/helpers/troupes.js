/**
 * Troupe helpers.
 *
 * Troupe list items render as `a.troupe-listing[name][backendid]`, which is how
 * a troupe's real object id is recovered without hardcoding one. The previous
 * suite pinned one fixed troupe id into every troupe test; fixtures here
 * create their own troupes so specs can run in any order against any database.
 */

const { navigateToHash, waitForJqmLoader, waitForActivePage, normalize, selectBackformOption } = require('./jqm-helpers');

let troupeCounter = 0;
function uniqueTroupeName(prefix = 'E2E Troupe') {
  troupeCounter++;
  return `${prefix} ${Date.now().toString(36)}${troupeCounter}`;
}

/** Create a troupe through the real form and return its id and name. */
async function createTroupe(page, name, extra = {}) {
  const finalName = name || uniqueTroupeName();

  await navigateToHash(page, 'troupe/new', '#troupe-new');
  await page.fill('#troupe-new-form input[name="name"]', finalName);

  if (extra.shortname !== undefined) {
    await page.fill('#troupe-new-form input[name="shortname"]', extra.shortname);
  }
  if (extra.shortdescription !== undefined) {
    await page.fill('#troupe-new-form input[name="shortdescription"]', extra.shortdescription);
  }

  await page.locator('#troupe-new-form button[type="submit"], #troupe-new-form button').first().click();
  await waitForJqmLoader(page);

  const id = await findTroupeIdByName(page, finalName);
  if (!id) {
    throw new Error(`troupe "${finalName}" was not found in the directory after creation`);
  }
  return { id, name: finalName };
}

/** Resolve a troupe's object id from the directory listing. */
async function findTroupeIdByName(page, name) {
  await navigateToHash(page, 'troupes', '#troupes-list');
  return page.evaluate((wanted) => {
    const link = Array.from(document.querySelectorAll('#troupes-list a.troupe-listing'))
      .find((a) => (a.getAttribute('name') || '').trim() === wanted);
    return link ? link.getAttribute('backendid') : null;
  }, name);
}

/** Every troupe in the directory, as `{ id, name }`. */
async function listTroupes(page) {
  await navigateToHash(page, 'troupes', '#troupes-list');
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('#troupes-list a.troupe-listing')).map((a) => ({
      id: a.getAttribute('backendid'),
      name: (a.getAttribute('name') || '').trim()
    }));
  });
}

/**
 * Troupe staff role codes to the exact visible label
 * `TroupeEditStaffView`'s Backform `<select name="role">` renders them with —
 * see `views/TroupeEditStaffView.js`. The underlying DOM `value` for each
 * `<option>` is JSON-quoted by `Backform.JSONFormatter` (literally `"AST"`,
 * quote characters included — the same landmine `selectBackformOption`'s own
 * doc comment in jqm-helpers.js describes for other Backform selects), which
 * is exactly why role selection below goes through that helper rather than
 * `selectOption` on the raw value.
 */
const STAFF_ROLE_LABELS = {
  LST: 'Lead Storyteller',
  AST: 'Assistant Storyteller',
  Narrator: 'Narrator',
  None: 'Not on Staff'
};

/**
 * Open the staff-edit form for a user, driving the real first step of the
 * flow: `#troupe/:id/staff/add` (UsersView) lists every user; clicking one
 * navigates to `#troupe/:id/staff/edit/:uid` (TroupeEditStaffView.register()),
 * which asynchronously queries `troupe.get_roles()` and throws if any of the
 * three per-troupe roles (`LST_<id>`/`AST_<id>`/`Narrator_<id>`) is not yet
 * visible to that query — which can happen for a troupe created moments ago,
 * since `TroupeNewView`'s submit handler saves those three Role objects itself
 * right after saving the Troupe, and the jQuery Mobile loader alone is not a
 * reliable signal that write has landed (see waitForJqmLoader's known
 * limitation in jqm-helpers.js). Retrying the whole navigation — not just
 * waiting longer on one attempt — is what recovers from that race: it re-runs
 * `register()` from scratch against whatever the server holds by then.
 *
 * Returns the target user's id, read back from the hash the click landed on
 * rather than tracked separately by the caller.
 */
async function openStaffEditForUser(page, troupeId, username, { timeout = 20000 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    await navigateToHash(page, `troupe/${troupeId}/staff/add`, '#troupe-add-staff');

    const entry = page.locator('#troupe-add-staff ul li a').filter({ hasText: new RegExp(`\\b${username}\\b`) }).first();
    if (await entry.count() === 0) {
      const available = await page.locator('#troupe-add-staff ul li a')
        .evaluateAll((els) => els.slice(0, 12).map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      lastError = new Error(`user "${username}" not offered in the staff picker. Available: ${available.join(' | ')}`);
      await page.waitForTimeout(300);
      continue;
    }

    await entry.click();
    await waitForJqmLoader(page);

    try {
      await waitForActivePage(page, 'troupe-edit-staff', 8000);
      await page.locator('#troupe-edit-staff-form select[name="role"]').waitFor({ state: 'attached', timeout: 8000 });

      const hash = await page.evaluate(() => window.location.hash);
      const m = hash.match(/staff\/edit\/([^/]+)$/);
      if (!m) throw new Error(`picking "${username}" landed on an unexpected hash: ${hash}`);
      return m[1];
    } catch (e) {
      lastError = e;
      await page.waitForTimeout(500);
    }
  }

  throw new Error(
    `could not open the staff-edit form for "${username}" on troupe ${troupeId} within ${timeout}ms` +
    (lastError ? `; last error: ${lastError.message}` : '')
  );
}

/**
 * Add a user to a troupe's staff with a given role, or change an existing
 * staff member's role — the same UI action either way.
 *
 * COMPLETES the previously-unfinished second half of this flow (see the
 * Task 0 report and the comment above `openStaffEditForUser`): picking a user
 * from `#troupe/:id/staff/add` only lands on `#troupe/:id/staff/edit/:uid`;
 * a role still has to be chosen from that page's Backform `<select
 * name="role">` and the form saved, which calls
 * `Parse.Cloud.run("change_troupe_staff", ...)`.
 *
 * There is no separate "edit" entry point anywhere in the UI —
 * `#troupe-staff`'s rows are plain `<li>` text, not links (see
 * troupe-staff-list.html) — so re-adding an *existing* staff member through
 * this same `#troupe/:id/staff/add` picker, with a different role selected on
 * the form that opens, is genuinely how a real user would change someone's
 * role: `TroupeEditStaffView.register()` pre-selects whichever role (if any)
 * the picked user currently holds. That is why this one function serves both
 * "add" and "edit".
 *
 * `submit` moves the hash to `#troupe/:id` from inside a `.always()` — win or
 * lose (see TroupeEditStaffView.js) — so the redirect alone proves nothing.
 * This polls the troupe's own `#troupe-staff` region (via `readStaff`, a real
 * re-render off `troupe.get_staff()`) until the expected row actually appears,
 * the same "verify the real effect, not the navigation" discipline
 * `waitForMembership` below already uses for troupe join/leave.
 */
async function addStaff(page, troupeId, username, role = 'AST', { timeout = 30000 } = {}) {
  const label = STAFF_ROLE_LABELS[role];
  if (!label) {
    throw new Error(`unknown troupe staff role "${role}"; expected one of ${Object.keys(STAFF_ROLE_LABELS).join(', ')}`);
  }

  const uid = await openStaffEditForUser(page, troupeId, username, { timeout });

  await selectBackformOption(page, '#troupe-edit-staff-form select[name="role"]', label);
  await page.locator('#troupe-edit-staff-form button[type="submit"], #troupe-edit-staff-form button').first().click();

  await page.waitForFunction((h) => window.location.hash === h, `#troupe/${troupeId}`, { timeout }).catch(() => { /* see doc comment: the redirect fires even on failure */ });
  await waitForJqmLoader(page);

  const deadline = Date.now() + timeout;
  let staff = [];
  while (Date.now() < deadline) {
    staff = await readStaff(page, troupeId);
    const row = staff.find((r) => r.indexOf(username) !== -1);
    if (row && row.indexOf(role + ':') === 0) {
      return { uid, role, row };
    }
    await page.waitForTimeout(500);
  }

  throw new Error(
    `"${username}" was not recorded with role "${role}" on troupe ${troupeId}'s staff list within ${timeout}ms; ` +
    `staff currently reads: ${JSON.stringify(staff)}`
  );
}

/** The role code (e.g. "AST") a user currently holds on a troupe's staff list, read off `readStaff`, or null. */
async function readStaffRole(page, troupeId, username) {
  const staff = await readStaff(page, troupeId);
  const row = staff.find((r) => r.indexOf(username) !== -1);
  if (!row) return null;
  const m = row.match(/^(\w+):/);
  return m ? m[1] : null;
}

/** Names currently listed in a troupe's staff section. */
async function readStaff(page, troupeId) {
  await navigateToHash(page, `troupe/${troupeId}`, '#troupe');
  return page.evaluate(() => {
    const region = document.querySelector('#troupe-staff');
    if (!region) return [];
    return Array.from(region.querySelectorAll('li, tr'))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  });
}

/**
 * Join a character to a troupe and wait for the membership to land.
 *
 * The join route updates the character's ACL and troupe relation server-side
 * with no page transition to wait on, so returning as soon as the hash changes
 * races the save: the roster read that follows comes back empty and the test
 * fails somewhere unrelated to the actual cause.
 *
 * Waiting for the route's *own* destination - not merely for the loader - is
 * what makes that safe. `character_join_troupe` ends by calling
 * `changePage("#troupe")` at the tail of an async chain, so leaving while it is
 * still in flight means the next navigation and this one both finish, in
 * whichever order they please. Measured: the roster read that follows landed on
 * the roster hash with `#troupe` still the active page, because the join's
 * `changePage` arrived last and won. That looked exactly like a swallowed
 * navigation and used to be papered over by `navigateToHash`'s reload fallback,
 * since removed; it is really just this race, and waiting here is what fixes it.
 */
async function joinTroupe(page, characterId, troupeId, { timeout = 30000 } = {}) {
  await navigateToHash(page, `character/${characterId}/troupe/${troupeId}/join`, '#troupe');
  await waitForJqmLoader(page);
  await waitForMembership(page, characterId, troupeId, true, timeout);
}

/**
 * Remove a character from a troupe and wait for the removal to land.
 *
 * `character_leave_troupe` redirects to `#character?<cid>` from an `.always()`,
 * so that - not the troupe page - is where a completed leave settles. Same race
 * as `joinTroupe` above.
 */
async function leaveTroupe(page, characterId, troupeId, { timeout = 30000 } = {}) {
  await navigateToHash(page, `character/${characterId}/troupe/${troupeId}/leave`, '#character');
  await waitForJqmLoader(page);
  await waitForMembership(page, characterId, troupeId, false, timeout);
}

/**
 * Poll the troupe's roster until membership reaches the expected state.
 *
 * The join relation lives on the *character* (`troupes`), not on the troupe
 * (see `database_seed/_Join troupes Vampire.json`), so querying
 * `troupe.relation('characters')` counts zero no matter what and makes a
 * perfectly good join look like a failure. Reading the roster page sidesteps
 * the direction question entirely and checks what a user would actually see.
 */
async function waitForMembership(page, characterId, troupeId, shouldBeMember, timeout) {
  const deadline = Date.now() + timeout;
  let roster = [];

  while (Date.now() < deadline) {
    roster = await readRoster(page, troupeId);
    const isMember = roster.some((r) => r.id === characterId);
    if (isMember === shouldBeMember) return;
    await page.waitForTimeout(1000);
  }

  throw new Error(
    `character ${characterId} did not ${shouldBeMember ? 'join' : 'leave'} troupe ${troupeId} ` +
    `within ${timeout}ms; roster currently holds ${JSON.stringify(roster.map((r) => r.id))}`
  );
}

/** Characters listed on a troupe's roster, as `{ id, name }`. */
async function readRoster(page, troupeId, type = 'all') {
  await navigateToHash(page, `troupe/${troupeId}/characters/${type}`, '#troupe-characters-all');
  return page.evaluate(() => {
    const root = document.querySelector('#troupe-characters-all');
    if (!root) return [];
    return Array.from(root.querySelectorAll('a.character-listing, a[backendid]')).map((a) => ({
      id: a.getAttribute('backendid'),
      name: (a.getAttribute('name') || a.textContent).replace(/\s+/g, ' ').trim()
    }));
  });
}

/** Troupes a character currently belongs to. */
async function readCharacterTroupes(page, characterId) {
  await navigateToHash(page, `character/${characterId}/troupes`);
  await waitForJqmLoader(page);
  return page.evaluate(() => {
    const pg = document.querySelector('.ui-page-active');
    if (!pg) return [];
    return Array.from(pg.querySelectorAll('a.troupe-listing')).map((a) => ({
      id: a.getAttribute('backendid'),
      name: (a.getAttribute('name') || '').trim()
    }));
  });
}

/** Count troupes whose name starts with `prefix`. */
async function countTroupesByPrefix(page, prefix) {
  return page.evaluate((p) => {
    const q = new window.Parse.Query('Troupe');
    q.startsWith('name', p);
    return q.count();
  }, prefix);
}

/**
 * Destroy every troupe whose name starts with `prefix`, together with the
 * three per-troupe Roles (`LST_<id>`/`AST_<id>`/`Narrator_<id>`) the real
 * "New Troupe" form creates alongside it (see TroupeNewView.js). Without this,
 * Role rows accumulate forever — nothing else in the application ever cleans
 * them up. `role:Administrator` holds class-level `delete` on both `Troupe`
 * and `_Role` (see database_seed/_SCHEMA.json), and `devuser` is a member, so
 * this only ever needs to run logged in as the admin fixture user.
 */
async function destroyTroupesByPrefix(page, prefix) {
  return page.evaluate(async (p) => {
    const Parse = window.Parse;
    const q = new Parse.Query('Troupe');
    q.startsWith('name', p);
    q.limit(1000);
    const troupes = await q.find();
    const result = { troupes: troupes.length, roles: 0, errors: [] };
    if (troupes.length === 0) return result;

    const roleNames = [];
    troupes.forEach((t) => {
      ['LST_', 'AST_', 'Narrator_'].forEach((rolePrefix) => roleNames.push(rolePrefix + t.id));
    });

    try {
      const rq = new Parse.Query(Parse.Role);
      rq.containedIn('name', roleNames);
      rq.limit(1000);
      const roles = await rq.find();
      if (roles.length) {
        await Parse.Object.destroyAll(roles);
        result.roles = roles.length;
      }
    } catch (e) {
      result.errors.push('Role sweep: ' + (e && e.message ? e.message : String(e)));
    }

    try {
      await Parse.Object.destroyAll(troupes);
    } catch (e) {
      result.errors.push('Troupe: ' + (e && e.message ? e.message : String(e)));
    }
    return result;
  }, prefix);
}

module.exports = {
  uniqueTroupeName,
  createTroupe,
  findTroupeIdByName,
  listTroupes,
  addStaff,
  readStaff,
  readStaffRole,
  joinTroupe,
  leaveTroupe,
  waitForMembership,
  readRoster,
  readCharacterTroupes,
  countTroupesByPrefix,
  destroyTroupesByPrefix
};
