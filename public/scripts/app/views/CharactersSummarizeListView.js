// Category View
// =============

// Includes file dependencies
define([
    "underscore",
	"jquery",
	"backbone",
    "text!../templates/character-summarize-list-item.html",
    "marionette"
], function( _, $, Backbone, character_summarize_list_item_html, Marionette ) {

    var SummaryView = Marionette.ItemView.extend({
        tagName: "li",
        className: "ul-li-has-thumb",
        template: _.template(character_summarize_list_item_html),
        initialize: function(options) {
            this.mode = options.mode
        },
        
        templateHelpers: function () {
            var self = this;
            return {
                e: self.model,
                mode: self.mode,
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
        childViewOptions: function(model, index) {
            var self = this;
            return {
                mode: self.mode
            }
        },
        
        onRender: function () {
            var self = this;
            /*
            self.$el.filterable({
                input: "#troupes-characters-filter"
            });
            self.$el.filterable("enable");
            */
            self.$el.attr('data-role', 'listview');
            self.$el.attr('data-inset', 'true');
            self.$el.attr('data-filter', 'true');
            self.$el.attr('data-input', '#troupes-summarize-characters-filter');
            /*
            self.$el.enhanceWithin();
            */
        },
        
        /*
        onAddChild: function() {
            var self = this;
            self.$el.filterable("refresh");
        },
        */
        onDomRefresh: function() {
            var self = this;
            /*
            self.$el.filterable("refresh");           
            self.$el.filterable("enable");
            */
        }
        
    } );
    
    var ButtonView = Marionette.ItemView.extend({
        template: _.template("<button>Click me for doom</button>"),
        triggers: {
            "click": "doom:clicked"
        },
    })
    
    var View = Marionette.LayoutView.extend({
        el: "#troupe-summarize-characters-all > div[data-role='main']", 
        regions: {
            sections: "#sections",
            list: "#troupe-summarize-characters-list"
        },
        childEvents: {
            "doom:clicked": "doomclicked",
        },
        doomclicked: function () {
            var self = this;
            console.log("Doom was definitely clicked");
            self.list.currentView.mode = "backgrounds";
            self.collection.reset(_.map(self.collection.models));
            /*
            var options = self.options || {};
            self.showChildView(
                'list',
                new BackgroundsView({
                    collection: self.collection}),
                options);
            self.$el.enhanceWithin();
            */
        },
        setup: function() {
            var self = this;
            var options = self.options || {};
            self.showChildView(
                'sections',
                new ButtonView(),
                options);
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