// Includes file dependencies
define([
    "underscore",
    "jquery",
    "backbone",
    "parse",
    "text!../templates/character-summarize-list-item.html",
    "marionette",
    "backform",
    "text!../templates/character-summarize-list-item-csv.html",
    "text!../templates/character-summarize-list-item-csv-header-grouped.html",
    "../helpers/ReportError",
    "papaparse"
], function (_, $, Backbone, Parse, character_summarize_list_item_html, Marionette, Backform, character_summarize_list_item_csv_html, character_summarize_list_item_csv_header_grouped_html, ReportError, Papa) {

    var ruleName = "";

    // Column name -> "number" | "boolean" | "string", learned from rows that
    // already exist in the class being edited.
    //
    // Everything arrives from the CSV textarea as a string. Sending a string
    // to a Number column is a 400 ("expected Number but got String"), which
    // is why only the literal column "order" was ever editable numerically.
    // Parse Server's schema endpoint needs the master key, so it is not
    // reachable from the browser; sampling live rows is. Columns no sampled
    // row has a value for stay strings, exactly as before.
    var fieldTypes = {};

    // The columns that actually identify a row, per class.
    //
    // The lookup used to be `.equalTo("category", d.category).equalTo("name",
    // d.name)` for every class. `bnsmetv1_ClanRule` rows carry neither - all
    // 42 seeded rows have only `clan` - so that query resolved to
    // "category does not exist AND name does not exist", which every row
    // matches. `.first()` then returned whichever row Parse's default
    // ordering put first, regardless of which clan the submitted row was
    // about: there was no way through this UI to choose which row an edit
    // targeted, and a create could never find the row it had just made.
    var IDENTITY_COLUMNS = {
        "bnsmetv1_ClanRule": ["clan"],
        "bnsctdbs_KithRule": ["category", "name"],
        "bnsmetv1_ElderDisciplineRule": ["name"],
        "bnsmetv1_TechniqueRule": ["name"],
        "bnsmetv1_RitualRule": ["name"],
        "Description": ["category", "name"]
    };

    var identity_columns = function () {
        return IDENTITY_COLUMNS[ruleName] || ["category", "name"];
    };

    // The query that decides update-vs-insert, or `undefined` when the
    // submitted row carries no usable identity - in which case it is a new
    // row, not a licence to overwrite an arbitrary existing one.
    var identity_query = function (d) {
        var columns = identity_columns();
        var q = new Parse.Query(ruleName);
        var usable = true;
        _.each(columns, function (column) {
            var value = d[column];
            if (_.isUndefined(value) || _.isNull(value) || "" === value) {
                usable = false;
                return;
            }
            q.equalTo(column, value);
        });
        return usable ? q : undefined;
    };

    var type_of = function (v) {
        if (_.isNumber(v)) {
            return "number";
        }
        if (_.isBoolean(v)) {
            return "boolean";
        }
        if (_.isString(v)) {
            return "string";
        }
        return undefined;
    };

    var learn_field_types = function () {
        return new Parse.Query(ruleName).limit(200).find().then(function (rows) {
            _.each(rows, function (row) {
                _.each(row.attributes, function (value, key) {
                    if (_.has(fieldTypes, key)) {
                        return;
                    }
                    var t = type_of(value);
                    if (t) {
                        fieldTypes[key] = t;
                    }
                });
            });
            return Parse.Promise.as(fieldTypes);
        });
    };

    // Returns `undefined` for a value that should not be written at all.
    var coerce_field = function (key, value, existing) {
        if (_.isUndefined(value) || _.isNull(value) || "" === value) {
            return undefined;
        }

        var type = fieldTypes[key];
        // What the row itself already holds beats the sample.
        var current = existing ? existing.get(key) : undefined;
        type = type_of(current) || type;
        if ("order" == key) {
            type = "number";
        }

        if ("number" == type) {
            var n = Number(value);
            return _.isFinite(n) ? n : undefined;
        }
        if ("boolean" == type) {
            var s = String(value).toLowerCase();
            return "true" == s || "1" == s || "yes" == s;
        }
        return value;
    };

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
            "submit": function (e) {
                var self = this;
                e.preventDefault();
                var results = Papa.parse(self.model.get("descriptiondata"), { header: true });
                console.log(results);
                if (0 != results.errors.length) {
                    ReportError(
                        _.map(results.errors, function (err) {
                            return err.message + (_.isUndefined(err.row) ? "" : " (row " + err.row + ")");
                        }),
                        "Couldn't read the edited rules");
                    return;
                }

                var promises = _.map(results.data, function (d, i) {
                    // Find any existing row this submission is about, keyed on
                    // the columns that actually identify a row of this class.
                    var columns = identity_columns();
                    var label = _.map(columns, function (c) { return d[c]; }).join(" ");
                    var q = identity_query(d);
                    var disguy;
                    var lookup = q ? q.first() : Parse.Promise.as(undefined);
                    return lookup.then(function (toupdate) {
                        // If found, use that as the update object
                        // Otherwise create a new update object
                        if (!toupdate) {
                            // `ruleName` is module-scoped, not a property of
                            // the view - the lookup query above uses it
                            // correctly. `self.ruleName` was `undefined`, so
                            // Parse fell through to its `(attributes,
                            // options)` signature and every new rule 404'd on
                            // save.
                            toupdate = new Parse.Object(ruleName, _.pick(d, columns));
                            console.log("Didn't find existing object for " + label);
                        } else {
                            console.log("Found existing object for " + label);
                        }

                        // Set the ACL to be writable by administrators
                        var acl = new Parse.ACL;
                        acl.setPublicReadAccess(true);
                        acl.setPublicWriteAccess(false);
                        acl.setRoleReadAccess("Administrator", true);
                        acl.setRoleWriteAccess("Administrator", true);
                        toupdate.setACL(acl);

                        // Note the argument here is the *value*, not the key -
                        // lodash 3's `_.omit` predicate is `(value, key)`. The
                        // practical effect is to drop blank cells, which is
                        // what keeps an empty CSV column from clearing a field
                        // or 400ing a numeric one, so it is left as-is.
                        var final = _.omit(d, function (value) {
                            if (_.includes(["name", "category"], value)) {
                                return true;
                            }
                            if ("" == value) {
                                return true;
                            }

                            return false;
                        })

                        _.each(final, function (value, key) {
                            var coerced = coerce_field(key, value, toupdate);
                            if (!_.isUndefined(coerced)) {
                                toupdate.set(key, coerced);
                            }
                        })
                        console.log(toupdate.attributes);
                        disguy = " " + toupdate.id + " " + label;
                        return toupdate.save();
                    }).fail(function (e) {
                        // Keep logging the raw error object - it carries the
                        // Parse error code, which a wrapped Error would lose -
                        // and keep the chain *rejected* so the single
                        // reporting handler below actually runs. Swallowing it
                        // here is what made a 404ing save look like a
                        // successful one.
                        console.log(e);
                        console.log("Error saving rule row" + (disguy || (" " + label)));
                        return Parse.Promise.error(e);
                    })
                    // Return the promise so we can wait on them all
                });

                Parse.Promise.when(promises).then(function () {
                    console.log("Saved all of that");
                    ReportError.clear();
                }).fail(ReportError.on("Couldn't save the rule changes"));
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
                options: [{ label: "None", value: "None" }]
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
                q = new Parse.Query(ruleName);
            } else {
                q = new Parse.Query(ruleName).equalTo("category", formvalues.get("category"));
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
                    .tap(function (o) {
                        console.log(o)
                    })
                    .flatten()
                    .uniq()
                    .value();
                self.data.set("descriptiondata", Papa.unparse({
                    fields: all_fields,
                    data: descriptions
                }));
            }).fail(ReportError.on("Couldn't load the rules for that category"));

            this.$el.enhanceWithin();
        },
        getColumnNames: function (category) {
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
        setup: function () {
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
        update_rule_name: function (inRuleName) {
            if (inRuleName !== ruleName) {
                // One view instance is reused across all five rule editors.
                fieldTypes = {};
            }
            ruleName = inRuleName;
        },
        update_categories: function () {
            var self = this;
            var q = new Parse.Query(ruleName);
            q.select("category");
            var categories = {};
            return learn_field_types().then(function () {
                return q.each(function (d) {
                    categories[d.get("category")] = 1;
                });
            }).then(function () {
                console.log(categories);
                var form = self.sections.currentView;
                var firstSelect = form.fields.models[0];
                var so = _.map(categories, function (value, key) {
                    return {
                        label: key,
                        value: key
                    };
                });
                so = _.sortBy(so, 'label');
                so.push({ label: "All", value: "All" });

                firstSelect.set("options", so);
                return Parse.Promise.as(form.render());
            })
        }
    });

    // Returns the View class
    return View;

});