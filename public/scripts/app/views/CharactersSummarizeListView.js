// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/character-summarize-list-item.html",
    "marionette"
], function( $, Backbone, character_summarize_list_item_html, Marionette ) {

    var SummaryView = Marionette.ItemView.extend({
        tagName: "li",
        className: "ul-li-has-thumb",
        template: _.template(character_summarize_list_item_html),
        
        templateHelpers: function () {
            var self = this;
            return {
                e: self.model
            };
        },
        
        events: {
            "click": "clicked",
        },

        clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            var targete = $(e.currentTarget);
            var pickedId = targete.attr("backendId");
            var tmpl = _.template(self.click_url)({character_id: pickedId});
            window.location.hash = tmpl;
        },
        
        onRender: function () {
            this.$el.enhanceWithin();
        }
    });
    
    // Extends Backbone.View
    var View = Marionette.CollectionView.extend( {
        childView: SummaryView,
    } );

    // Returns the View class
    return View;

} );