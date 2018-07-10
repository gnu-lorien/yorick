// Includes file dependencies
define([
    "jquery",
    "underscore",
    "parse",
    "../models/Troupe"], function ($, _, Parse, Troupe) {

    var Collection = Parse.Collection.extend({
        model: Troupe,
        comparator: function (left, right) {
            var self = this;
            var l, r;
            l = left.get("name");
            r = right.get("name");

            if (_.gt(l, r)) {
                return 1;
            } else if (_.lt(l, r)) {
                return -1;
            }
            return 0;
        },
    });
    return Collection;

});
