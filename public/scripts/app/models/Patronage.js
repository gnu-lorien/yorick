// Category Model
// ==============

// Includes file dependencies
define([
	"jquery",
	"parse",
    "../helpers/ExpirationMixin"
], function( $, Parse, ExpirationMixin ) {

    // The Model constructor
    var Model = Parse.Object.extend("Patronage", ExpirationMixin);

    // Returns the Model class
    return Model;

} );