define([
    "jquery",
    "underscore",
    "parse",
    "../collections/BNSCTDBS_ChangelingCosts"
], function( $, _, Parse, ChangelingBetaSliceCosts ) {

    var globalCosts = null;
    var get_costs = function() {
        if (globalCosts) {
            return Parse.Promise.as(globalCosts);
        } else {
            globalCosts = new ChangelingBetaSliceCosts;
            return globalCosts.inialize();
        }
    }

    return get_costs;
} );
