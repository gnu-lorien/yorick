/**
 * jQuery Mobile / Marionette / Parse helpers for the Playwright E2E suite.
 *
 * Yorick renders every route into a jQuery Mobile page inside one document, so
 * "navigation" means changing the hash and waiting for a different page element
 * to become the active one. There is no document-level load event to hang a
 * wait on, which is why these helpers wait on application state rather than
 * sleeping for a fixed interval.
 */

const DEFAULT_TIMEOUT = 20000;

/** Wait for RequireJS, jQuery Mobile, and the Parse SDK to finish bootstrapping. */
async function waitForAppReady(page, timeout = DEFAULT_TIMEOUT) {
  await page.waitForFunction(() => {
    return typeof window.jQuery !== 'undefined' &&
           typeof window.jQuery.mobile !== 'undefined' &&
           typeof window.Parse !== 'undefined' &&
           !!window.Parse.applicationId &&
           typeof window.require === 'function';
  }, { timeout });
}

/** Wait for the jQuery Mobile loading spinner to clear. */
async function waitForJqmLoader(page, timeout = 15000) {
  await page.waitForFunction(() => {
    const loader = document.querySelector('.ui-loader');
    if (!loader) return true;
    const style = window.getComputedStyle(loader);
    return style.display === 'none' || style.visibility === 'hidden' || loader.offsetParent === null;
  }, { timeout }).catch(() => { /* loader may never have appeared */ });
}

/** The id of the currently active jQuery Mobile page, or null. */
async function activePageId(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.ui-page-active');
    return el ? el.id : null;
  });
}

/**
 * Wait until `expectedId` is the active jQuery Mobile page.
 *
 * Marionette re-renders regions asynchronously after the page becomes active,
 * so this also waits for the page to stop being empty.
 */
async function waitForActivePage(page, expectedId, timeout = DEFAULT_TIMEOUT) {
  const id = expectedId.startsWith('#') ? expectedId.slice(1) : expectedId;
  try {
    await page.waitForFunction((wanted) => {
      const el = document.querySelector('.ui-page-active');
      if (!el || el.id !== wanted) return false;
      const main = el.querySelector('div[role="main"]') || el;
      return main.textContent.trim().length > 0 || main.children.length > 0;
    }, id, { timeout });
  } catch (err) {
    // A bare "waitForFunction timed out" says nothing about what went wrong.
    // Report where the app actually ended up, which is almost always the answer.
    const actual = await page.evaluate(() => {
      const el = document.querySelector('.ui-page-active');
      return {
        activePage: el ? el.id : null,
        empty: el ? (el.querySelector('div[role="main"]') || el).textContent.trim().length === 0 : null,
        hash: window.location.hash
      };
    }).catch(() => null);
    throw new Error(
      `expected jQuery Mobile page "#${id}" to become active within ${timeout}ms; ` +
      (actual
        ? `active page is "${actual.activePage ? '#' + actual.activePage : 'none'}"` +
          (actual.empty ? ' (rendered but empty)' : '') +
          `, hash is "${actual.hash}"`
        : 'could not read the page state')
    );
  }
  await waitForJqmLoader(page);
}

/**
 * Navigate to a hash route and wait for it to render.
 *
 * When `targetSelector` names a page id, this waits for that page to become the
 * *active* one rather than merely present, because every route's markup stays
 * in the document once visited and a plain selector wait would match a stale
 * hidden copy.
 */
async function navigateToHash(page, hash, targetSelector = null, timeout = DEFAULT_TIMEOUT) {
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;

  await page.evaluate((h) => {
    const current = window.location.hash.replace(/^#/, '');
    if (current !== h) {
      window.location.hash = '#' + h;
      return null;
    }
    // The hash is already what we want, so no hashchange will fire and the
    // route handler would never run. Bouncing through a dummy hash to force one
    // races jQuery Mobile's transition queue and can strand the app mid
    // transition, so drive Backbone's router directly instead.
    return new Promise((resolve) => {
      window.require(['backbone'], function (Backbone) {
        Backbone.history.loadUrl(h);
        resolve(null);
      });
    });
  }, cleanHash);

  await waitForJqmLoader(page, timeout);

  if (!targetSelector) return;

  const asId = targetSelector.startsWith('#') ? targetSelector.slice(1) : null;
  const isPageId = asId && /^[A-Za-z0-9_-]+$/.test(asId);

  if (!isPageId) {
    await page.waitForSelector(targetSelector, { state: 'visible', timeout });
    return;
  }

  try {
    await waitForActivePage(page, asId, timeout);
  } catch (first) {
    // Several routes only call `$.mobile.changePage` after a view's `register`
    // promise resolves, and some of those short-circuit when handed a model or
    // page they already hold — leaving the hash updated but the previous page
    // still active, with nothing logged. Re-running the route handler clears it.
    await page.evaluate((h) => new Promise((resolve) => {
      window.require(['backbone'], function (Backbone) {
        Backbone.history.loadUrl(h);
        resolve(null);
      });
    }), cleanHash);
    await waitForJqmLoader(page, timeout);

    try {
      await waitForActivePage(page, asId, timeout);
      return;
    } catch (second) {
      // Some views strand the router outright — the approval view in particular
      // will not hand off to an unrelated route, and re-running the handler
      // changes nothing. Reloading the app is heavy but reliable, and the Parse
      // session lives in localStorage so the user stays signed in.
      await page.goto('/');
      await waitForAppReady(page, timeout);
      await page.evaluate((h) => { window.location.hash = '#' + h; }, cleanHash);
      await waitForJqmLoader(page, timeout);

      try {
        await waitForActivePage(page, asId, timeout);
      } catch (third) {
        throw new Error(
          `${third.message} (retried by re-running the route handler, then by reloading the app)`
        );
      }
    }
  }
}

/**
 * Reload the app from scratch, then wait for it to re-bootstrap.
 *
 * The Parse session lives in localStorage, so the user stays signed in across
 * the reload. Several router properties (`self.administrationEditRules`,
 * `self.administrationDescriptionsView`, ...) are memoized on the *router
 * instance* and only constructed once per page load; reloading is the only
 * reliable way to force a route handler to build a genuinely fresh view.
 */
async function hardReload(page, timeout = DEFAULT_TIMEOUT) {
  await page.evaluate(() => { window.location.reload(); });
  await waitForAppReady(page, timeout);
}

/** Set a jQuery Mobile slider and fire the change event the view listens for. */
async function setJqmSlider(page, selector, value) {
  await page.waitForSelector(selector, { state: 'attached' });
  await page.evaluate(({ sel, val }) => {
    const el = window.jQuery(sel);
    el.val(val);
    try { el.slider('refresh'); } catch (e) { /* not enhanced as a slider */ }
    el.trigger('change');
  }, { sel: selector, val: value });
}

/** Submit a form and wait for the resulting work to finish. */
async function submitJqmForm(page, formSelector) {
  await page.waitForSelector(formSelector, { state: 'visible' });
  await page.locator(formSelector)
    .locator('button[type="submit"], input[type="submit"], button')
    .first()
    .click();
  await waitForJqmLoader(page);
}

/**
 * Popups are duplicated in the DOM, so ids are not unique.
 *
 * Every time a view re-renders, jQuery Mobile enhances a fresh copy of the
 * popup markup and leaves the previous copies behind. A character with four
 * experience notations ends up with sixteen elements carrying
 * `id="alteration-input"`. `document.querySelector('#alteration-input')` and
 * `page.fill('#alteration-input', ...)` therefore address an arbitrary — often
 * detached — copy, and the edit silently does nothing.
 *
 * Everything popup-related below is scoped to the one container jQuery Mobile
 * has actually opened and made visible.
 */
const ACTIVE_POPUP = '.ui-popup-container.ui-popup-active:visible';

/** True when at least one copy of the named popup is open. */
async function waitForJqmPopup(page, popupSelector, timeout = 15000) {
  await page.waitForFunction((sel) => {
    return Array.from(document.querySelectorAll(sel)).some((popup) => {
      const container = popup.closest('.ui-popup-container');
      return !!container &&
             container.classList.contains('ui-popup-active') &&
             container.offsetParent !== null;
    });
  }, popupSelector, { timeout });
}

/** True when no copy of the named popup is open. */
async function waitForJqmPopupClosed(page, popupSelector, timeout = 15000) {
  await page.waitForFunction((sel) => {
    return !Array.from(document.querySelectorAll(sel)).some((popup) => {
      const container = popup.closest('.ui-popup-container');
      return !!container &&
             container.classList.contains('ui-popup-active') &&
             container.offsetParent !== null;
    });
  }, popupSelector, { timeout });
}

/**
 * A locator for the visible copy of a specific popup.
 *
 * Scoping merely to "the active popup container" is not enough: more than one
 * container can still carry `ui-popup-active`, so the last one may belong to a
 * different popup entirely (the reason editor rather than the alteration
 * editor, say). Selecting the visible instance of the popup we actually named
 * is what makes this deterministic.
 */
function activePopup(page, popupSelector) {
  if (!popupSelector) return page.locator(ACTIVE_POPUP).last();
  return page.locator(`${popupSelector}:visible`).last();
}

/** Fill a field inside the named popup's visible copy. */
async function fillInActivePopup(page, popupSelector, fieldSelector, value) {
  const field = activePopup(page, popupSelector).locator(fieldSelector).last();
  await field.waitFor({ state: 'visible', timeout: 10000 });
  await field.fill(String(value));
  return field;
}

/** Submit the named popup's visible copy. */
async function submitActivePopup(page, popupSelector) {
  const popup = activePopup(page, popupSelector);
  const submit = popup.locator('button[type="submit"]');
  const target = (await submit.count()) > 0 ? submit.last() : popup.locator('button').last();
  await target.click();
}

/**
 * Backform (the form library behind PatronageView, UserSettingsProfileView's
 * UserForm, AdministrationUserView's UserForm, and others) renders real native
 * `<select>`/`<input>` elements with a plain `name="..."` attribute, but two of
 * its behaviours are easy to silently get wrong from a test:
 *
 * 1. `SelectControl` formats option values through `Backform.JSONFormatter`,
 *    so the DOM `value` attribute a browser actually assigns an `<option>` is
 *    `JSON.stringify(rawValue)` - e.g. the option for user id `user_abc` has
 *    `value` literally `"user_abc"` *including the quote characters*, not the
 *    plain id. Selecting by that raw value is fragile and opaque, so
 *    `selectBackformOption` resolves the right `<option>` by its visible text
 *    and reads back whatever value the browser actually assigned it.
 * 2. Every Backform control only copies the DOM value into the backing model
 *    on a `change` (or, for `DatepickerControl`, `blur`) event - see
 *    `Control.onChange` in backform.js. Playwright's `fill()` is not
 *    guaranteed to raise a `change` event the way a real user's blur does, so
 *    a field can look filled on screen while the model - and therefore the
 *    eventual submit, which reads straight from the model - never sees the
 *    new value. `fillBackformInput` fills, then dispatches `change`
 *    explicitly, the same defensive pattern `setJqmSlider` above already uses
 *    for jQuery Mobile's own custom controls.
 */
async function selectBackformOption(page, selectSelector, optionText) {
  const select = page.locator(selectSelector);
  const option = select.locator('option', { hasText: optionText }).first();
  await option.waitFor({ state: 'attached' });
  const value = await option.evaluate((el) => el.value);
  await select.selectOption(value);
  await select.dispatchEvent('change');
  return value;
}

/**
 * Force-clear a stuck jQuery Mobile loading overlay.
 *
 * Several admin routes (`administration_patronage*` in mobileRouter.js, and -
 * identically - the five `administration_bnsmetv1_*_rules` / `administration_
 * bnsctdbs_kith_rules` / `administration_descriptions` routes) call
 * `$.mobile.loading("show")` up front but only call the matching `.hide()`
 * inside a `.fail(...)` branch, never unconditionally on success (unlike
 * sibling routes that correctly use `.always(...)`). After a *successful*
 * navigation to any of these, `<html>` is left with the `ui-loading` class
 * permanently applied, whose full-page overlay then intercepts the next click
 * anywhere on the page. Confirmed live. This does not paper over a wrong
 * result anywhere - it only clears a confirmed, named UI bug from blocking an
 * unrelated later click.
 */
async function clearStuckLoader(page) {
  await page.evaluate(() => {
    if (window.jQuery && window.jQuery.mobile) window.jQuery.mobile.loading('hide');
  });
}

async function fillBackformInput(page, inputSelector, value) {
  const input = page.locator(inputSelector);
  await input.fill(String(value));
  await input.dispatchEvent('change');

  // DatepickerControl fields specifically (bootstrap-datepicker) race the
  // submit click if the field is still focused when it happens: clicking
  // Submit blurs the input a second time, and whichever handler - bootstrap-
  // datepicker's own or Backform's delegated "blur input" onChange - runs
  // last on that blur can leave the model holding something other than what
  // was just typed. Confirmed live: the *last* field filled before a submit
  // click silently saved as "now" instead of the typed date, while an
  // earlier-filled, already-blurred field on the same form saved correctly.
  // Blurring here, immediately after dispatching our own change, means that
  // race has already settled well before any later submit click.
  await input.blur();
}

/**
 * Parse the first integer out of a piece of text.
 * Returns null rather than NaN so callers can assert on absence explicitly.
 */
function parseIntOrNull(text) {
  if (text === null || text === undefined) return null;
  const m = String(text).replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Collapse whitespace so assertions are not defeated by template indentation. */
function normalize(text) {
  return String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * Run a function against RequireJS modules inside the page and surface failures
 * as real errors.
 *
 * Parse 1.9 promises are jQuery-style: a rejection may arrive via `.fail`
 * instead of the second `.then` argument, so both are wired up. `fnBody` is a
 * function body string receiving `(mods, arg)`.
 */
async function runInApp(page, modules, fnBody, arg) {
  return page.evaluate(({ modules, fnBody, arg }) => {
    return new Promise((resolve, reject) => {
      const fail = (e) => reject(new Error(e && e.message ? e.message : String(e)));
      window.require(modules, function () {
        const mods = Array.prototype.slice.call(arguments);
        let result;
        try {
          // eslint-disable-next-line no-new-func
          result = new Function('mods', 'arg', fnBody)(mods, arg);
        } catch (e) {
          fail(e);
          return;
        }
        if (result && typeof result.then === 'function') {
          result.then(resolve, fail);
          if (typeof result.fail === 'function') result.fail(fail);
        } else {
          resolve(result);
        }
      }, fail);
    });
  }, { modules, fnBody, arg });
}

module.exports = {
  DEFAULT_TIMEOUT,
  waitForAppReady,
  waitForJqmLoader,
  activePageId,
  waitForActivePage,
  navigateToHash,
  hardReload,
  setJqmSlider,
  submitJqmForm,
  waitForJqmPopup,
  waitForJqmPopupClosed,
  ACTIVE_POPUP,
  activePopup,
  fillInActivePopup,
  submitActivePopup,
  clearStuckLoader,
  selectBackformOption,
  fillBackformInput,
  parseIntOrNull,
  normalize,
  runInApp
};
