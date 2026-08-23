/**
 * jQuery Mobile widget enhancement, asserted against BOTH front ends.
 *
 * WHY THIS FILE EXISTS
 *
 * Every other spec here asserts behaviour and text. None asserts that a control
 * is styled, and that gap is not theoretical: the Vue port passed all 447 of
 * them while rendering the character list's filter box as a bare browser input,
 * the character sheet's tiles as blue underlined links, and the print sheet's
 * font-size control as an unstyled dropdown. A human found all three by looking
 * at the screen, which is the review signal this repository is trying not to
 * depend on.
 *
 * The check is possible because jQuery Mobile's styling is entirely
 * class-driven, and the classes are load-bearing rather than decorative: the
 * 1.4.5 stylesheet has no `:first-child` selectors and no rules matching a bare
 * `<select>`, so an unenhanced control is not "slightly off", it is unstyled.
 *
 * WHY IT RUNS AGAINST BOTH
 *
 * The legacy app passes this trivially -- jQM's own JavaScript does the
 * enhancement, so it IS the specification. Running it against both is what makes
 * it a comparison rather than an assertion of my own opinion: if it ever fails
 * on the legacy client, the invariant is wrong and this file is what needs
 * fixing, not the app.
 *
 * WHAT IT DOES NOT CHECK
 *
 * Colours, spacing, fonts -- anything a stylesheet decides once the right
 * classes are present. Those were never in question; the classes were.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { navigateToHash, activePageId } = require('./helpers/jqm-helpers');
const { createCompletedCharacter, destroyCharactersByPrefix } = require('./helpers/characters');

const FIXTURE_PREFIX = 'E2E JQM ';

/**
 * The invariants, read off whichever page is currently active.
 *
 * Each selector names a control jQM wraps rather than styles in place, which is
 * the shape of mistake this is here to catch: the classes go on a parent the
 * hand-written markup did not have.
 */
async function unenhanced(page) {
  return page.evaluate(() => {
    const active = document.querySelector('.ui-page-active');
    if (!active) return { error: 'no active page' };

    const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);

    return {
      // `.ui-select` is a wrapper div; a select outside one gets no jQM styling.
      selects: Array.from(active.querySelectorAll('select'))
        .filter((el) => !el.closest('.ui-select'))
        .map((el) => el.name || el.id || '(unnamed)'),

      // Same for `.ui-checkbox`, which also supplies the visible label.
      checkboxes: Array.from(active.querySelectorAll('input[type="checkbox"]'))
        .filter((el) => !el.closest('.ui-checkbox'))
        .map((el) => el.name || el.id || '(unnamed)'),

      // `ui-input-search` draws the field; the input itself carries nothing.
      searches: Array.from(active.querySelectorAll('input[data-type="search"]'))
        .filter((el) => !el.closest('.ui-input-search'))
        .map((el) => el.id || el.name || '(unnamed)'),

      // A listview's own child anchors are buttons. Without `ui-btn` they fall
      // back to the browser's blue underlined link.
      links: Array.from(active.querySelectorAll('ul[data-role="listview"] > li > a'))
        .filter((el) => !el.classList.contains('ui-btn'))
        .map(text),

      // `ui-first-child` / `ui-last-child` are the ONLY thing rounding an inset
      // list's corners -- there is no `:first-child` rule anywhere in 1.4.5.
      unrounded: Array.from(active.querySelectorAll('ul[data-role="listview"]'))
        .filter((ul) => {
          const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
          const visible = items.filter((c) => c.style.display !== 'none');
          if (visible.length === 0) return false;
          return !ul.querySelector('li.ui-first-child') || !ul.querySelector('li.ui-last-child');
        })
        .map((ul) => ul.id || '(unnamed list)'),
    };
  });
}

/**
 * One reviewed difference, and the reason it is allowed rather than fixed.
 *
 * The Backbone app leaves the rule editor's category select UNENHANCED: six
 * routes share that screen, `DescriptionsView` enhances its copy and `EditRules`
 * does not, so `#administration/descriptions` is styled and
 * `#administration/bnsmetv1_clan_rules` is not. That is a missed
 * `enhanceWithin()` in one of two views, not a decision.
 *
 * The Vue port renders all six routes through ONE component -- faithfully, since
 * the router shared one view instance across them -- so it cannot reproduce the
 * inconsistency without deliberately un-styling a control based on which route
 * reached it. It is enhanced on all six. The port is therefore STRICTER than the
 * original here, in the one direction that cannot break anything, and this entry
 * records that rather than letting the spec quietly skip the page.
 */
const LEGACY_GAPS = {
  'administration/bnsmetv1_clan_rules': { selects: ['category'] },
  'administration/bnsctdbs_kith_rules': { selects: ['category'] },
  'administration/bnsmetv1_elder_discipline_rules': { selects: ['category'] },
  'administration/bnsmetv1_technique_rules': { selects: ['category'] },
  'administration/bnsmetv1_ritual_rules': { selects: ['category'] }
};

function assertClean(report, hash, gaps = {}) {
  const without = (found, allowed) => found.filter((name) => !(allowed || []).includes(name));
  expect(report.error, `${hash}: ${report.error}`).toBeUndefined();
  expect(without(report.selects, gaps.selects), `${hash}: <select> outside .ui-select`).toEqual([]);
  expect(report.checkboxes, `${hash}: checkbox outside .ui-checkbox`).toEqual([]);
  expect(report.searches, `${hash}: search input outside .ui-input-search`).toEqual([]);
  expect(report.links, `${hash}: listview link without ui-btn`).toEqual([]);
  expect(report.unrounded, `${hash}: listview without first/last rounding`).toEqual([]);
}

test.describe.serial('jQuery Mobile widget enhancement', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  let cid;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage();
    await loginAsAdmin(page);
    await destroyCharactersByPrefix(page, FIXTURE_PREFIX);
    // `spendPools: false` -- this file cares about markup, not about XP.
    const character = await createCompletedCharacter(page, 'Vampire', {
      name: `${FIXTURE_PREFIX}Subject`,
      spendPools: false
    });
    cid = character.id;
  });

  test.afterAll(async () => {
    if (!page) return;
    await destroyCharactersByPrefix(page, FIXTURE_PREFIX);
    await page.close();
  });

  // Routes that need no fixture. The page id each lands on is passed so a
  // failure to navigate is reported as that rather than as a styling problem.
  const PLAIN = [
    ['characters?all', 'characters-all'],
    ['profile', 'user-settings-profile'],
    ['administration', 'administration'],
    ['troupes', 'troupes-list'],
    ['referendums', 'referendums-list'],
    ['administration/users/all', 'troupe-add-staff'],
    ['administration/patronages', 'administration-patronages-view'],
    ['administration/descriptions', 'administration-descriptions'],
    ['administration/bnsmetv1_clan_rules', 'administration-descriptions'],
    ['characternew', 'character-new'],
    ['troupe/new', 'troupe-new']
  ];

  for (const [hash, pageId] of PLAIN) {
    test(`#${hash} renders only enhanced controls`, async () => {
      await navigateToHash(page, hash, '#' + pageId);
      expect(await activePageId(page)).toBe(pageId);
      assertClean(await unenhanced(page), '#' + hash, LEGACY_GAPS[hash]);
    });
  }

  // The character-scoped screens, including the two the port got wrong.
  const SCOPED = [
    ['character?%s', 'character'],
    ['character/%s/print', 'printable-sheet'],
    ['character/%s/costs', 'character-costs'],
    ['character/%s/log/0/10', 'character-log'],
    ['character/%s/experience/0/10', 'experience-notations-all'],
    ['character/%s/backgroundlt', 'long-text'],
    ['character/%s/extendedprinttext', 'extended-print-text']
  ];

  for (const [template, pageId] of SCOPED) {
    test(`#${template.replace('%s', ':cid')} renders only enhanced controls`, async () => {
      const hash = template.replace('%s', cid);
      await navigateToHash(page, hash, '#' + pageId);
      expect(await activePageId(page)).toBe(pageId);
      assertClean(await unenhanced(page), '#' + hash);
    });
  }
});
