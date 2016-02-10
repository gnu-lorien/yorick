define([
    "underscore",
    "parse",
], function( _, Parse  ) {

    var log_single = function (error) {
        if (_.has(error, "message")) {
            console.log("Error in promise " + error.message);
        } else {
            console.log("Error in promise " + error);
        }
    };

    var func = function (error) {
        if (_.isArray(error)) {
            _.each(error, function (e) {
                log_single(e);
            })
        } else {
            log_single(error);
        }
    };

    return func;
} );
