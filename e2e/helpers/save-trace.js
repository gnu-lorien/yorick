/**
 * TEMPORARY instrumentation for the "save-inflight re-entrancy" investigation.
 *
 * Complements `popup-trace.js`, which records the popup/nav/render timeline but
 * knows nothing about network traffic or Character's propagation events. This
 * one answers exactly one question:
 *
 *   at the instant an edit popup opens, is a previous edit's save (or the
 *   propagation it kicks off) still in flight?
 *
 * It records:
 *   - every XMLHttpRequest / fetch start and end, with the in-flight count
 *   - `begin_/finish_experience_notation_propagation` triggered on any Parse
 *     object (wrapped on `Parse.Object.prototype.trigger`)
 *   - jQuery Mobile's transition state (`isPageTransitioning`,
 *     `pageTransitionQueue.length`) alongside every record, because the other
 *     candidate mechanism lives there and the two must be told apart
 *
 * and exposes `window.__saveTrace.quiescence()` so a test can *wait* for the
 * overlap to be gone - which is the ablation the investigation turns on.
 *
 * Delete with the investigation.
 */

const fs = require('fs');
const path = require('path');

function saveTraceInit() {
  if (window.__saveTrace) return;

  var events = [];
  var seq = 0;
  var inflight = 0;
  var inflightDetail = {};
  var propBegin = 0;
  var propFinish = 0;
  var MAX = 20000;

  function now() { return Math.round(performance.now() * 1000) / 1000; }

  // jQuery Mobile keeps `isPageTransitioning` and `pageTransitionQueue` as
  // closure locals (jquery.mobile-1.4.5.js:5801-5804), not on `$.mobile`, so
  // they cannot be read from outside. Count instead: every `changePage` call
  // that has not yet produced a `pagebeforechange` is either running or sitting
  // in the queue.
  var changePageCalls = 0;
  var pageBeforeChanges = 0;

  function navState() {
    return { pendingNav: changePageCalls - pageBeforeChanges, calls: changePageCalls };
  }

  function popupState() {
    return {
      active: document.querySelectorAll('.ui-popup-container.ui-popup-active').length,
      onscreen: document.querySelectorAll('.ui-popup-container:not(.ui-popup-hidden)').length
    };
  }

  function emit(type, data) {
    if (events.length >= MAX) return null;
    var nav = navState();
    var rec = {
      i: ++seq,
      t: now(),
      type: type,
      inflight: inflight,
      pending: propBegin - propFinish,
      pendingNav: nav.pendingNav,
      popups: popupState(),
      data: data || null
    };
    events.push(rec);
    if (window.__saveTraceEcho) {
      try { console.log('[SAVETRACE] ' + JSON.stringify(rec)); } catch (e) { /* ignore */ }
    }
    return rec;
  }

  function shortUrl(u) {
    try {
      var s = String(u);
      return s.replace(/^https?:\/\/[^/]+/, '');
    } catch (e) { return String(u); }
  }

  function summariseBody(body) {
    if (!body || typeof body !== 'string') return null;
    try {
      var o = JSON.parse(body);
      if (o && o.requests && o.requests.length) {
        return 'batch[' + o.requests.length + '] ' + o.requests.map(function (r) {
          return r.method + ' ' + shortUrl(r.path);
        }).join(', ');
      }
      var keys = Object.keys(o).filter(function (k) { return k.charAt(0) !== '_'; });
      return keys.slice(0, 12).join(',');
    } catch (e) { return null; }
  }

  // --- XHR ---------------------------------------------------------------
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype && !XHR.prototype.__saveTraced) {
    var origOpen = XHR.prototype.open;
    var origSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__st = { method: method, url: shortUrl(url) };
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      var self = this;
      var meta = self.__st || (self.__st = {});
      meta.id = 'x' + (++seq);
      meta.body = summariseBody(body);
      inflight++;
      inflightDetail[meta.id] = meta;
      emit('net.start', { id: meta.id, method: meta.method, url: meta.url, body: meta.body });
      var done = false;
      var finish = function (how) {
        if (done) return;
        done = true;
        inflight--;
        delete inflightDetail[meta.id];
        emit('net.end', { id: meta.id, method: meta.method, url: meta.url, how: how, status: self.status });
      };
      self.addEventListener('loadend', function () { finish('loadend'); });
      return origSend.apply(self, arguments);
    };
    XHR.prototype.__saveTraced = true;
  }

  // --- fetch -------------------------------------------------------------
  if (window.fetch && !window.fetch.__saveTraced) {
    var origFetch = window.fetch;
    var wrappedFetch = function (input, init) {
      var id = 'f' + (++seq);
      var method = (init && init.method) || 'GET';
      var url = shortUrl(typeof input === 'string' ? input : (input && input.url) || '');
      inflight++;
      inflightDetail[id] = { id: id, method: method, url: url };
      emit('net.start', { id: id, method: method, url: url, via: 'fetch' });
      var settle = function (how) {
        inflight--;
        delete inflightDetail[id];
        emit('net.end', { id: id, method: method, url: url, how: how, via: 'fetch' });
      };
      return origFetch.apply(this, arguments).then(function (r) {
        settle('ok'); return r;
      }, function (e) {
        settle('err'); throw e;
      });
    };
    wrappedFetch.__saveTraced = true;
    window.fetch = wrappedFetch;
  }

  // --- Parse triggers ----------------------------------------------------
  var INTERESTING = {
    begin_experience_notation_propagation: 1,
    finish_experience_notation_propagation: 1
  };

  var hookState = { parse: false, jqm: false };

  function hookParse() {
    var P = window.Parse;
    if (!P || !P.Object || !P.Object.prototype) return false;
    if (P.Object.prototype.__saveTraced) return true;
    // Wait for the compat layer to copy Backbone.Events onto the prototype
    // (public/scripts/lib/parse-compat/events.js `applyTo`). Wrapping before
    // that both misses every trigger and makes `applyTo` skip its own install,
    // because it only fills in members that are not already functions.
    if (typeof P.Object.prototype.trigger !== 'function') return false;
    var protos = [P.Object.prototype];
    if (P.Collection && P.Collection.prototype) protos.push(P.Collection.prototype);
    protos.forEach(function (proto) {
      var orig = proto.trigger;
      if (typeof orig !== 'function') return;
      proto.trigger = function (name) {
        if (typeof name === 'string') {
          var first = name.split(' ')[0];
          if (INTERESTING[first]) {
            if (first === 'begin_experience_notation_propagation') propBegin++;
            else propFinish++;
            emit('prop.' + (first === 'begin_experience_notation_propagation' ? 'begin' : 'finish'), {
              name: first,
              begins: propBegin,
              finishes: propFinish
            });
          }
        }
        return orig.apply(this, arguments);
      };
    });
    P.Object.prototype.__saveTraced = true;
    hookState.parse = true;
    return true;
  }

  function hookJqm() {
    var $ = window.jQuery;
    if (!$ || !$.mobile || !$.mobile.changePage) return false;
    if ($.mobile.changePage.__saveTraced) return true;
    var orig = $.mobile.changePage;
    var wrapped = function (to) {
      changePageCalls++;
      emit('nav.changePage', { to: (typeof to === 'string' ? to : '(object)') });
      return orig.apply(this, arguments);
    };
    wrapped.__saveTraced = true;
    $.mobile.changePage = wrapped;
    $(document).on('pagebeforechange.__savetrace', function () {
      pageBeforeChanges++;
      emit('nav.pagebeforechange', null);
    });
    $(document).on('pagechange.__savetrace', function () {
      emit('nav.pagechange', null);
    });
    hookState.jqm = true;
    return true;
  }

  var poll = setInterval(function () {
    var a = hookParse();
    var b = hookJqm();
    if (a && b) clearInterval(poll);
  }, 15);
  hookParse();
  hookJqm();

  window.__saveTraceEcho = true;

  window.__saveTrace = {
    dump: function () { return events; },
    clear: function () { events.length = 0; return true; },
    mark: function (label, data) { return emit('MARK', { label: label, data: data === undefined ? null : data }); },
    inflight: function () { return inflight; },
    inflightDetail: function () {
      return Object.keys(inflightDetail).map(function (k) { return inflightDetail[k]; });
    },
    pending: function () { return propBegin - propFinish; },
    counts: function () { return { begins: propBegin, finishes: propFinish }; },
    nav: navState,
    /**
     * Everything a caller might want to wait on, in one read.
     * `net` is true when nothing is in flight and no propagation is pending;
     * `nav` is true when jQuery Mobile has no transition running or queued.
     */
    quiescence: function () {
      var n = navState();
      return {
        inflight: inflight,
        pending: propBegin - propFinish,
        pendingNav: n.pendingNav,
        net: inflight === 0 && (propBegin - propFinish) === 0,
        navQuiet: n.pendingNav <= 0
      };
    },
    hooks: function () { return { parse: hookState.parse, jqm: hookState.jqm, begins: propBegin, finishes: propFinish }; },
    echo: function (on) { window.__saveTraceEcho = !!on; return window.__saveTraceEcho; }
  };
}

/** Install before the first navigation. */
async function installSaveTrace(page, options = {}) {
  const outFile = options.out || null;
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, '');
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.indexOf('[SAVETRACE] ') !== 0) return;
      try { fs.appendFileSync(outFile, text.slice('[SAVETRACE] '.length) + '\n'); } catch (e) { /* ignore */ }
    });
  }
  await page.addInitScript(saveTraceInit);
}

module.exports = { installSaveTrace, saveTraceInit };
