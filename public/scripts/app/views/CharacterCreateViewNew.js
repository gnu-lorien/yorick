// Category View
// =============

/* global _ */

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/character-create-view.html",
    "text!../templates/werewolf-create-view.html",
    "marionette",
    "text!../templates/create/parent.html",
    "../helpers/VampirePrintHelper",
    "text!../templates/create/description.html",
    "text!../templates/create/simpletexts.html",
    "text!../templates/create/therest.html"
], function(
    $,
    Backbone,
    character_create_view_html,
    werewolf_create_view_html,
    Marionette,
    parent_html,
    VampirePrintHelper,
    description_html,
    simpletexts_html,
    therest_html
) {

    var Description = Marionette.ItemView.extend({
        template: _.template(description_html),
        templateHelpers: function() {
            var self = this;
            return {
                creation: self.model.get("creation"),
                character: self.model
            }
        },
        initialize: function(options) {
            _.bindAll(
                this,
                "render",
                "template"
            );
        }
    });
    _.extend(Description.prototype, VampirePrintHelper);
    
    var SimpleTexts = Marionette.ItemView.extend({
        template: _.template(simpletexts_html),
        templateHelpers: function() {
            var self = this;
            return {
                creation: self.model.get("creation"),
                character: self.model
            }
        },
        initialize: function(options) {
            _.bindAll(
                this,
                "render",
                "template"
            );
        }
    });
    _.extend(SimpleTexts.prototype, VampirePrintHelper);
    
    var TheRest = Marionette.ItemView.extend({
        template: _.template(therest_html),
        templateHelpers: function() {
            var self = this;
            return {
                creation: self.model.get("creation"),
                character: self.model
            }
        },
        initialize: function(options) {
            _.bindAll(
                this,
                "render",
                "template"
            );
        }
    });
    _.extend(TheRest.prototype, VampirePrintHelper);

    var LayoutView = Marionette.LayoutView.extend({
        template: _.template(parent_html),
        regions: {
            description: "#ccv-description",
            simpletext: "#ccv-simpletext",
            therest: "#ccv-therest"
        },
        setup_regions: function() {
            var self = this;
            var options = self.options || {};
            var character = self.character;
            
            self.showChildView("description", new Description({
                model: character
            }), options);
            self.showChildView("simpletext", new SimpleTexts({
                model: character
            }), options);
            self.showChildView("therest", new TheRest({
                model: character
            }), options);
        },
        onRender: function() {
            this.setup_regions()
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            _.bindAll(
                this,
                "setup_regions",
                "scroll_back_after_page_change");
        },
        setup: function(options) {
            var self = this;
            var character = options.character;
            
            if (character == self.character) {
                return;
            }
            self.character = character;

            self.render();

            return self;
        },
        scroll_back_after_page_change: function() {
            var self = this;
            $(document).one("pagechange", function() {
                var top = _.parseInt(self.backToTop);
                $.mobile.silentScroll(top);
            });
        }
    });

    // Returns the View class
    return LayoutView;

} );