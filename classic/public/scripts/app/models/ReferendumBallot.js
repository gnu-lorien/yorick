// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    // The Model constructor
    var Model = Parse.Object.extend("ReferendumBallot");

    // Returns the Model class
    return Model;

} );