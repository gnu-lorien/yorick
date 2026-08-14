/**
 * Troupe helpers.
 *
 * Troupe list items render as `a.troupe-listing[name][backendid]`, which is how
 * a troupe's real object id is recovered without hardcoding one. The previous
 * suite pinned `WOad4CBTsG` into every troupe test; fixtures here create their
 * own troupes so specs can run in any order against any database.
 */

const { navigateToHash, waitForJqmLoader, normalize } = require('./jqm-helpers');

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
 * Add a user to a troupe's staff by username.
 *
 * INCOMPLETE — see the Task 0 report. Picking a user from
 * `#troupe/:id/staff/add` navigates to `#troupe/:id/staff/edit/:uid`, where a
 * role (LST / AST / Narrator) still has to be chosen and saved. This helper
 * currently performs only the first step, so the staff list stays empty. The
 * role-selection step needs to be added before Task 7 tests 130-131 can pass;
 * it throws rather than returning quietly so nothing builds on a false success.
 */
async function addStaff(page, troupeId, username, { allowIncomplete = false } = {}) {
  await navigateToHash(page, `troupe/${troupeId}/staff/add`, '#troupe-add-staff');

  const entry = page.locator('#troupe-add-staff ul li a').filter({ hasText: new RegExp(`\\b${username}\\b`) }).first();
  if (await entry.count() === 0) {
    const available = await page.locator('#troupe-add-staff ul li a')
      .evaluateAll((els) => els.slice(0, 12).map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    throw new Error(`user "${username}" not offered in the staff picker. Available: ${available.join(' | ')}`);
  }

  await entry.click();
  await waitForJqmLoader(page);

  const staff = await readStaff(page, troupeId);
  const added = staff.some((row) => row.indexOf(username) !== -1);
  if (!added && !allowIncomplete) {
    throw new Error(
      `selecting "${username}" did not add them to the staff list. The add-staff flow ` +
      `continues to #troupe/${troupeId}/staff/edit/<uid> where a role must be chosen and ` +
      `saved; that step is not implemented yet. Pass { allowIncomplete: true } to proceed anyway.`
    );
  }
  return added;
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
 */
async function joinTroupe(page, characterId, troupeId, { timeout = 30000 } = {}) {
  await navigateToHash(page, `character/${characterId}/troupe/${troupeId}/join`);
  await waitForJqmLoader(page);
  await waitForMembership(page, characterId, troupeId, true, timeout);
}

/** Remove a character from a troupe and wait for the removal to land. */
async function leaveTroupe(page, characterId, troupeId, { timeout = 30000 } = {}) {
  await navigateToHash(page, `character/${characterId}/troupe/${troupeId}/leave`);
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

module.exports = {
  uniqueTroupeName,
  createTroupe,
  findTroupeIdByName,
  listTroupes,
  addStaff,
  readStaff,
  joinTroupe,
  leaveTroupe,
  waitForMembership,
  readRoster,
  readCharacterTroupes
};
