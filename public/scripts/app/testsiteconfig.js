// Includes file dependencies
define([
], function () {

    var target = (typeof window !== 'undefined' && window.__karma__ && window.__karma__.config && window.__karma__.config.args && window.__karma__.config.args[0]) || "localhost";

    var ConfigLocalhost = {
        serverURL: "http://localhost:1337/parse",
        facebookAppId: "1607159299598020",
        redirect_uri: "http://localhost:1337/index.html",
        SAMPLE_TROUPE_ID: "WOad4CBTsG"
    };

    var ConfigPubstorm = {
        serverURL: "https://stagingapi.undergroundtheater.org/parse",
        facebookAppId: "1606746326305984",
        redirect_uri: "https://stagingpatron.undergroundtheater.org/index.html",
        SAMPLE_TROUPE_ID: "WOad4CBTsG"
    };
    
    if (target === "staging" || target === "stagingapi" || target === "pubstorm") {
        return ConfigPubstorm;
    }
    return ConfigLocalhost;

});