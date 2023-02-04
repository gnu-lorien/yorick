define([
    "jquery",
    "underscore"
], function( $, _ ) {

    var progress = function(text) {
        if (_.isUndefined($) || _.isUndefined($.mobile) || _.isUndefined($.mobile.loading)) {
            console.log("Progress: " + text);
        } else {
            if (!text) {
                $.mobile.loading("hide");
            } else {
                $.mobile.loading("show", {text: text, textVisible: true});
            }
        }
    };

    return progress;
} );
