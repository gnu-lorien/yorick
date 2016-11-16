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
        serverURL: "https://yorick-undergroundtheater-gnu-lorien.c9users.io/parse",
        redirect_uri: "https://yorick-undergroundtheater-gnu-lorien.c9users.io/index.html",
        SAMPLE_TROUPE_ID: "zCQcZnlFx5"
    };
    
    var ConfigGnuLorienDev = ConfigPatron;
    
    return ConfigGnuLorienDev;

});
