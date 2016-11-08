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
    "text!../templates/character-summarize-list-item-csv-header-grouped.html",
    "../helpers/PromiseFailReport"
], function( _, $, Backbone, character_summarize_list_item_html, Marionette, Vampire, Backform, character_summarize_list_item_csv_html, character_summarize_list_item_csv_header_grouped_html, PromiseFailReport ) {

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
            this.columnNames = options.columnNames;
        },
        
        templateHelpers: function () {
            var self = this;
            return {
                e: self.model,
                mode: self.mode,
                name: self.name,
            };
        },

    });
    
    var CSVHeaderGroupedView = Marionette.ItemView.extend({
        tagName: "li",
        template: _.template(character_summarize_list_item_csv_header_grouped_html),
        initialize: function(options) {
            this.mode = options.mode;
            this.name = options.name;
            this.columnNames = options.columnNames;
        },
        
        templateHelpers: function () {
            var self = this;
            return {
                e: self.model,
                mode: self.mode,
                name: self.name,
                columnNames: self.columnNames
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
                name: self.name,
                columnNames: self.columnNames
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
   
    var DataForm = Backform.Form.extend({
        fields: [
            {
                control: "button",
                label: "Update Changes to Server"
            },
            {
                name: "descriptiondata",
                label: "Descriptions",
                control: "textarea"
            }
        ]
    });
    
    var Form = Backform.Form.extend({
        fields: [
            {
                name: "category",
                label: "Category",
                control: "select",
                options: [{label: "None", value: "None"}]
            }
        ]
    });
    
    var Mode = Backbone.Model.extend({
        
    });
    
    var Modes = Backbone.Collection.extend({
        model: Mode
    })
    
    var View = Marionette.LayoutView.extend({
        el: "#administration-descriptions > div[data-role='main']", 
        regions: {
            sections: "#descriptions-sections",
            list: "#administration-descriptions-list"
        },
        childEvents: {
            "filterwith": "filterwith",
        },
        filterwith: function (formvalues) {
            var self = this
            self.data.set("descriptiondata", formvalues.get("category"));
            var descriptions = [];
            var q = new Parse.Query("Description").equalTo("category", formvalues.get("category"));
            return q.each(function (d) {
                descriptions.push(d);
            }).then(function () {
                descriptions = _(descriptions)
                    .map("attributes")
                    .sortBy("order", "name")
                    .value();
                self.data.set("descriptiondata", JSON.stringify(descriptions));
            }).fail(PromiseFailReport);
            
            this.$el.enhanceWithin();
        },
        getColumnNames: function(category) {
            var self = this;
            return _(self.collection.models)
                .map("attributes." + category)
                .flatten()
                .map("attributes.name")
                .without(undefined)
                .sortBy()
                .uniq(true)
                .value();
        },
        setup: function() {
            var self = this;
            var options = self.options || {};
            var modes = new Modes;
            self.filterOptions = new Backbone.Model({
                playable: true,
                category: "attributes",
                antecedence: "PC",
                resulttype: "onlycat",
                format: "pretty"
            });
            self.data = new Backbone.Model({
                descriptiondata: "Nothing here yet"
            })
            self.listenTo(self.filterOptions, 'change', self.filterwith);
            self.showChildView(
                'sections',
                new Form({
                    model: self.filterOptions
                }),
                options);
            self.showChildView(
                'list',
                new DataForm({
                    model: self.data,
                }),
                options);
            this.$el.enhanceWithin();
            return self;
        },
        update_categories: function () {
            var self = this;
            var q = new Parse.Query("Description");
            q.select("category");
            var categories = {};
            return q.each(function (d) {
                categories[d.get("category")] = 1;
            }).then(function () {
                console.log(categories);
                var form = self.sections.currentView;
                var firstSelect = form.fields.models[0];
                firstSelect.set("options", _.map(categories, function(value, key) {
                    return {
                        label: key,
                        value: key
                    };
                }));
                return Parse.Promise.as(form.render());
            })
        }
    });

    // Returns the View class
    return View;

} );