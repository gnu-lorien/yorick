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
        ui: {
            "button": ".test-you-like"
        },
        events: {
            "click @ui.button": "clicked",
        },
        modelEvents: {
            "change": "render",
        },
        clicked: function(e) {
            var self = this;
            e.preventDefault();
            var t = self.$(e.currentTarget);
            var id = t.data('id');
            console.log(id);
            self.model.set('everClicked', true);
        },
        onRender: function () {
            this.$el.enhanceWithin();
        }
    } );

    // Returns the View class
    return View;

} );