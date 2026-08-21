/**
 * Parse.Router and Parse.history, mapped onto Backbone's.
 *
 * The smallest of the five shims and the one that was very nearly missed. The
 * first coupling inventory for this migration grepped for `Parse.History` --
 * the class -- found zero, and scored routing as "not affected". The live
 * symbol is `Parse.history`, the lowercase singleton:
 *
 *   routers/mobileRouter.js:98   Parse.Router.extend({ ... })
 *   routers/mobileRouter.js:135  Parse.history.start()
 *   views/LoginView.js:35        Parse.history.loadUrl()
 *
 * None of the three exist in parse@8. `mobileRouter.js` is the largest file in
 * the application at 2210 lines, so scoring it as unaffected would have been an
 * expensive mistake. Build coupling inventories from the target SDK's actual
 * exports, not from a list of symbol names.
 *
 * Parse 1.5's Router and History were copies of Backbone's with the same
 * method signatures (`route(route, name, callback)`, `navigate(fragment,
 * options)`, `history.start(options)`, `history.loadUrl(fragment)`), so this
 * maps rather than reimplements. The one real difference is lifecycle: Parse
 * created `Parse.history` lazily on first `route()` registration, while
 * `Backbone.history` is a singleton that exists as soon as Backbone loads.
 * Assigning it eagerly is equivalent from every caller's point of view, and
 * `start()` remains what actually begins listening.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['backbone'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      (typeof global !== 'undefined' && global.Backbone) || require('../backbone.js')
    );
  } else {
    root.ParseCompatRouter = factory(root.Backbone);
  }
}(typeof self !== 'undefined' ? self : this, function (Backbone) {
  'use strict';

  /**
   * Attach Router, History and the `history` singleton to a Parse namespace.
   *
   * Only fills in what is absent, so if a future SDK ships its own routing
   * this stops shadowing it rather than silently winning.
   */
  function applyTo(Parse) {
    if (!Parse) return Parse;

    if (!Parse.Router) {
      Parse.Router = Backbone.Router;
    }
    if (!Parse.History) {
      Parse.History = Backbone.History;
    }
    if (!Parse.history) {
      Parse.history = Backbone.history;
    }

    return Parse;
  }

  applyTo.applyTo = applyTo;
  return applyTo;
}));
