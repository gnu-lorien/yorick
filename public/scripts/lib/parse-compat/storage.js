/**
 * Storage and Installation controllers for the parse@8 browser bundle.
 *
 * `dist/parse.js` from parse@8.6.0 registers exactly one controller --
 * `CoreManager.setRESTController(RESTController)` is the only such call in the
 * whole 1.7MB file. `setStorageController` and `setInstallationController` are
 * defined but never invoked, so `CoreManager.getStorageController()` and
 * `getInstallationController()` both return `undefined`.
 *
 * The first thing that trips over is login. `Parse.User.logIn` asks the
 * installation controller for `currentInstallationId()`, and the failure
 * surfaces as `Cannot read properties of undefined (reading
 * 'currentInstallationId')` -- which reads like a bug in the calling code and
 * is nothing of the sort.
 *
 * Verified as an upstream packaging problem, not something this app or the rest
 * of the compat layer caused: loading `dist/parse.js` through a plain `<script>`
 * tag on an otherwise empty page, with no RequireJS and no compat layer,
 * reproduces it exactly.
 *
 * So these are supplied here. Both follow the shapes `CoreManager`'s own
 * `requireMethods` checks demand:
 *
 *   StorageController      async: 0, getItem, setItem, removeItem, getAllKeys, clear
 *   InstallationController currentInstallationId, currentInstallation,
 *                          updateInstallationOnDisk
 *
 * If a later parse release starts registering its own, `install()` leaves these
 * alone -- they are only fitted when the slot is empty.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ParseCompatStorage = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Where the installation id lives, matching the SDK's own key. */
  var INSTALLATION_KEY = 'Parse/installationId';

  /**
   * Synchronous localStorage-backed storage.
   *
   * `async: 0` tells the SDK the synchronous methods are the real ones, which
   * is what the browser has always used. An in-memory fallback covers private
   * browsing modes where localStorage throws on write.
   */
  function makeStorageController() {
    var memory = {};
    var haveLocalStorage = (function () {
      try {
        var k = '__parse_compat_probe__';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        return true;
      } catch (err) {
        return false;
      }
    }());

    if (!haveLocalStorage) {
      return {
        async: 0,
        getItem: function (path) {
          return Object.prototype.hasOwnProperty.call(memory, path) ? memory[path] : null;
        },
        setItem: function (path, value) { memory[path] = String(value); },
        removeItem: function (path) { delete memory[path]; },
        getAllKeys: function () { return Object.keys(memory); },
        clear: function () { memory = {}; }
      };
    }

    return {
      async: 0,
      getItem: function (path) { return window.localStorage.getItem(path); },
      setItem: function (path, value) { window.localStorage.setItem(path, value); },
      removeItem: function (path) { window.localStorage.removeItem(path); },
      getAllKeys: function () {
        var keys = [];
        for (var i = 0; i < window.localStorage.length; i++) {
          keys.push(window.localStorage.key(i));
        }
        return keys;
      },
      clear: function () { window.localStorage.clear(); }
    };
  }

  /** RFC4122-ish v4 id. Only needs to be stable per browser, not unguessable. */
  function newInstallationId() {
    var hex = '0123456789abcdef';
    var out = '';
    for (var i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        out += '-';
      } else if (i === 14) {
        out += '4';
      } else {
        out += hex[Math.floor(Math.random() * 16)];
      }
    }
    return out;
  }

  /**
   * Minimal installation controller.
   *
   * This app has no push notifications and never reads Parse.Installation, so
   * the only member that has to genuinely work is `currentInstallationId`. The
   * other two exist because `CoreManager.setInstallationController` refuses a
   * controller missing them, and are honest no-ops rather than pretending to
   * persist an Installation object nothing here creates.
   */
  function makeInstallationController(storage) {
    var cached = null;
    return {
      currentInstallationId: function () {
        if (cached) return Promise.resolve(cached);
        var stored = storage.getItem(INSTALLATION_KEY);
        if (!stored) {
          stored = newInstallationId();
          storage.setItem(INSTALLATION_KEY, stored);
        }
        cached = stored;
        return Promise.resolve(cached);
      },
      currentInstallation: function () {
        return Promise.resolve(null);
      },
      updateInstallationOnDisk: function () {
        return Promise.resolve();
      }
    };
  }

  /** Fit both controllers onto a CoreManager, only where the slot is empty. */
  function applyTo(CoreManager) {
    if (!CoreManager) return CoreManager;

    var storage;
    try {
      storage = CoreManager.getStorageController();
    } catch (err) {
      storage = undefined;
    }
    if (!storage) {
      storage = makeStorageController();
      CoreManager.setStorageController(storage);
    }

    var installation;
    try {
      installation = CoreManager.getInstallationController();
    } catch (err) {
      installation = undefined;
    }
    if (!installation) {
      CoreManager.setInstallationController(makeInstallationController(storage));
    }

    return CoreManager;
  }

  applyTo.applyTo = applyTo;
  applyTo.makeStorageController = makeStorageController;
  applyTo.makeInstallationController = makeInstallationController;
  return applyTo;
}));
