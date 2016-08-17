// Category View
// =============

// Includes file dependencies
define([
    "underscore",
	"jquery",
	"backbone",
    "text!../templates/character-summarize-list-item.html",
    "marionette",
    "../models/Vampire",
    "backform",
    "text!../templates/character-summarize-list-item-csv.html",
], function( _, $, Backbone, character_summarize_list_item_html, Marionette, Vampire, Backform, character_summarize_list_item_csv_html ) {

    var PrettyView = Marionette.ItemView.extend({
        tagName: "li",
        className: "ul-li-has-thumb",
        template: _.template(character_summarize_list_item_html),
        initialize: function(options) {
            this.mode = options.mode;
            this.name = options.name;
        },
        
        templateHelpers: function () {
            var self = this;
            return {
                e: self.model,
                mode: self.mode,
                name: self.name
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
    
    var CSVView = Marionette.ItemView.extend({
        tagName: "li",
        template: _.template(character_summarize_list_item_csv_html),
        initialize: function(options) {
            this.mode = options.mode;
            this.name = options.name;
        },
        
        templateHelpers: function () {
            var self = this;
            return {
                e: self.model,
                mode: self.mode,
                name: self.name
            };
        },

    });
    
    var CharactersView = Marionette.CollectionView.extend( {
        tagName: 'ul',
        childView: PrettyView,
        childViewOptions: function(model, index) {
            var self = this;
            return {
                mode: self.mode,
                name: self.name
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
    
    var FilterButton = Marionette.ItemView.extend({
        className: "ui-block-b",
        template: function (serialized_model) {
            return _.template("<button><%= name %></button>")(serialized_model);
        },
        events: {
            "click": "filterwith"
        },
        filterwith: function () {
            this.triggerMethod("filterwith", this.model);
        }
    });
    
    var FiltersView = Marionette.CollectionView.extend({
        className: "ui-grid-b ui-responsive",
        childView: FilterButton
    });
    
    var category_options = _.map(Vampire.all_simpletrait_categories(), function (info) {
        return {
            label: info[1],
            value: info[0]
        };
    }); 
    
    var Form = Backform.Form.extend({
        fields: [
            {
                name: "category",
                label: "Category",
                control: "select",
                options: category_options
            },
            {
                name: "antecedence",
                label: "NPC, PC, Primary, or Secondary",
                control: "select",
                options: [
                    {label: "All", value: "All"},
                    {label: "NPC", value: "NPC"},
                    {label: "PC of any type", value: "PC"},
                    {label: "Primary PC", value: "Primary"},
                    {label: "Secondary PC", value: "Secondary"},
                ]
            },
            {
                name: "resulttype",
                label: "Which sort of results to show?",
                control: "select",
                options: [
                    {label: "Only those with values in the category", value: "onlycat"},
                    {label: "Only those with no values in the category", value: "nocat"},
                    {label: "All", value: "all"}
                ]
            },
            {
                name: "playable",
                label: "Only show playable characters",
                control: "checkbox"
            },
            {
                name: "format",
                label: "Format",
                control: "select",
                options: [
                    {label: "Pretty", value: "pretty"},
                    {label: "CSV", value: "csv"}
                ]
            }
        ]
    });
    
    var Mode = Backbone.Model.extend({
        
    });
    
    var Modes = Backbone.Collection.extend({
        model: Mode
    })
    
    var View = Marionette.LayoutView.extend({
        el: "#troupe-summarize-characters-all > div[data-role='main']", 
        regions: {
            sections: "#sections",
            list: "#troupe-summarize-characters-list"
        },
        childEvents: {
            "filterwith": "filterwith",
        },
        filterwith: function (formvalues) {
            var self = this
            self.list.currentView.mode = formvalues.get("category");
            var entry = _.find(Vampire.all_simpletrait_categories(), function(e) {
                if (e[0] == formvalues.get("category")) {
                    return true;
                };
                return false;
            })
            self.list.currentView.name = entry[1];
            
            var desiredFormat = formvalues.get("format");
            if (_.startsWith(desiredFormat, "pretty")) {
                self.list.currentView.childView = PrettyView;
            } else {
                self.list.currentView.childView = CSVView;
            }
            
            var newfilter = function(child, index, collection) {
                var a = child.get("antecedence");
                if (_.isUndefined(a)) {
                    a = "Primary";
                }
                var ina = formvalues.get("antecedence");
                if (!_.startsWith(ina, "All")) {
                    if (_.startsWith(ina, "NPC")) {
                        if (!_.startsWith(a, "NPC")) {
                            return false;
                        }
                    } else if (_.startsWith(ina, "PC")) {
                        if (_.startsWith(a, "NPC")) {
                            return false;
                        }
                    } else {
                        if (!_.startsWith(a, ina)) {
                            return false;
                        }
                    }
                }
                var rt = formvalues.get("resulttype");
                if (_.startsWith(rt, "onlycat")) {
                    if (!child.has(formvalues.get("category"))) {
                        return false;
                    }
                    if (child.get(formvalues.get("category")).length == 0) {
                        return false;
                    }
                } else if (_.startsWith(rt, "nocat")) {
                     if (child.has(formvalues.get("category"))) {
                        return false;
                    }                   
                }
                
                if (formvalues.get("playable")) {
                    if (!child.has("owner")) {
                        return false;
                    }
                }
                
                return true;
            };
            self.list.currentView.filter = newfilter;
            self.collection.reset(_.map(self.collection.models));
        },
        setup: function() {
            var self = this;
            var options = self.options || {};
            var modes = new Modes;
            /*
            self.showChildView(
                'sections',
                new FiltersView({
                    collection: modes
                }),
                options);
            _.each(Vampire.all_simpletrait_categories(), function (e) {
                modes.add(new Mode({mode: e[0], name: e[1], category: e[2]}));
            });
            */
            self.filterOptions = new Backbone.Model({
                playable: true,
                category: "attributes",
                antecedence: "PC",
                resulttype: "onlycat",
                format: "pretty"
            });
            self.listenTo(self.filterOptions, 'change', self.filterwith);
            self.showChildView(
                'sections',
                new Form({
                    model: self.filterOptions
                }),
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