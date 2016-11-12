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
    "../helpers/PromiseFailReport",
    "papaparse"
], function( _, $, Backbone, character_summarize_list_item_html, Marionette, Vampire, Backform, character_summarize_list_item_csv_html, character_summarize_list_item_csv_header_grouped_html, PromiseFailReport, Papa ) {

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
        ],
        events: {
            "submit": function(e) {
                var self = this;
                e.preventDefault();
                var results = Papa.parse(self.model.get("descriptiondata"), {header: true});
                console.log(results);               
                if (0 != results.errors.length) {
                    console.log(JSON.stringify(results.errors));
                    return;
                }
                
                var promises = _.map(results.data, function(d, i) {
                    // Find any existing data that matches the category and name
                    var q = new Parse.Query("Description")
                        .equalTo("category", d.category)
                        .equalTo("name", d.name);
                    var disguy;
                    return q.first().then(function (toupdate) {
                        // If found, use that as the update object
                        // Otherwise create a new update object
                        if (!toupdate) {
                            toupdate = new Parse.Object("Description", {
                                name: d.name,
                                category: d.category
                            });
                            console.log("Didn't find existing object for " + d.category + " " + d.name);
                        } else {
                            console.log("Found existing object for " + d.category + " " + d.name);
                        }
                        
                        // Set the ACL to be writable by administrators
                        var acl = new Parse.ACL;
                        acl.setPublicReadAccess(true);
                        acl.setPublicWriteAccess(false);
                        acl.setRoleReadAccess("Administrator", true);
                        acl.setRoleWriteAccess("Administrator", true);
                        toupdate.setACL(acl);
                        
                        var final = _.omit(d, function(key) {
                            if (_.includes(["name", "category"], key)) {
                                return true;
                            }
                            if ("" == key) {
                                return true;
                            }
                            
                            return false;
                        })
                        
                        _.each(final, function(value, key) {
                            if (key == "order") {
                                toupdate.set(key, _.parseInt(value));
                            } else {
                                toupdate.set(key, value);
                            }
                        })
                        console.log(toupdate.attributes);
                        disguy = " " + toupdate.id + " " + toupdate.attributes.name;
                        return toupdate.save();
                    }).fail(function (e) {
                        console.log(e);
                        console.log("Error on saving disguy?" + disguy);
                    })
                    // Return the promise so we can wait on them all
                });
                
                Parse.Promise.when(promises).then(function() {
                    console.log(JSON.stringify(arguments));
                    console.log("Saved all of that");
                    //return Parse.Object.saveAll(arguments);
                }).then(function() {
                    console.log("Saved all of that");
                }).fail(PromiseFailReport);
                // Wait on all of the promises and report back
            }
        }
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
            "submit": "submit"
        },
        filterwith: function (formvalues) {
            var self = this
            var q;
            if (formvalues.get("category") == "All") {
                q = new Parse.Query("Description");
            } else {
                q = new Parse.Query("Description").equalTo("category", formvalues.get("category"));
            }
            var descriptions = [];
            return q.each(function (d) {
                descriptions.push(_.omit(d.attributes, "ACL"));
            }).then(function () {
                descriptions = _(descriptions)
                    .sortByAll(["category", "order", "name"])
                    .value();
                var all_fields = _(descriptions)
                    .map(function (d) {
                        return _.keys(d);
                    })
                    .tap(function(o) {
                        console.log(o)
                    })
                    .flatten()
                    .uniq()
                    .value();
                self.data.set("descriptiondata", Papa.unparse({
                    fields: all_fields,
                    data: descriptions}));
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
                var so = _.map(categories, function(value, key) {
                    return {
                        label: key,
                        value: key
                    };
                });
                so = _.sortBy(so, 'label');
                so.push({label: "All", value: "All"});
                
                firstSelect.set("options", so);
                return Parse.Promise.as(form.render());
            })
        }
    });

    // Returns the View class
    return View;

} );