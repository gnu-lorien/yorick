// Includes file dependencies
define([
], function () {

    var target = (typeof window !== 'undefined' && window.__karma__ && window.__karma__.config && window.__karma__.config.args && window.__karma__.config.args[0]) || "localhost";

    var ConfigLocalhost = {
        // "/1": see the note in siteconfig.js -- SDK 1.5 appended the API
        // version segment implicitly, modern SDKs do not.
        serverURL: "http://localhost:1337/parse/1",
        facebookAppId: "1607159299598020",
        redirect_uri: "http://localhost:1337/index.html",
        SAMPLE_TROUPE_ID: "WOad4CBTsG"
    };

    var ConfigPubstorm = {
        // "/1" for the same reason as above, and in step with siteconfig.js.
        //
        // Note what this file is NOT yet consistent with. Nothing but the
        // Jasmine/Karma specs loads it, and tests/test-main.js still maps
        // `parse` to "parse-1.5.0" while the app maps it to
        // "parse-compat/parse". SDK 1.5 appends the version segment itself
        // (`url += "1/" + route`, parse-1.5.0.js:1635), so under that harness
        // BOTH entries here are now one segment too long. They are written for
        // the modern SDK deliberately: repointing test-main.js is the one-line
        // change that makes this suite usable at all (see the handoff runbook,
        // "The Jasmine suite"), and the two have to move together. Until then
        // `npm run test:staging` cannot work -- which it already could not.
        serverURL: "https://stagingapi.undergroundtheater.org/parse/1",
        facebookAppId: "1606746326305984",
        redirect_uri: "https://stagingpatron.undergroundtheater.org/index.html",
        SAMPLE_TROUPE_ID: "WOad4CBTsG"
    };
    
    if (target === "staging" || target === "stagingapi" || target === "pubstorm") {
        return ConfigPubstorm;
    }
    return ConfigLocalhost;

});