'use strict';

/**
 * Fan one Playwright call out to N equivalent pages.
 *
 * The point of this file is that a session recorded by `playwright codegen`
 * against one browser can be replayed against three without editing a line of
 * it. Codegen emits a flat list of `await page.<something>(...)` calls, so if
 * `page` is a proxy that mirrors every call across three real pages, the
 * recording runs unmodified.
 *
 * Two things make that more than a one-liner:
 *
 *  - Locator chains. `page.getByRole('button').click()` is two calls, and the
 *    first returns a Locator rather than a promise. So the proxy is recursive:
 *    a call whose results are not thenable produces a new proxy wrapping those
 *    results, and only a call that returns promises is awaited.
 *
 *  - Per-target failure. `Promise.all` tells you the click failed; it does not
 *    tell you it failed on Vue and succeeded on the other two, which is the
 *    single most useful thing this harness can report. `allSettled` plus
 *    `MirrorActionError` keeps that attribution.
 */

/** Playwright calls that return a promise but do not change what is on screen. */
const NO_CAPTURE = new Set([
  'waitForTimeout', 'waitForLoadState', 'waitForFunction', 'waitForSelector',
  'waitForURL', 'waitForEvent', 'textContent', 'innerText', 'innerHTML',
  'inputValue', 'count', 'isVisible', 'isHidden', 'isEnabled', 'isDisabled',
  'isChecked', 'isEditable', 'getAttribute', 'allTextContents', 'allInnerTexts',
  'boundingBox', 'screenshot', 'title', 'content', 'evaluateHandle'
]);

class MirrorActionError extends Error {
  constructor(label, outcomes) {
    const failed = outcomes.filter((o) => !o.ok);
    super(
      `mirror: "${label}" failed on ${failed.length} of ${outcomes.length} target(s): ` +
      failed.map((o) => `${o.name} (${o.error})`).join('; ')
    );
    this.name = 'MirrorActionError';
    this.label = label;
    this.outcomes = outcomes;
  }
}

function isThenable(value) {
  return value != null && typeof value.then === 'function';
}

/** Render call arguments into something readable in a step label. */
function formatArgs(args) {
  return args
    .map((arg) => {
      if (typeof arg === 'function') return 'fn';
      if (typeof arg === 'string') return JSON.stringify(arg);
      try {
        const text = JSON.stringify(arg);
        return text === undefined ? String(arg) : text;
      } catch (err) {
        return String(arg);
      }
    })
    .join(', ');
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @param {object[]} targets  the N real objects (pages, then locators, ...)
 * @param {object}   opts
 * @param {string[]} opts.names        target names, positionally aligned
 * @param {function} opts.onAction     async (label, path) => void, after each action
 * @param {string[]} path              call path accumulated so far, for labels
 */
function fanout(targets, opts = {}, path = []) {
  const names = opts.names || targets.map((_, i) => `target-${i}`);

  return new Proxy(function () {}, {
    get(_target, prop) {
      // `await proxy` probes for `.then`. Every trap here returns a callable
      // proxy, which is truthy, so without this guard the runtime would treat
      // a plain locator as a thenable and hang.
      if (prop === 'then' && !isThenable(targets[0])) return undefined;
      if (typeof prop === 'symbol') return undefined;
      if (prop === '__mirrorTargets') return targets;

      const next = targets.map((t) => {
        const value = t == null ? undefined : t[prop];
        return typeof value === 'function' ? value.bind(t) : value;
      });
      return fanout(next, opts, path.concat(String(prop)));
    },

    apply(_target, _thisArg, args) {
      const method = path[path.length - 1] || '<call>';
      const label = truncate(
        `${path.slice(0, -1).concat(`${method}(${formatArgs(args)})`).join('.')}`,
        160
      );

      const settled = targets.map((fn, i) => {
        if (typeof fn !== 'function') {
          return Promise.reject(
            new TypeError(`"${path.join('.')}" is not a function on ${names[i]}`)
          );
        }
        try {
          return fn(...args);
        } catch (err) {
          return Promise.reject(err);
        }
      });

      if (!settled.some(isThenable)) {
        // A synchronous step in a chain, e.g. `page.getByRole(...)`. Fold the
        // arguments into the path so the eventual action label reads like the
        // source line that produced it.
        return fanout(settled, opts, path.slice(0, -1).concat(`${method}(${formatArgs(args)})`));
      }

      return Promise.allSettled(settled).then(async (results) => {
        const outcomes = results.map((r, i) => ({
          name: names[i],
          ok: r.status === 'fulfilled',
          error: r.status === 'rejected' ? String(r.reason && r.reason.message || r.reason).split('\n')[0] : null
        }));

        if (outcomes.some((o) => !o.ok)) {
          throw new MirrorActionError(label, outcomes);
        }
        if (opts.onAction && !NO_CAPTURE.has(method)) {
          await opts.onAction(label, method);
        }
        return results.map((r) => r.value);
      });
    }
  });
}

module.exports = { fanout, MirrorActionError, NO_CAPTURE };
