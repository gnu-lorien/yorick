/**
 * Popup lifecycle tracer for the jQuery Mobile edit dialogs.
 *
 * Diagnostics only - nothing in the suite depends on it, and installing it does
 * not change what the application does. It exists because the popup flake in
 * `xp-history` has now been chased through four wrong explanations by reading
 * code, and every one of them was disproved by measurement afterwards. This
 * records what actually happens instead of what the source suggests should.
 *
 * What it records, in one ordered timeline with `performance.now()` stamps:
 *
 *   - jQuery Mobile popup widget events - `popupbeforeposition`,
 *     `popupafteropen`, `popupafterclose`, `popupcreate`, plus the `create`
 *     enhance event and `pagecreate`. These are jQuery-triggered custom events,
 *     not DOM events, so they are caught with jQuery's own delegation; a native
 *     `addEventListener` would never see them.
 *   - Every internal step of the widget's open/close sequence
 *     (`_open`, `_openPrerequisitesComplete`, `_close`,
 *     `_closePrerequisitesDone`, `_destroy`, `_unenhance`, `_reposition`) and
 *     every `$(...).popup("...")` call the application makes, each with a stack.
 *   - `ui-popup-hidden` / `ui-popup-active` added and removed on the container,
 *     via a MutationObserver on the class attribute. Those two classes do not
 *     change together: jQuery Mobile drops `ui-popup-hidden` one screen-fade
 *     *before* it adds `ui-popup-active` (jquery.mobile-1.4.5.js:11023 then
 *     :10969), and on the way out removes `ui-popup-active` before adding
 *     `ui-popup-hidden` (:11079 then :11056). A dialog can be on screen and
 *     being typed into while carrying neither.
 *   - Insertion and removal of any popup container or popup markup
 *     (MutationObserver, childList) - and, so the *culprit* is visible and not
 *     just the effect, a synchronous stack from three places a removal can come
 *     from: `jQuery.cleanData` (the choke point every `.html()`, `.remove()`,
 *     `.empty()` and `.detach()` passes through), the `remove` event jQuery UI's
 *     cleanData patch fires on each cleaned element - which is what destroys a
 *     popup *widget* - and the native `removeChild` / `remove` / `innerHTML`
 *     path for anything that bypasses jQuery.
 *   - Every `CharacterExperienceView.render` call, numbered, with a stack and
 *     the popup copy counts before and after, and whether that call deferred
 *     itself behind an open dialog.
 *   - Document-level `pointerdown` / `mousedown` / `click` / `submit` in the
 *     capture phase, with the target and whether it is still connected - which
 *     is how "the click never reached the handler" is confirmed or killed.
 *   - On demand, a per-animation-frame rect watch on any selector, which is
 *     what distinguishes Playwright's "element is not stable" (it is moving)
 *     from "element is not visible" (it went away).
 *
 * Usage from a spec or a probe:
 *
 *     const { installPopupTrace, collectTraceConsole } = require('./popup-trace');
 *     const lines = collectTraceConsole(page);        // ordered, streamed
 *     await installPopupTrace(page);                  // before the first goto
 *     ...
 *     await page.evaluate(() => window.__popupTrace.mark('about to submit'));
 *     const timeline = await page.evaluate(() => window.__popupTrace.dump());
 *
 * `installPopupTrace` must be called before the page navigates, because it
 * installs through `addInitScript`.
 */

const POPUP_IDS = ['popupEditEntered', 'popupEditReason', 'alterationpopupEdit'];

const DEFAULTS = {
  ids: POPUP_IDS,
  prefix: '[POPUPTRACE]',
  stackDepth: 10,
  max: 40000,
  console: true
};

/**
 * The whole tracer, as one function evaluated in the page before any app
 * script runs. It must be self-contained: Playwright serialises it, so it can
 * close over nothing but its own argument.
 */
function popupTraceInit(opts) {
  if (window.__popupTrace) return;

  var IDS = opts.ids;
  var PREFIX = opts.prefix;
  var STACK_DEPTH = opts.stackDepth;
  var MAX = opts.max;
  var TO_CONSOLE = opts.console;

  var idSel = IDS.map(function (i) { return '#' + i; }).join(',');
  var events = [];
  var seq = 0;
  var uid = 0;
  var renderCount = 0;
  var dropped = 0;

  function now() { return Math.round(performance.now() * 1000) / 1000; }

  function emit(type, data) {
    if (events.length >= MAX) { dropped++; return null; }
    var rec = { i: ++seq, t: now(), type: type };
    if (data) { for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) rec[k] = data[k]; } }
    events.push(rec);
    if (TO_CONSOLE) {
      var line;
      try { line = JSON.stringify(rec); }
      catch (e) { line = '{"i":' + rec.i + ',"t":' + rec.t + ',"type":"' + type + '","err":"unserializable"}'; }
      try { console.log(PREFIX + ' ' + line); } catch (e) { /* nothing to do */ }
    }
    return rec;
  }

  /** A stable per-element id, so two copies of `#popupEditReason` are tellable apart. */
  function tag(el) {
    if (!el || el.nodeType !== 1) return null;
    if (!el.__ptid) {
      var v = 'e' + (++uid);
      try { Object.defineProperty(el, '__ptid', { value: v, enumerable: false, configurable: true }); }
      catch (e) { el.__ptid = v; }
    }
    return el.__ptid;
  }

  function desc(el) {
    if (!el) return null;
    if (el.nodeType === 9) return 'document';
    if (el.nodeType === 11) return 'fragment';
    if (el.nodeType !== 1) return '#' + el.nodeName;
    var s = el.nodeName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var cls = '';
    try { cls = el.getAttribute('class') || ''; } catch (e) { /* svg etc */ }
    if (cls) s += '.' + cls.trim().split(/\s+/).join('.');
    return s + '{' + tag(el) + '}';
  }

  function stack(skip) {
    var s;
    try { throw new Error('trace'); } catch (e) { s = String(e.stack || ''); }
    return s.split('\n')
      .slice(skip || 2, (skip || 2) + STACK_DEPTH)
      .map(function (l) {
        return l.trim()
          .replace(/^at\s+/, '')
          .replace(/https?:\/\/[^/]+\//g, '')
          .replace(/\?bust=\d+/g, '');
      })
      .join(' | ');
  }

  /** Is this element one of the popups we care about, or a container/holder of one? */
  function ofInterest(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id && IDS.indexOf(el.id) >= 0) return true;
    try {
      if (el.classList && el.classList.contains('ui-popup-container')) return true;
      if (el.querySelector && el.querySelector(idSel)) return true;
    } catch (e) { /* detached weirdness */ }
    return false;
  }

  function isOurPopup(el) {
    return !!(el && el.nodeType === 1 && el.id && IDS.indexOf(el.id) >= 0);
  }

  function containerOf(el) {
    try { return el && el.closest ? el.closest('.ui-popup-container') : null; } catch (e) { return null; }
  }

  /** The state of one popup element: which container, which classes, on screen? */
  function popupState(el) {
    if (!el) return null;
    var c = containerOf(el);
    var st = {
      el: desc(el),
      connected: !!el.isConnected,
      container: c ? tag(c) : null,
      hidden: c ? c.classList.contains('ui-popup-hidden') : null,
      active: c ? c.classList.contains('ui-popup-active') : null,
      box: null
    };
    try { st.box = c ? (c.offsetParent !== null) : (el.offsetParent !== null); } catch (e) { /* detached */ }
    return st;
  }

  /** Copy counts, so a leak or a sweep shows up as a number rather than a guess. */
  function counts() {
    var out = {};
    try {
      for (var i = 0; i < IDS.length; i++) {
        var n = document.querySelectorAll('#' + IDS[i]).length;
        if (n) out[IDS[i]] = n;
      }
      out.containers = document.querySelectorAll('.ui-popup-container').length;
      out.hidden = document.querySelectorAll('.ui-popup-container.ui-popup-hidden').length;
      out.active = document.querySelectorAll('.ui-popup-container.ui-popup-active').length;
    } catch (e) { /* mid-teardown */ }
    return out;
  }

  // ---------------------------------------------------------------- observers

  var observer = new MutationObserver(function (records) {
    for (var r = 0; r < records.length; r++) {
      var m = records[r];
      try {
        if (m.type === 'attributes') {
          var el = m.target;
          if (!el.classList || !el.classList.contains('ui-popup-container')) continue;
          if (!el.querySelector || !el.querySelector(idSel)) continue;
          var oldCls = (m.oldValue || '').split(/\s+/);
          var newCls = (el.getAttribute('class') || '').split(/\s+/);
          var deltas = [];
          ['ui-popup-hidden', 'ui-popup-active', 'in', 'out', 'reverse', 'ui-popup-truncate'].forEach(function (c) {
            var was = oldCls.indexOf(c) >= 0, is = newCls.indexOf(c) >= 0;
            if (was !== is) deltas.push((is ? '+' : '-') + c);
          });
          if (!deltas.length) continue;
          emit('class', {
            container: tag(el),
            holds: (el.querySelector(idSel) || {}).id || null,
            delta: deltas.join(' '),
            cls: el.getAttribute('class')
          });
        } else if (m.type === 'childList') {
          var i;
          for (i = 0; i < m.removedNodes.length; i++) {
            var rn = m.removedNodes[i];
            if (!ofInterest(rn)) continue;
            emit('dom.removed', {
              node: desc(rn),
              from: desc(m.target),
              holds: (rn.querySelector && rn.querySelector(idSel) ? rn.querySelector(idSel).id : (rn.id || null)),
              counts: counts()
            });
          }
          for (i = 0; i < m.addedNodes.length; i++) {
            var an = m.addedNodes[i];
            if (!ofInterest(an)) continue;
            bindRemoveHandlers(an);
            emit('dom.added', {
              node: desc(an),
              into: desc(m.target),
              holds: (an.querySelector && an.querySelector(idSel) ? an.querySelector(idSel).id : (an.id || null)),
              counts: counts()
            });
          }
        }
      } catch (e) { /* one bad record must not stop the tracer */ }
    }
  });

  function startObserver() {
    try {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['class']
      });
      emit('observer.started', {});
    } catch (e) { emit('observer.failed', { err: String(e && e.message) }); }
  }

  if (document.documentElement) startObserver();
  else document.addEventListener('readystatechange', function once() {
    if (document.documentElement) { document.removeEventListener('readystatechange', once); startObserver(); }
  });

  // ------------------------------------------------- native removal fallbacks
  //
  // jQuery routes almost everything through cleanData (hooked below, with a
  // stack), but anything that bypasses jQuery would otherwise show up only as
  // an anonymous MutationObserver record with no culprit attached.

  try {
    var origRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
      try {
        if (ofInterest(child)) {
          emit('native.removeChild', { node: desc(child), from: desc(this), stack: stack(3) });
        }
      } catch (e) { /* keep going */ }
      return origRemoveChild.apply(this, arguments);
    };

    var origRemove = Element.prototype.remove;
    Element.prototype.remove = function () {
      try {
        if (ofInterest(this)) emit('native.remove', { node: desc(this), stack: stack(3) });
      } catch (e) { /* keep going */ }
      return origRemove.apply(this, arguments);
    };

    var innerDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (innerDesc && innerDesc.set) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        configurable: true,
        enumerable: innerDesc.enumerable,
        get: innerDesc.get,
        set: function (v) {
          try {
            if (this.querySelector && this.querySelector(idSel)) {
              emit('native.innerHTML', { on: desc(this), wipes: this.querySelectorAll(idSel).length, stack: stack(3) });
            }
          } catch (e) { /* keep going */ }
          return innerDesc.set.call(this, v);
        }
      });
    }
  } catch (e) { emit('native.hook.failed', { err: String(e && e.message) }); }

  // ------------------------------------------------------------- jQuery hooks

  var bound = (typeof WeakSet === 'function') ? new WeakSet() : null;

  /**
   * jQuery UI's cleanData patch fires a `remove` event on every element it
   * cleans, and that is what destroys a popup widget. `triggerHandler` does not
   * bubble, so this has to be bound on each element rather than delegated.
   */
  function bindRemoveHandlers(root) {
    var $ = window.jQuery;
    if (!$ || !root || root.nodeType !== 1) return;
    var els = [];
    if (isOurPopup(root) || (root.classList && root.classList.contains('ui-popup-container'))) els.push(root);
    try {
      var found = root.querySelectorAll(idSel + ', .ui-popup-container');
      for (var i = 0; i < found.length; i++) els.push(found[i]);
    } catch (e) { /* keep going */ }
    els.forEach(function (el) {
      if (bound && bound.has(el)) return;
      if (bound) bound.add(el);
      try {
        $(el).on('remove.__popuptrace', function () {
          emit('jq.remove', {
            node: desc(el),
            state: popupState(isOurPopup(el) ? el : (el.querySelector(idSel) || el)),
            stack: stack(3)
          });
        });
      } catch (e) { /* keep going */ }
    });
  }

  function hookJQuery($) {
    // Every jQuery removal path funnels through cleanData, synchronously, in
    // the caller's own stack. This is the single most useful hook here.
    try {
      var origClean = $.cleanData;
      $.cleanData = function (elems) {
        try {
          var hits = [];
          for (var i = 0; i < elems.length; i++) {
            var el = elems[i];
            if (el && el.nodeType === 1 && (isOurPopup(el) || (el.classList && el.classList.contains('ui-popup-container')))) {
              hits.push(desc(el));
            }
          }
          if (hits.length) emit('jq.cleanData', { nodes: hits.slice(0, 12), n: hits.length, stack: stack(3) });
        } catch (e) { /* keep going */ }
        return origClean.apply(this, arguments);
      };
    } catch (e) { emit('jq.cleanData.hook.failed', { err: String(e && e.message) }); }

    // Widget events. These are jQuery custom events, so they are invisible to
    // addEventListener; `.trigger` does simulate bubbling, so document-level
    // delegation catches them.
    try {
      $(document).on(
        'popupcreate popupbeforeposition popupafteropen popupafterclose popupbeforecreate create pagecreate pagechange',
        function (ev) {
          var t = ev.target;
          if (ev.type === 'create' || ev.type === 'pagecreate' || ev.type === 'pagechange') {
            // These fire everywhere; only report ones that touch our markup.
            if (!t || t.nodeType !== 1) return;
            var touches = isOurPopup(t) || (t.querySelector && t.querySelector(idSel));
            if (!touches) return;
            emit('jqm.' + ev.type, { target: desc(t), copies: counts() });
            bindRemoveHandlers(t);
            return;
          }
          if (!isOurPopup(t)) return;
          bindRemoveHandlers(t);
          emit('jqm.' + ev.type, { state: popupState(t), counts: counts() });
        }
      );
    } catch (e) { emit('jq.events.hook.failed', { err: String(e && e.message) }); }
  }

  function hookJqm($) {
    var proto = $.mobile && $.mobile.popup && $.mobile.popup.prototype;
    if (!proto) return false;

    // The widget's own sequence. `_open`/`_close` are where the classes move;
    // `_destroy`/`_unenhance` are where a container is taken away entirely.
    [
      ['open', true], ['close', true],
      ['_open', true], ['_close', true],
      ['_destroy', true], ['_unenhance', true],
      ['_openPrerequisitesComplete', false], ['_closePrerequisitesDone', false],
      ['_reposition', false]
    ].forEach(function (pair) {
      var name = pair[0], wantStack = pair[1];
      var orig = proto[name];
      if (typeof orig !== 'function' || orig.__ptWrapped) return;
      var wrapped = function () {
        var el = this.element && this.element[0];
        if (isOurPopup(el)) {
          var d = { fn: name, state: popupState(el), hash: location.hash };
          try { d.mutex = ($.mobile.popup.active === this) ? 'self' : ($.mobile.popup.active ? 'other' : 'none'); } catch (e) { /* keep going */ }
          if (wantStack) d.stack = stack(3);
          emit('widget.' + name, d);
        }
        return orig.apply(this, arguments);
      };
      wrapped.__ptWrapped = true;
      proto[name] = wrapped;
    });

    // Every `$(...).popup("open"|"close"|...)` the application makes. `$("#id")`
    // resolves through getElementById, so it takes whichever copy comes first in
    // the document - recording which one it picked is the point.
    try {
      var origFn = $.fn.popup;
      if (origFn && !origFn.__ptWrapped) {
        var wrappedFn = function () {
          try {
            if (typeof arguments[0] === 'string') {
              var picked = [];
              for (var i = 0; i < this.length; i++) {
                if (isOurPopup(this[i]) || (this[i].querySelector && this[i].querySelector(idSel))) {
                  picked.push(popupState(isOurPopup(this[i]) ? this[i] : this[i].querySelector(idSel)));
                }
              }
              if (picked.length) {
                emit('api.popup', { method: arguments[0], matched: this.length, picked: picked, stack: stack(3) });
              }
            }
          } catch (e) { /* keep going */ }
          return origFn.apply(this, arguments);
        };
        wrappedFn.__ptWrapped = true;
        for (var k in origFn) { if (Object.prototype.hasOwnProperty.call(origFn, k)) wrappedFn[k] = origFn[k]; }
        $.fn.popup = wrappedFn;
      }
    } catch (e) { emit('jqm.fn.hook.failed', { err: String(e && e.message) }); }

    // The global popup mutex. A stuck value here would block every later open.
    try {
      var activeVal = $.mobile.popup.active;
      Object.defineProperty($.mobile.popup, 'active', {
        configurable: true,
        get: function () { return activeVal; },
        set: function (v) {
          var el = v && v.element && v.element[0];
          emit('mutex', { to: v ? (el && el.id ? '#' + el.id : 'popup') : 'undefined', stack: stack(3) });
          activeVal = v;
        }
      });
    } catch (e) { emit('jqm.mutex.hook.failed', { err: String(e && e.message) }); }

    return true;
  }

  // -------------------------------------------------------------- navigation
  //
  // A jQuery Mobile popup opened with `history: true` (the default) pushes its
  // own history entry and closes itself again on the next `navigate`. So the
  // URL is part of this timeline whether the application meant it to be or not,
  // and a close with no `api.popup method=close` in front of it means the app
  // did not ask for it - navigation did.

  function hookNavigation($) {
    try {
      window.addEventListener('hashchange', function (ev) {
        emit('nav.hashchange', { from: String(ev.oldURL || '').split('#')[1] || '', to: String(ev.newURL || '').split('#')[1] || '' });
      });
      window.addEventListener('popstate', function () {
        emit('nav.popstate', { href: location.hash });
      });
    } catch (e) { /* keep going */ }

    ['pushState', 'replaceState', 'back', 'forward', 'go'].forEach(function (name) {
      try {
        var orig = history[name];
        if (typeof orig !== 'function' || orig.__ptWrapped) return;
        var wrapped = function () {
          var arg = name === 'pushState' || name === 'replaceState' ? arguments[2] : arguments[0];
          emit('nav.history.' + name, { arg: arg === undefined ? null : String(arg), hash: location.hash, stack: stack(3) });
          return orig.apply(this, arguments);
        };
        wrapped.__ptWrapped = true;
        history[name] = wrapped;
      } catch (e) { /* keep going */ }
    });

    try {
      $(document).on('navigate pagebeforechange', function (ev) {
        emit('nav.' + ev.type, { hash: location.hash });
      });
    } catch (e) { /* keep going */ }

    // `_closePopup` is the widget's own navigation handler: it is what closes an
    // open dialog when the URL moves, and it is reached without any
    // `popup("close")` call from the application.
    try {
      var proto = $.mobile.popup.prototype;
      var origClosePopup = proto._closePopup;
      if (typeof origClosePopup === 'function' && !origClosePopup.__ptWrapped) {
        var wrappedClose = function (theEvent, data) {
          var el = this.element && this.element[0];
          if (isOurPopup(el)) {
            emit('widget._closePopup', {
              ev: theEvent ? theEvent.type : null,
              to: data && data.toPage ? String(data.toPage) : null,
              hash: location.hash,
              state: popupState(el),
              stack: stack(3)
            });
          }
          return origClosePopup.apply(this, arguments);
        };
        wrappedClose.__ptWrapped = true;
        proto._closePopup = wrappedClose;
      }
    } catch (e) { /* keep going */ }

    try {
      var origChangePage = $.mobile.changePage;
      if (typeof origChangePage === 'function' && !origChangePage.__ptWrapped) {
        var wrappedChange = function (to) {
          emit('nav.changePage', { to: String(to && to.jquery ? (to.attr('id') || 'jq') : to), hash: location.hash, stack: stack(3) });
          return origChangePage.apply(this, arguments);
        };
        wrappedChange.__ptWrapped = true;
        $.mobile.changePage = wrappedChange;
      }
    } catch (e) { /* keep going */ }
  }

  // --------------------------------------------------- CharacterExperienceView

  function hookView() {
    if (typeof window.require !== 'function') return false;
    try {
      window.require(['app/views/CharacterExperienceView'], function (V) {
        if (!V || !V.prototype || V.prototype.__ptPatched) return;
        V.prototype.__ptPatched = true;
        var origRender = V.prototype.render;
        V.prototype.render = function () {
          var n = ++renderCount;
          var queuedBefore = !!this._renderQueuedBehindPopup;
          emit('render.enter', { n: n, counts: counts(), queued: queuedBefore, stack: stack(3) });
          try {
            return origRender.apply(this, arguments);
          } finally {
            emit('render.exit', {
              n: n,
              counts: counts(),
              // True when this call bailed out and re-armed itself behind an
              // open dialog rather than rebuilding the table.
              deferred: !queuedBefore && !!this._renderQueuedBehindPopup
            });
          }
        };
        var origEdit = V.prototype.edit_experience_notation;
        if (typeof origEdit === 'function') {
          V.prototype.edit_experience_notation = function (event) {
            emit('view.edit_experience_notation', {
              target: desc(event && event.target),
              header: event && event.target && event.target.getAttribute ? event.target.getAttribute('header') : null,
              connected: !!(event && event.target && event.target.isConnected),
              counts: counts()
            });
            return origEdit.apply(this, arguments);
          };
        }
        ['submit_experience_notation_reason', 'submit_experience_notation_entered', 'submit_experience_notation_alteration'].forEach(function (name) {
          var orig = V.prototype[name];
          if (typeof orig !== 'function') return;
          V.prototype[name] = function () {
            emit('view.' + name, { counts: counts() });
            return orig.apply(this, arguments);
          };
        });
        emit('view.patched', {});
      }, function (err) {
        emit('view.patch.failed', { err: String(err && err.message) });
      });
    } catch (e) { emit('view.patch.failed', { err: String(e && e.message) }); }
    return true;
  }

  // ------------------------------------------------------------- input events

  function hookInput() {
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'submit'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        try {
          var t = ev.target;
          if (!t || t.nodeType !== 1) return;
          var inPopup = t.closest && t.closest(idSel);
          var isEdit = t.closest && t.closest('.experience-notation-edit, .experience-notation-delete, button.add');
          if (!inPopup && !isEdit) return;
          emit('input.' + type, {
            target: desc(t),
            connected: !!t.isConnected,
            inPopup: inPopup ? inPopup.id : null,
            state: inPopup ? popupState(inPopup) : null,
            trusted: ev.isTrusted
          });
        } catch (e) { /* keep going */ }
      }, true);
    });
  }

  // -------------------------------------------------------------- rect watch
  //
  // Playwright's click reports "element is not stable" when the bounding box
  // moves between two animation frames, and "element is not visible" when it
  // has no box at all. Sampling the box every frame is the only way to tell
  // those two apart from the page side.

  var watchHandle = null;

  function stopRectWatch() {
    if (watchHandle !== null) { cancelAnimationFrame(watchHandle); watchHandle = null; }
  }

  function startRectWatch(selector, maxFrames) {
    stopRectWatch();
    var last = '';
    var frames = 0;
    var limit = maxFrames || 3000;
    emit('rect.watch.start', { selector: selector });
    var step = function () {
      frames++;
      var sample;
      try {
        var els = document.querySelectorAll(selector);
        var el = els.length ? els[els.length - 1] : null;
        if (!el) {
          sample = { n: els.length, box: null };
        } else {
          var r = el.getBoundingClientRect();
          sample = {
            n: els.length,
            id: tag(el),
            box: [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
            visible: !!(r.width && r.height && el.offsetParent !== null),
            connected: !!el.isConnected
          };
        }
      } catch (e) { sample = { err: String(e && e.message) }; }
      var key = JSON.stringify(sample);
      if (key !== last || frames % 120 === 0) {
        emit('rect', { f: frames, s: sample, repeat: key === last });
        last = key;
      }
      if (frames < limit && watchHandle !== null) watchHandle = requestAnimationFrame(step);
      else { watchHandle = null; emit('rect.watch.stop', { frames: frames }); }
    };
    watchHandle = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------- wiring

  var ready = false;
  var tries = 0;
  var poll = setInterval(function () {
    tries++;
    var $ = window.jQuery;
    if (!ready && $ && $.mobile && $.mobile.popup && $.mobile.popup.prototype) {
      ready = true;
      hookJQuery($);
      hookJqm($);
      hookNavigation($);
      bindRemoveHandlers(document.documentElement);
      emit('hooks.installed', { afterMs: now(), tries: tries });
    }
    if (ready && typeof window.require === 'function' && !window.__popupTraceViewHooked) {
      window.__popupTraceViewHooked = true;
      hookView();
    }
    if (ready && window.__popupTraceViewHooked) clearInterval(poll);
    if (tries > 3000) clearInterval(poll);
  }, 10);

  if (document.addEventListener) hookInput();

  window.__popupTrace = {
    dump: function () { return events; },
    since: function (i) { return events.filter(function (e) { return e.i > i; }); },
    last: function () { return events.length ? events[events.length - 1].i : 0; },
    clear: function () { events.length = 0; seq = 0; dropped = 0; return true; },
    dropped: function () { return dropped; },
    mark: function (label, data) { return emit('MARK', { label: label, data: data === undefined ? null : data, counts: counts() }); },
    counts: counts,
    snapshot: function () {
      var out = { counts: counts(), popups: [], jqmActive: null, activePage: null };
      try {
        var all = document.querySelectorAll(idSel);
        for (var i = 0; i < all.length; i++) out.popups.push(popupState(all[i]));
        var $ = window.jQuery;
        out.jqmActive = !!($ && $.mobile && $.mobile.popup && $.mobile.popup.active);
        out.activePage = (document.querySelector('.ui-page-active') || {}).id || null;
      } catch (e) { out.err = String(e && e.message); }
      return out;
    },
    startRectWatch: startRectWatch,
    stopRectWatch: stopRectWatch,
    renderCount: function () { return renderCount; }
  };

  emit('trace.installed', { url: String(location.href) });
}

/**
 * Install the tracer on a page. Must be called before the page navigates.
 */
async function installPopupTrace(page, options = {}) {
  const opts = Object.assign({}, DEFAULTS, options);
  await page.addInitScript(popupTraceInit, opts);
  return opts;
}

/**
 * Collect the traced console lines in order. Returns the array it fills, plus
 * a `raw` array of the parsed records.
 */
function collectTraceConsole(page, options = {}) {
  const prefix = options.prefix || DEFAULTS.prefix;
  const out = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.indexOf(prefix) !== 0) return;
    const body = text.slice(prefix.length).trim();
    try { out.push(JSON.parse(body)); } catch (e) { out.push({ type: 'UNPARSED', raw: body }); }
  });
  return out;
}

/** Render a timeline as aligned text, for eyeballing and for diffing two runs. */
function formatTimeline(records, options = {}) {
  const t0 = options.t0 !== undefined ? options.t0 : (records.length ? records[0].t : 0);
  const width = options.stackWidth === undefined ? 220 : options.stackWidth;
  return records.map((r) => {
    const rel = (r.t - t0).toFixed(1).padStart(9);
    const head = `${String(r.i).padStart(5)} ${rel}ms  ${r.type}`;
    const rest = Object.keys(r)
      .filter((k) => ['i', 't', 'type'].indexOf(k) < 0)
      .map((k) => {
        let v = r[k];
        if (k === 'stack' && width > 0) v = String(v).slice(0, width);
        return `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`;
      })
      .join('  ');
    return rest ? `${head}  ${rest}` : head;
  }).join('\n');
}

module.exports = {
  POPUP_IDS,
  DEFAULTS,
  popupTraceInit,
  installPopupTrace,
  collectTraceConsole,
  formatTimeline
};
