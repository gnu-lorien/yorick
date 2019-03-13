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
    "text!../templates/create/attributes.html",
    "text!../templates/create/focuses.html",
    "text!../templates/create/skills.html",
    "text!../templates/create/backgrounds.html",
    "text!../templates/create/arts.html",
    "text!../templates/create/disciplines.html",
    "text!../templates/create/gifts.html",
    "text!../templates/create/merits.html",
    "text!../templates/create/flaws.html",
    "text!../templates/create/complete.html"
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
    attributes_html,
    focuses_html,
    skills_html,
    backgrounds_html,
    arts_html,
    disciplines_html,
    gifts_html,
    merits_html,
    flaws_html,
    complete_html
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
            var self = this;
            self.listenTo(self.model, "change", self.render);
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
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            _.each(self.model.all_text_attributes(), function (st) {
                self.listenTo(self.model, "change:" + st, self.render);
            });
            _.bindAll(
                this,
                "render",
                "template",
                "onRender"
            );
        }
    });
    _.extend(SimpleTexts.prototype, VampirePrintHelper);
    
    var Attributes = Marionette.ItemView.extend({
        template: _.template(attributes_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            return {
                creation: creation,
                character: self.model
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change:attributes", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender"
            );
        }
    });
    _.extend(Attributes.prototype, VampirePrintHelper);
    
    var Focuses = Marionette.ItemView.extend({
        template: _.template(focuses_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            return {
                creation: creation,
                character: self.model
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change:focus_physicals", self.render);
            self.listenTo(self.model, "change:focus_mentals", self.render);
            self.listenTo(self.model, "change:focus_socials", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender"
            );
        }
    });
    _.extend(Focuses.prototype, VampirePrintHelper);
    
    var Skills = Marionette.ItemView.extend({
        template: _.template(skills_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            return {
                creation: creation,
                character: self.model
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change:skills", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender"
            );
        }
    });
    _.extend(Skills.prototype, VampirePrintHelper);
    
    var Backgrounds = Marionette.ItemView.extend({
        template: _.template(backgrounds_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            var description_category = self.getDescriptionCategory();
            return {
                creation: creation,
                character: self.model,
                description_category: description_category
            }
        },
        getDescriptionCategory: function () {
            if ("Werewolf" == this.model.get("type")) {
                return "wta_backgrounds";
            } else if ("ChangelingBetaSlice" == this.model.get("type")) {
                return "ctdbs_backgrounds";
            } else {
                return "backgrounds";
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change:" + self.getDescriptionCategory(), self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender",
                "getDescriptionCategory"
            );
        }
    });
    _.extend(Backgrounds.prototype, VampirePrintHelper);
    
    var Arts = Marionette.ItemView.extend({
        template: _.template(arts_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            return {
                creation: creation,
                character: self.model
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender"
            );
        }
    });
    _.extend(Arts.prototype, VampirePrintHelper);
    
    var Disciplines = Marionette.ItemView.extend({
        template: _.template(disciplines_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            return {
                creation: creation,
                character: self.model
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model.get("creation"), "saved", self.render);
            self.listenTo(self.model, "change", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender"
            );
        }
    });
    _.extend(Disciplines.prototype, VampirePrintHelper);
    
    var Gifts = Marionette.ItemView.extend({
        template: _.template(gifts_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            return {
                creation: creation,
                character: self.model
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model.get("creation"), "saved", self.render);
            self.listenTo(self.model, "change", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender"
            );
        }
    });
    _.extend(Gifts.prototype, VampirePrintHelper);
    
    var Merits = Marionette.ItemView.extend({
        template: _.template(merits_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            var description_category = self.getDescriptionCategory();
            return {
                creation: creation,
                character: self.model,
                description_category: description_category
            }
        },
        getDescriptionCategory: function () {
            if ("Werewolf" == this.model.get("type")) {
                return "wta_merits";
            } else if ("ChangelingBetaSlice" == this.model.get("type")) {
                return "ctdbs_merits";
            } else {
                return "merits";
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender",
                "getDescriptionCategory"
            );
        }
    });
    _.extend(Merits.prototype, VampirePrintHelper);
    
    var Flaws = Marionette.ItemView.extend({
        template: _.template(flaws_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            var description_category = self.getDescriptionCategory();
            return {
                creation: creation,
                character: self.model,
                description_category: description_category
            }
        },
        getDescriptionCategory: function () {
            if ("Werewolf" == this.model.get("type")) {
                return "wta_flaws";
            } else if ("ChangelingBetaSlice" == this.model.get("type")) {
                return "ctdbs_flaws";
            } else {
                return "flaws";
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender"
            );
        }
    });
    _.extend(Flaws.prototype, VampirePrintHelper);
    
    var Complete = Marionette.ItemView.extend({
        template: _.template(complete_html),
        templateHelpers: function() {
            var self = this;
            var creation = self.model.get("creation");
            return {
                creation: creation,
                character: self.model
            }
        },
        onRender: function() {
            this.$el.enhanceWithin();
        },
        initialize: function(options) {
            var self = this;
            self.listenTo(self.model, "change", self.render);
            _.bindAll(
                this,
                "render",
                "getTemplate",
                "onRender"
            );
        }
    });
    _.extend(Complete.prototype, VampirePrintHelper);

    var LayoutView = Marionette.LayoutView.extend({
        template: _.template(parent_html),
        regions: {
            description: "#ccv-description",
            simpletext: "#ccv-simpletext",
            nextone: "#ccv-next-one",
            nexttwo: "#ccv-next-two",
            nextthree: "#ccv-next-three",
            nextfour: "#ccv-next-four",
            nextfive: "#ccv-next-five",
            nextsix: "#ccv-next-six",
            nextseven: "#ccv-next-seven",
            nexteight: "#ccv-next-eight",
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
            self.showChildView("nextone", new Attributes({
                model: character
            }), options);
            self.showChildView("nexttwo", new Focuses({
                model: character
            }), options);
            self.showChildView("nextthree", new Skills({
                model: character
            }), options);
            self.showChildView("nextfour", new Backgrounds({
                model: character
            }), options);
            var fiveview;
            if ("Werewolf" == character.get("type")) {
                fiveview = new Gifts({model: character});
            } else if ("ChangelingBetaSlice" == character.get("type")) {
                fiveview = new Arts({model:character});
            } else {
                fiveview = new Disciplines({model:character});
            }
            self.showChildView("nextfive", fiveview, options);
            self.showChildView("nextsix", new Merits({
                model: character
            }), options);
            self.showChildView("nextseven", new Flaws({
                model: character
            }), options);
            self.showChildView("nexteight", new Complete({
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