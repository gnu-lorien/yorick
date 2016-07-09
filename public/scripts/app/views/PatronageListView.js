// Includes file dependencies
define([
	"jquery",
	"backbone",
    "marionette",
    "text!../templates/patronage-list-item.html"
], function( $, Backbone, Marionette, patronage_html ) {

    // Extends Backbone.View
    var View = Marionette.ItemView.extend( {
        tagName: 'li',
        template: function(serialized_model) {
            return _.template(patronage_html)(serialized_model);
        },
    } );

    // Returns the View class
    return View;

} );