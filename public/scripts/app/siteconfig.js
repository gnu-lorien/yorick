// Includes file dependencies
define([
], function () {

    var ConfigPubstorm = {
        serverURL: "https://stagingapi.undergroundtheater.org/parse/1",
        facebookAppId: "1606746326305984",
        redirect_uri: "https://stagingpatron.undergroundtheater.org/index.html"
    };

    var ConfigPatron = {
        serverURL: "https://api.undergroundtheater.org/parse/1",
        facebookAppId: "1606746326305984",
        redirect_uri: "https://patron.undergroundtheater.org"
    };

    var ConfigLocalhost = {
        serverURL: "http://localhost:1337/parse/1",
        facebookAppId: "1607159299598020",
        redirect_uri: "http://localhost/index.html"
    };

    var ConfigGnuLorienLocalhost = {
        serverURL: "http://localhost:1337/parse/1",
        facebookAppId: "1607159299598020",
        redirect_uri: "http://localhost:63342/yorick/public/index.html",
        SAMPLE_TROUPE_ID: "k7zf9B7bwV"
    };

    var ConfigC9 = {
        serverURL: "https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse/1",
        redirect_uri: "https://yorick-latest-parse-server-gnu-lorien.c9users.io/index.html",
        SAMPLE_TROUPE_ID: "mXhRByDNxX"
    };

    var ConfigHeroku = {
        serverURL: "https://young-plateau-55863.herokuapp.com/parse/1",
        facebookAppId: "202279720650237",
        redirect_uri: "https://sheets.ourislandgeorgia.net/index.html",
        SAMPLE_TROUPE_ID: "mXhRByDNxX"
    };
    
    // The "/1" is not decoration.
    //
    // Parse JS SDK 1.5 hard-coded the API version segment onto whatever
    // serverURL it was given -- `url += "1/" + route` in parse-1.5.0.js -- so
    // a serverURL of ".../parse" reached the server as ".../parse/1/classes/X",
    // which is where index.js mounts (mountPath "/parse/1"). Modern SDKs do no
    // such thing and request ".../parse/classes/X", which 404s. The compat
    // layer does not add it back either -- `parse-compat/` never touches
    // serverURL.
    //
    // Every serverURL above now carries it explicitly. Owner decision,
    // 2026-08-20: move the config to match the server, rather than remounting
    // the server at "/parse" to match the config. Both fix it and doing BOTH
    // breaks it again; this direction leaves index.js's mount, every stored
    // file URL and every external link where they already are.
    //
    // Only the localhost value is overridden below, because the E2E harness
    // serves the app from the same origin as the API -- which is also why no
    // test in this repo can catch the five deployed values being wrong.
    if (typeof window !== 'undefined' && window.location) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            ConfigLocalhost.serverURL = window.location.origin + "/parse/1";
            return ConfigLocalhost;
        }
    }

    var ConfigGnuLorienDev = ConfigC9;
    
    return ConfigGnuLorienDev;

});
