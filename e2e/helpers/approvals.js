/**
 * Approval helpers.
 *
 * The approval view is slider-driven rather than a per-change button list: a
 * range slider selects how far through the change history to approve, and a
 * single `.approve-change` button commits it, labelled "Approve changes up to
 * N". Approving "the latest change" therefore means pushing the slider to its
 * maximum and clicking once.
 */

const {
  navigateToHash,
  waitForJqmLoader,
  setJqmSlider,
  normalize
} = require('./jqm-helpers');

const PAGE = '#character-approval';

/**
 * Open a character's approval view.
 *
 * Two app-side quirks make this less straightforward than the other routes.
 *
 * 1. The view renders one region per recorded change plus a slider, so on a
 *    character with a full creation history it is much slower to settle than
 *    the rest of the app and needs a longer wait than the default.
 *
 * 2. Navigating here directly after another character view can strand the
 *    router: the route only calls `$.mobile.changePage` once
 *    `CharacterApprovalView.register` resolves, `register` short-circuits when
 *    handed the same model instance it already holds, and its final
 *    `p.then(function () { Parse.Promise.as(self); })` is missing a `return`
 *    (CharacterApprovalView.js). The result is a silent no-op with no error
 *    logged and the previous page left active. Routing via the character sheet
 *    first clears that state reliably.
 */
async function openApproval(page, characterId, { timeout = 60000 } = {}) {
  try {
    await navigateToHash(page, `character/${characterId}/approval`, PAGE, timeout);
    return;
  } catch (first) {
    // Bounce through the sheet and retry once before giving up.
    await navigateToHash(page, `character?${characterId}`, '#character', timeout).catch(() => {});
    try {
      await navigateToHash(page, `character/${characterId}/approval`, PAGE, timeout);
    } catch (second) {
      throw new Error(
        `could not open the approval view for ${characterId}, even after routing via the ` +
        `character sheet. ${second.message}`
      );
    }
  }
}

/**
 * Read the change-range sliders.
 *
 * jQuery Mobile renders its slider control as `input[type="number"]`, not
 * `input[type="range"]`, so the obvious selector finds nothing. There are two:
 * `historyBaseRange` (`#sliderbaserange`) is the left bound and
 * `historyChangePicker` (`#slider`) is the right bound. Both default to
 * covering the whole history, which is why the approve button already reads
 * "Approve changes up to N" on arrival.
 */
async function readSlider(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;

    const read = (name) => {
      const input = root.querySelector(`input[name="${name}"]`);
      if (!input) return null;
      return {
        value: parseInt(input.value, 10),
        min: parseInt(input.getAttribute('min') || '0', 10),
        max: parseInt(input.getAttribute('max') || '0', 10),
        id: input.id
      };
    };

    const left = read('historyBaseRange');
    const right = read('historyChangePicker');
    if (!left && !right) return null;
    return { left, right, value: right ? right.value : null, max: right ? right.max : null };
  }, PAGE);
}

/** Move the approval range to cover changes `from`..`to`. */
async function setApprovalRange(page, from, to) {
  if (from !== undefined && from !== null) {
    await setJqmSlider(page, `${PAGE} input[name="historyBaseRange"]`, from);
  }
  if (to !== undefined && to !== null) {
    await setJqmSlider(page, `${PAGE} input[name="historyChangePicker"]`, to);
  }
}

/** The label on the approve button, e.g. "Approve changes up to 26". */
async function readApproveButtonLabel(page) {
  const button = page.locator(`${PAGE} .approve-change`).first();
  if (await button.count() === 0) return null;
  return normalize(await button.textContent());
}

/** True when the current user is offered an approve control at all. */
async function canApprove(page, characterId) {
  await openApproval(page, characterId);
  return (await page.locator(`${PAGE} .approve-change`).count()) > 0;
}

/**
 * Approve every change recorded so far.
 * Pushes the slider to its maximum, then commits.
 */
async function approveLatestChange(page, characterId) {
  await openApproval(page, characterId);

  const button = page.locator(`${PAGE} .approve-change`).first();
  if (await button.count() === 0) {
    throw new Error('no approve control is available to this user on this character');
  }

  const slider = await readSlider(page);
  if (slider && slider.right && slider.right.value !== slider.right.max) {
    await setApprovalRange(page, null, slider.right.max);
  }

  const before = await countApprovals(page, characterId);

  await openApproval(page, characterId);
  await page.locator(`${PAGE} .approve-change`).first().click();
  await waitForJqmLoader(page);

  // Wait for the approval to actually land rather than assuming the click took.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const now = await countApprovals(page, characterId);
    if (now > before) return now;
    await page.waitForTimeout(500);
  }
  throw new Error(`approval did not register (still ${before} approvals after clicking approve)`);
}

/**
 * The approvals recorded against a character, as their object ids.
 *
 * The approvals region is not a table or a list: it is a second jQuery Mobile
 * slider (`#approval-slider`, name `approvalChangePicker`) whose `max` equals
 * the number of approvals, accompanied by one hidden
 * `#approval-changes-N` input per approval holding that approval's object id.
 * Scraping it for `tr` or `li` elements finds nothing and makes every approval
 * look like it silently failed.
 */
async function readApprovals(page, characterId) {
  await openApproval(page, characterId);
  return page.evaluate(() => {
    const region = document.querySelector('#approval-approvals');
    if (!region) return [];
    return Array.from(region.querySelectorAll('input[id^="approval-changes-"]'))
      .map((input) => input.value)
      .filter(Boolean);
  });
}

/** The approvals slider's current position and maximum. */
async function readApprovalSlider(page, characterId) {
  await openApproval(page, characterId);
  return page.evaluate(() => {
    const input = document.querySelector('#approval-approvals input[name="approvalChangePicker"]');
    if (!input) return null;
    return {
      value: parseInt(input.value, 10),
      max: parseInt(input.getAttribute('max') || '0', 10)
    };
  });
}

async function countApprovals(page, characterId) {
  return (await readApprovals(page, characterId)).length;
}

/** Rows listed in the pending-changes region. */
async function readPendingChanges(page, characterId) {
  await openApproval(page, characterId);
  return page.evaluate(() => {
    const region = document.querySelector('#approval-changes');
    if (!region) return [];
    return Array.from(region.querySelectorAll('tbody tr, li'))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  });
}

/**
 * Read the approved snapshot sheet as a map of trait name to displayed value.
 * This is what step-by-step approval assertions compare against.
 */
async function readApprovedSnapshot(page, characterId) {
  await navigateToHash(page, `character/${characterId}/approved`);
  await waitForJqmLoader(page);
  return page.evaluate(() => {
    const pg = document.querySelector('.ui-page-active');
    if (!pg) return { pageId: null, text: '', traits: {} };

    const traits = {};
    // Printable sheets render traits as "Name x2" or "Name 2" list entries.
    pg.querySelectorAll('li, td, span').forEach((el) => {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      const m = text.match(/^(.+?)\s*x?(\d+)$/);
      if (m && m[1].length < 60) {
        traits[m[1].trim()] = parseInt(m[2], 10);
      }
    });

    return {
      pageId: pg.id,
      text: pg.textContent.replace(/\s+/g, ' ').trim(),
      traits
    };
  });
}

module.exports = {
  PAGE,
  openApproval,
  readSlider,
  setApprovalRange,
  readApproveButtonLabel,
  canApprove,
  approveLatestChange,
  readApprovals,
  readApprovalSlider,
  countApprovals,
  readPendingChanges,
  readApprovedSnapshot
};
