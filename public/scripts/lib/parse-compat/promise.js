/**
 * Parse.Promise, reimplemented on top of native promises.
 *
 * The Parse JS SDK dropped `Parse.Promise` at 2.0 in favour of native
 * promises. This codebase has ~456 call sites that depend on it: 177
 * `Parse.Promise.as`, 27 `when`, 15 `error`, 2 `new Parse.Promise`, plus 308
 * `.fail(`, 77 `.always(` and 71 `.done(`. Rewriting those by hand is the
 * expensive path; restoring the interface they were written against is ~200
 * lines and is verifiable against the original implementation, which is still
 * sitting in `public/scripts/lib/parse-1.5.0.js` to compare with.
 *
 * Three behaviours here are NOT what a naive `Promise.all` / `.catch` mapping
 * would give you, and each one fails silently rather than loudly:
 *
 *   1. `when` resolves with SEPARATE ARGUMENTS, not an array. The original does
 *      `promise.resolve.apply(promise, results)`. One live caller reads
 *      `.then(function (troupe, user) {...})`; under `Promise.all` that would
 *      bind `troupe` to the whole array and leave `user` undefined, with no
 *      error anywhere.
 *   2. `when` waits for EVERY promise to settle even after one rejects, then
 *      rejects with an ARRAY of errors indexed to match the inputs.
 *      `Promise.all` rejects as soon as the first one does, with a single
 *      error.
 *   3. `when` accepts either an array or varargs, and decides which by asking
 *      whether the first argument has a `length` property. `when(promises)`
 *      with an array and `when(a, b)` with two promises are both in use here.
 *
 * Multi-value resolution is why this cannot simply BE a native promise: those
 * carry exactly one value. This is a thenable that interoperates with them in
 * both directions, so code returning a real `parse@8.x` promise into one of
 * these chains works, and vice versa.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ParseCompatPromise = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PENDING = 0;
  var FULFILLED = 1;
  var REJECTED = 2;

  function isThenable(value) {
    return !!value && (typeof value === 'object' || typeof value === 'function') &&
      typeof value.then === 'function';
  }

  /** Defer to a microtask, matching native promise ordering. */
  var defer = (typeof Promise === 'function')
    ? function (fn) { Promise.resolve().then(fn); }
    : function (fn) { setTimeout(fn, 0); };

  function CompatPromise() {
    this._state = PENDING;
    this._values = [];
    this._error = undefined;
    this._callbacks = [];
  }

  CompatPromise.prototype._settle = function (state, values, error) {
    if (this._state !== PENDING) return;
    this._state = state;
    this._values = values || [];
    this._error = error;
    var callbacks = this._callbacks;
    this._callbacks = [];
    var self = this;
    if (callbacks.length) {
      defer(function () {
        for (var i = 0; i < callbacks.length; i++) callbacks[i](self);
      });
    }
  };

  /** Resolve with any number of values. */
  CompatPromise.prototype.resolve = function () {
    var values = Array.prototype.slice.call(arguments);
    // Adopt a thenable resolution value, as the original did.
    if (values.length === 1 && isThenable(values[0])) {
      var inner = values[0];
      var self = this;
      inner.then(function () {
        self._settle(FULFILLED, Array.prototype.slice.call(arguments));
      }, function (err) {
        self._settle(REJECTED, [], err);
      });
      return this;
    }
    this._settle(FULFILLED, values);
    return this;
  };

  CompatPromise.prototype.reject = function (error) {
    this._settle(REJECTED, [], error);
    return this;
  };

  CompatPromise.prototype._whenSettled = function (fn) {
    if (this._state === PENDING) {
      this._callbacks.push(fn);
    } else {
      var self = this;
      defer(function () { fn(self); });
    }
  };

  /**
   * `then`, preserving multi-value resolution into the success handler.
   *
   * A handler's return value becomes the next promise's single value, which
   * matches both the original and native semantics; only the values coming
   * *out of* `when` are ever multi-valued.
   */
  CompatPromise.prototype.then = function (onFulfilled, onRejected) {
    var next = new CompatPromise();
    this._whenSettled(function (settled) {
      var handler = settled._state === FULFILLED ? onFulfilled : onRejected;
      if (typeof handler !== 'function') {
        // Pass the settled state straight through.
        if (settled._state === FULFILLED) {
          next._settle(FULFILLED, settled._values);
        } else {
          next.reject(settled._error);
        }
        return;
      }
      var result;
      try {
        result = settled._state === FULFILLED
          ? handler.apply(undefined, settled._values)
          : handler(settled._error);
      } catch (err) {
        next.reject(err);
        return;
      }
      // A rejection handler that returns normally recovers the chain, exactly
      // as `.catch` does natively and as the original Parse.Promise did.
      next.resolve(result);
    });
    return next;
  };

  /** jQuery-Deferred spellings the codebase is written against. */
  CompatPromise.prototype.done = function (onFulfilled) {
    return this.then(onFulfilled);
  };

  CompatPromise.prototype.fail = function (onRejected) {
    return this.then(undefined, onRejected);
  };

  CompatPromise.prototype['catch'] = function (onRejected) {
    return this.then(undefined, onRejected);
  };

  /**
   * Run on either outcome.
   *
   * This is `then(callback, callback)`, exactly as `parse-1.5.0.js:4169` had
   * it, and the consequences are load-bearing rather than incidental:
   *
   *   - the callback's RETURN VALUE propagates. `Character.add_experience_notation`
   *     does `.always(function () { return self.get_experience_notations(); })
   *     .then(function (ens) { ens.add(...) })` and breaks with
   *     "Cannot read properties of undefined (reading 'add')" without it.
   *   - a rejection is CONVERTED TO FULFILLMENT. Which means the
   *     `.always(...).fail(...)` chains all over mobileRouter never reach
   *     their `.fail` -- those handlers have always been dead code in this
   *     app.
   *
   * The second one looks like a bug worth fixing and is deliberately left
   * alone. A compatibility layer's job is to preserve behaviour, and making
   * those handlers live would start surfacing error toasts on paths that have
   * never shown one, which is a behaviour change dressed up as a fix. If they
   * should fire, that is a separate change with its own test.
   *
   * An earlier version of this file re-emitted the original outcome instead,
   * on the reasoning that swallowing looked wrong. It was reasoning about what
   * ought to happen rather than reading what did, and it broke character
   * creation.
   */
  CompatPromise.prototype.always = function (callback) {
    return this.then(callback, callback);
  };

  CompatPromise.prototype['finally'] = function (callback) {
    return this.always(callback);
  };

  /** Interop: make this usable anywhere a native promise is expected. */
  CompatPromise.prototype.toNative = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      self._whenSettled(function (settled) {
        if (settled._state === FULFILLED) {
          resolve(settled._values.length > 1 ? settled._values : settled._values[0]);
        } else {
          reject(settled._error);
        }
      });
    });
  };

  /** Resolved with any number of values. */
  CompatPromise.as = function () {
    var promise = new CompatPromise();
    promise.resolve.apply(promise, arguments);
    return promise;
  };

  /** Rejected. Named `error` in the Parse SDK. */
  CompatPromise.error = function (error) {
    var promise = new CompatPromise();
    promise.reject(error);
    return promise;
  };

  CompatPromise.is = function (value) {
    return value instanceof CompatPromise ||
      (!!value && typeof value.then === 'function' && typeof value.always === 'function');
  };

  /** Adopt any thenable, including a native `parse@8.x` promise. */
  CompatPromise.from = function (value) {
    if (CompatPromise.is(value)) return value;
    var promise = new CompatPromise();
    if (isThenable(value)) {
      value.then(function (v) { promise.resolve(v); }, function (e) { promise.reject(e); });
    } else {
      promise.resolve(value);
    }
    return promise;
  };

  /**
   * Wait for all of them.
   *
   * Faithful to `parse-1.5.0.js`: array-or-varargs by `length` sniffing,
   * resolution with separate arguments, and rejection with an ARRAY of errors
   * only after every input has settled.
   */
  CompatPromise.when = function (promises) {
    var objects;
    if (promises && (promises.length === undefined || promises.length === null)) {
      objects = Array.prototype.slice.call(arguments);
    } else {
      objects = Array.prototype.slice.call(promises || []);
    }

    var total = objects.length;
    var hadError = false;
    var results = new Array(total);
    var errors = new Array(total);
    var promise = new CompatPromise();

    if (total === 0) {
      return CompatPromise.as();
    }

    var resolveOne = function () {
      total = total - 1;
      if (total === 0) {
        if (hadError) {
          promise.reject(errors);
        } else {
          promise.resolve.apply(promise, results);
        }
      }
    };

    objects.forEach(function (object, i) {
      if (isThenable(object)) {
        object.then(function (result) {
          results[i] = result;
          resolveOne();
        }, function (error) {
          errors[i] = error;
          hadError = true;
          resolveOne();
        });
      } else {
        results[i] = object;
        resolveOne();
      }
    });

    return promise;
  };

  /** `_isNullOrUndefined` equivalent, exported for the tests. */
  CompatPromise._isThenable = isThenable;

  return CompatPromise;
}));
