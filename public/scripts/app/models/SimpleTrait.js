// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse"
], function( $, Parse ) {

    // The Model constructor
    var Model = Parse.Object.extend( "SimpleTrait", {
        linkId: function() {
            return this.id || this.cid;
        }
    } );

    // Returns the Model class
    return Model;

} );