define([
    "underscore",
    "parse",
], function( _, Parse  ) {

    var process_single = function (error) {
        if (_.has(error, "message")) {
            console.log("Error in promise " + error.message);
            if (Parse.Error.INVALID_LINKED_SESSION == error.code) {
                Parse.User.logOut();
            }
        } else {
            console.log("Error in promise " + error);
        }
    };

    var func = function (error) {
        if (_.isArray(error)) {
            _.each(error, function (e) {
                process_single(e);
            })
        } else {
            process_single(error);
        }
    };

    return func;
} );
