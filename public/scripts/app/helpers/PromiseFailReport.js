define([
    "underscore",
    "parse",
], function( _, Parse  ) {

    var process_single = function (error) {
        if (_.has(error, "message")) {
            console.log("Error in promise: " + error.message);
            trackJs.track("Error in promise: " + error.message);
            if (Parse.Error.INVALID_LINKED_SESSION == error.code) {
                Parse.User.logOut();
            }
        } else {
            console.log("Error in promise: " + error);
            trackJs.track("Error in promise: " + error);
        }
    };

    var func = function (error) {
        if (_.isArray(error)) {
            console.log("Error in a multi-promise follows {");
            _.each(error, function (e, i) {
                if (_.has(e, "success")) {
                    console.log("" + i + " succeeded at " + e.updatedAt);
                } else {
                    process_single(e);
                }
            });
            console.log("}");
        } else {
            process_single(error);
        }
    };

    return func;
} );
