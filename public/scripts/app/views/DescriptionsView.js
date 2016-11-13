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