/* global Parse */
/**
 * The before-trigger seam.
 *
 * parse-server 2.8.4 calls a before-trigger as `trigger(request, response)` and
 * throws away what it returns: `node_modules/parse-server/lib/triggers.js:447`
 * makes that call and `:448` honours the returned promise only when the trigger
 * type is afterSave or afterDelete, so for beforeSave/beforeDelete
 * `response.success`/`response.error` is the only settlement path there is.
 * parse-server 9 calls the same trigger as `trigger(request)` - a bare call, no
 * arity branch anywhere in its triggers.js - and honours the returned promise.
 * No single handler shape satisfies both.
 *
 * So the hooks are written once, in the shape that survives - `function (request)`,
 * return to allow, throw or reject to refuse - and this wrapper supplies the old
 * shape when, and only when, the server actually hands it one. The test is the
 * fact itself: a `response` argument exists under 2.8.4 and does not under 9.
 *
 * Deliberately not a `LEGACY` constant. A flag has to be flipped by hand at bump
 * time, and the cost of forgetting is not a test failure: six of these hooks
 * settle inside a `.then`, where `response.success` on `undefined` becomes an
 * unhandled TypeError, parse-server's own uncaughtException handler
 * (`ParseServer.js:352`), and `process.exit(1)`. Across eight Playwright workers
 * that reads as a cascade of connection failures mid-suite. Reading the fact at
 * call time cannot be forgotten and cannot go stale.
 *
 * Under 2.8.4 this reproduces today's behaviour exactly:
 *   - the handler still runs synchronously inside the trigger call, so
 *     `request.object` mutations land in the same tick they always did;
 *   - a thrown value reaches `response.error` unchanged, and 2.8.4's
 *     `getResponseObject.error` (`triggers.js:253`) passes a `Parse.Error`
 *     straight to `reject` and wraps anything else in
 *     `new Parse.Error(SCRIPT_FAILED, value)` - which is what every
 *     `response.error(...)` call in main.js already produced;
 *   - success is always zero-argument, as every hook's already was, so 2.8.4's
 *     "a returned object replaces the save" semantic has nothing to bite on.
 */

var before_trigger = function (handler) {
    return function (request, response) {
        // parse-server 9+: no response object. Hand back the promise.
        if (!response) {
            return handler(request);
        }

        var result;
        try {
            result = handler(request);
        } catch (error) {
            response.error(error);
            return;
        }

        if (result && typeof result.then === "function") {
            // `.then` on the value itself, not `Promise.resolve(result).then`:
            // these chains are a MIX - `Parse.Promise`s from the SDK's own
            // query and save methods, native ones everywhere else since the
            // `Parse.Promise` conversion - and calling `.then` directly is what
            // the current code does. Adopting them into a native promise would
            // insert a tick that today's ordering does not have.
            result.then(
                function () { response.success(); },
                function (error) { response.error(error); }
            );
            return;
        }

        response.success();
    };
};

exports.beforeSave = function (className, handler) {
    Parse.Cloud.beforeSave(className, before_trigger(handler));
};

exports.beforeDelete = function (className, handler) {
    Parse.Cloud.beforeDelete(className, before_trigger(handler));
};
