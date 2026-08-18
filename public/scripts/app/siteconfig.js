// Includes file dependencies
define([
], function () {

    var ConfigPubstorm = {
        serverURL: "https://stagingapi.undergroundtheater.org/parse",
        facebookAppId: "1606746326305984",
        redirect_uri: "https://stagingpatron.undergroundtheater.org/index.html"
    };

    var ConfigPatron = {
        serverURL: "https://api.undergroundtheater.org/parse",
        facebookAppId: "1606746326305984",
        redirect_uri: "https://patron.undergroundtheater.org"
    };

    var ConfigLocalhost = {
        serverURL: "http://localhost:1337/parse",
        facebookAppId: "1607159299598020",
        redirect_uri: "http://localhost/index.html"
    };

    var ConfigGnuLorienLocalhost = {
        serverURL: "http://localhost:1337/parse",
        facebookAppId: "1607159299598020",
        redirect_uri: "http://localhost:63342/yorick/public/index.html",
        SAMPLE_TROUPE_ID: "k7zf9B7bwV"
    };

    var ConfigC9 = {
        serverURL: "https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse",
        redirect_uri: "https://yorick-latest-parse-server-gnu-lorien.c9users.io/index.html",
        SAMPLE_TROUPE_ID: "mXhRByDNxX"
    };

    var ConfigHeroku = {
        serverURL: "https://young-plateau-55863.herokuapp.com/parse",
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
    // such thing and request ".../parse/classes/X", which 404s.
    //
    // Every serverURL above is missing the same segment for the same reason.
    // They are left alone here because changing them changes where a deployed
    // build points, which is a deploy decision rather than a code one -- see
    // Phase 0.5 in docs/designs/yorick-modernization-differential-cutover.md.
    // Only the localhost value, which the E2E suite uses, is corrected.
    if (typeof window !== 'undefined' && window.location) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            ConfigLocalhost.serverURL = window.location.origin + "/parse/1";
            return ConfigLocalhost;
        }
    }

    var ConfigGnuLorienDev = ConfigC9;
    
    return ConfigGnuLorienDev;

});
