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
    
    var CharactersView = Marionette.CollectionView.extend( {
        tagName: 'ul',
        childView: SummaryView,
        
        onRender: function () {
            var self = this;
            self.$el.attr('data-role', 'listview');
            self.$el.attr('data-inset', 'true');
            self.$el.attr('data-filter', 'true');
            self.$el.attr('data-input', '#troupes-characters-filter');
            self.$el.enhanceWithin();
        }
    } );
    
    var View = Marionette.LayoutView.extend({
        el: "#troupe-summarize-characters-all > div[data-role='main']", 
        regions: {
            sections: "#sections",
            list: "#troupe-summarize-characters-list"
        },
        setup: function() {
            var self = this;
            var options = self.options || {};
            self.showChildView(
                'list',
                new CharactersView({
                    collection: self.collection}),
                options);
            this.$el.enhanceWithin();
            return self;
        }
    });

    // Returns the View class
    return View;

} );