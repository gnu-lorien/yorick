/**
 * The module every `define([... "parse" ...])` in this app resolves to.
 *
 * `parse-8.6.0.js` is AMD-aware -- its wrapper is
 * `typeof define === "function" && define.amd ? define([], factory) : factory()`
 * -- so RequireJS honours its `define()` and a `shim` config entry would be
 * ignored. But the factory RETURNS NOTHING; it ends with
 * `globalThis.Parse = Parse`. Depending on it directly therefore yields
 * `undefined`, which would surface as "Cannot read properties of undefined"
 * from wherever the first `Parse.Object.extend` happens to run, a long way from
 * the actual cause.
 *
 * So this wrapper depends on the bundle to force it to load, then picks the
 * namespace off the global and installs the compatibility layer before handing
 * it to anyone. Every existing `define` that asks for "parse" gets a fully
 * shimmed Parse with no change to the module itself.
 */
// The dependency id is absolute, not './index'. RequireJS resolves relative
// ids against the MODULE ID, and app.js maps this file to the id "parse" --
// so './index' resolved to scripts/lib/index.js and 404'd, taking the whole
// bootstrap down with "Script error for: index".
define(['parse-sdk', 'parse-compat/index'], function (sdkModuleValue, install) {
    'use strict';

    // sdkModuleValue is undefined by design; the bundle publishes on the global.
    var Parse = (typeof globalThis !== 'undefined' && globalThis.Parse) ||
        (typeof window !== 'undefined' && window.Parse);

    if (!Parse) {
        throw new Error(
            'parse-compat: parse-8.6.0.js loaded but did not publish a global Parse. ' +
            'Check that the vendored bundle is the browser dist build.'
        );
    }

    return install(Parse);
});
