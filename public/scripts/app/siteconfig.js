// Includes file dependencies
define([
], function () {
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

    var ConfigHeroku = {
        serverURL: "https://young-plateau-55863.herokuapp.com/parse",
        facebookAppId: "202279720650237",
        redirect_uri: "https://sheets.ourislandgeorgia.net/index.html",
        SAMPLE_TROUPE_ID: "mXhRByDNxX"
    };

    var ConfigAfterTwilight = {
        serverURL: "https://after-twilight-yorick.herokuapp.com/parse",
        facebookAppId: "202279720650237",
        redirect_uri: "https://sheets.ourislandgeorgia.net/index.html",
        SAMPLE_TROUPE_ID: "mXhRByDNxX"
    };

    var ConfigGnuLorienDev = ConfigAfterTwilight;
    
    return ConfigGnuLorienDev;
});
