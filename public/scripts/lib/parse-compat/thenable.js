/**
 * Make the SDK's own methods return Parse.Promise-compatible thenables.
 *
 * This is the piece that makes the other shims actually reach the code that
 * needs them, and it is easy to miss. `promise.js` supplies `Parse.Promise` for
 * code that CONSTRUCTS promises -- `Parse.Promise.as`, `when`, `new
 * Parse.Promise` -- but almost none of the 456 affected call sites do that.
 * They chain off something the SDK returned:
 *
 *     q.first().then(...).always(...)
 *     character.save().then(...).fail(...)
 *     Parse.Cloud.run(...).then(...).always(...)
 *
 * In parse@8 those return NATIVE promises, whose `.then()` returns another
 * native promise, so `.always` and `.fail` are simply absent. The failure is
 * `q.first(...).then(...).always is not a function`, thrown from module load
 * inside a RequireJS callback, which takes the whole view down.
 *
 * Wrapping the methods at the boundary converts each returned promise once, and
 * every continuation off it is a CompatPromise from then on, because
 * `CompatPromise.then` returns its own kind.
 *
 * The list below is deliberately explicit rather than "wrap anything returning
 * a thenable". Enumerating it means an SDK upgrade that adds a promise-returning
 * method shows up as a missing `.always` in a test rather than as this file
 * silently reaching into internals it was never meant to touch.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./promise'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./promise'));
  } else {
    root.ParseCompatThenable = factory(root.ParseCompatPromise);
  }
}(typeof self !== 'undefined' ? self : this, function (CompatPromise) {
  'use strict';

  /** Methods that return a promise, by owner. */
  var INSTANCE_METHODS = {
    Query: ['find', 'first', 'get', 'count', 'each', 'distinct', 'aggregate', 'subscribe'],
    Object: ['save', 'fetch', 'destroy', 'fetchWithInclude'],
    User: ['save', 'fetch', 'destroy', 'signUp', 'logIn'],
    File: ['save'],
    Relation: ['query'],
    Config: ['save'],
    Schema: ['save', 'get', 'update', 'delete', 'purge']
  };

  var STATIC_METHODS = {
    Object: ['saveAll', 'destroyAll', 'fetchAll', 'fetchAllIfNeeded',
             'fetchAllWithInclude', 'fetchAllIfNeededWithInclude'],
    User: ['logIn', 'logOut', 'signUp', 'become', 'requestPasswordReset',
           'currentAsync', 'requestEmailVerification', 'verifyPassword',
           'logInWith', 'hydrate', 'me'],
    Cloud: ['run', 'startJob', 'getJobStatus', 'getJobsData'],
    Config: ['get', 'save'],
    Session: ['current'],
    Analytics: ['track'],
    Push: ['send']
  };

  function wrap(owner, name) {
    if (!owner) return;
    var original = owner[name];
    if (typeof original !== 'function' || original.__compatWrapped) return;

    var wrapped = function () {
      var result = original.apply(this, arguments);
      // Only convert thenables. Several of these (Query.each with a callback,
      // Analytics.track) can return other things depending on arguments, and a
      // non-promise must pass through untouched.
      if (result && typeof result.then === 'function' && typeof result.always !== 'function') {
        return CompatPromise.from(result);
      }
      return result;
    };
    wrapped.__compatWrapped = true;
    // Keep anything hung off the original, e.g. Cloud.run's own properties.
    for (var k in original) {
      if (Object.prototype.hasOwnProperty.call(original, k)) wrapped[k] = original[k];
    }

    // Plain assignment is not enough. Several of these are accessor
    // properties -- Parse.Cloud.run is getter-only -- and assigning to one
    // throws "Cannot set property run of #<Object> which has only a getter",
    // which happens during install and takes the entire bootstrap with it.
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, name);
    } catch (err) {
      descriptor = null;
    }

    try {
      if (descriptor && (descriptor.get || descriptor.set)) {
        if (!descriptor.configurable) return;
        Object.defineProperty(owner, name, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: function () { return wrapped; },
          set: descriptor.set
        });
        return;
      }
      if (descriptor && descriptor.writable === false) {
        if (!descriptor.configurable) return;
        Object.defineProperty(owner, name, {
          configurable: true,
          enumerable: descriptor.enumerable,
          writable: true,
          value: wrapped
        });
        return;
      }
      owner[name] = wrapped;
    } catch (err) {
      // A property that refuses redefinition stays unwrapped rather than
      // aborting the whole install. Its callers keep native promises, which
      // fails loudly at the call site instead of silently here.
    }
  }

  /**
   * Wrap everything listed above on a Parse namespace.
   *
   * Idempotent per method via the `__compatWrapped` marker, so a double install
   * cannot double-convert (which would be harmless but wasteful) or re-enter.
   */
  function applyTo(Parse) {
    if (!Parse) return Parse;

    Object.keys(INSTANCE_METHODS).forEach(function (className) {
      var ctor = Parse[className];
      if (!ctor || !ctor.prototype) return;
      INSTANCE_METHODS[className].forEach(function (m) { wrap(ctor.prototype, m); });
    });

    Object.keys(STATIC_METHODS).forEach(function (className) {
      var target = Parse[className];
      if (!target) return;

      STATIC_METHODS[className].forEach(function (m) { wrap(target, m); });

      // Some members refuse redefinition. Parse.Cloud.run is a getter with
      // configurable:false, so `wrap` correctly declines it -- and call sites
      // here chain off Parse.Cloud.run(...), which would still be a native
      // promise with no .fail/.always.
      //
      // The container is replaceable even when the member is not: Parse.Cloud
      // is an ordinary configurable data property. Shadow the stubborn members
      // on a delegating object whose PROTOTYPE is the original, so everything
      // not listed here still resolves to the real implementation and no
      // property descriptor has to be copied. Copying descriptors was tried
      // first and broke bootstrap -- the SDK's namespaces carry accessors that
      // do not survive being transplanted.
      var stubborn = STATIC_METHODS[className].filter(function (m) {
        return typeof target[m] === 'function' && !target[m].__compatWrapped;
      });
      if (stubborn.length === 0) return;

      var ownerDescriptor = Object.getOwnPropertyDescriptor(Parse, className);
      if (!ownerDescriptor || !ownerDescriptor.configurable || ownerDescriptor.get) return;

      var delegate = Object.create(target);
      stubborn.forEach(function (m) {
        var original = target[m];
        var wrapped = function () {
          var result = original.apply(target, arguments);
          if (result && typeof result.then === 'function' && typeof result.always !== 'function') {
            return CompatPromise.from(result);
          }
          return result;
        };
        wrapped.__compatWrapped = true;
        // defineProperty, not assignment: the prototype's `run` is a
        // getter with no setter, and a plain assignment walks the chain,
        // finds it, and throws "Cannot set property run of #<Object> which
        // has only a getter".
        Object.defineProperty(delegate, m, {
          configurable: true, enumerable: true, writable: true, value: wrapped
        });
      });

      try {
        Parse[className] = delegate;
      } catch (err) { /* keep the original if the swap is refused */ }
    });

    return Parse;
  }

  applyTo.applyTo = applyTo;
  applyTo.INSTANCE_METHODS = INSTANCE_METHODS;
  applyTo.STATIC_METHODS = STATIC_METHODS;
  return applyTo;
}));
