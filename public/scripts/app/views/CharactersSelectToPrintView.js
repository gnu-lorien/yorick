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
    "../models/Werewolf",
    "backform",
    "text!../templates/character-summarize-list-item-csv.html",
    "text!../templates/character-summarize-list-item-csv-header-grouped.html",
], function( _, $, Backbone, character_summarize_list_item_html, Marionette, Vampire, Werewolf, Backform, character_summarize_list_item_csv_html, character_summarize_list_item_csv_header_grouped_html ) {

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
    
    var vampire_options = _.map(Vampire.all_simpletrait_categories(), function (info) {
        return {
            label: info[1],
            value: info[0]
        };
    });
    
    var werewolf_options = _.map(Werewolf.all_simpletrait_categories(), function (info) {
        return {
            label: info[1],
            value: info[0]
        };
    });
    
    var category_options = [
        {
            label: "Vampire",
            options: vampire_options
        },{
            label: "Werewolf",
            options: werewolf_options
        }
    ];
    
    var OptGroupSelectControl = Backform.Control.extend({
        defaults: {
          label: "",
          options: [], // List of options as [{label:<label>, value:<value>}, ...]
          extraClasses: []
        },
        template: _.template([
          '<label class="<%=Backform.controlLabelClassName%>"><%-label%></label>',
          '<div class="<%=Backform.controlsClassName%>">',
          '  <select class="<%=Backform.controlClassName%> <%=extraClasses.join(\' \')%>" name="<%=name%>" value="<%-value%>" <%=disabled ? "disabled" : ""%> <%=required ? "required" : ""%> >',
          '    <% for (var i=0; i < options.length; i++) { %>',
          '      <% var optgroup = options[i] %>',
          '      <optgroup label="<%= optgroup.label %>">',
          '      <% for (var j=0; j < optgroup.options.length; j++) { %>',
          '        <% var option = optgroup.options[j]; %>',
          '        <option value="<%-formatter.fromRaw(option.value)%>" <%=option.value === rawValue ? "selected=\'selected\'" : ""%> <%=option.disabled ? "disabled=\'disabled\'" : ""%>><%-option.label%></option>',
          '      <% } %>',
          '      </optgroup>',
          '    <% } %>',
          '  </select>',
          '</div>'
        ].join("\n")),
        events: {
          "change select": "onChange",
          "focus select": "clearInvalid"
        },
        formatter: Backform.JSONFormatter,
        getValueFromDOM: function() {
          return this.formatter.toRaw(this.$el.find("select").val(), this.model);
        }
    });
    
    var Form = Backform.Form.extend({
        fields: [
            {
                name: "category",
                label: "Category",
                control: OptGroupSelectControl,
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
            }
        ]
    });
    
    var Mode = Backbone.Model.extend({
        
    });
    
    var Modes = Backbone.Collection.extend({
        model: Mode
    })
    
    var View = Marionette.LayoutView.extend({
        regions: {
            sections: "#sections",
            list: "#troupe-select-to-print-characters-list"
        },
        childEvents: {
            "filterwith": "filterwith"
        },
        events: {
            "click #print-shown": "printselected"
        },
        printselected: function (e) {
            e.preventDefault();
            console.log("Print selected");
            window.location.hash = this.submission_template();
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
            if (_.isUndefined(entry)) {
                entry = _.find(Werewolf.all_simpletrait_categories(), function(e) {
                    if (e[0] == formvalues.get("category")) {
                        return true;
                    };
                    return false;
                })
            }
            self.list.currentView.name = entry[1];
            self.list.currentView.columnNames = self.getColumnNames(formvalues.get("category"));
            
            var desiredFormat = formvalues.get("format");
            if (_.startsWith(desiredFormat, "pretty")) {
                self.list.currentView.childView = PrettyView;
            } else if (_.startsWith(desiredFormat, "csvtraitgrouping")) {
                self.list.currentView.childView = CSVHeaderGroupedView;
            } else {
                self.list.currentView.childView = CSVView;
            }
            
            self.list.currentView.filter = self.get_filter_function();
            self.collection.reset(_.map(self.collection.models));
        },
        get_filter_function: function() {
            var self = this
            var formvalues = self.filterOptions;
            
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
            
            return newfilter;
        },
        get_filtered: function() {
            var newfilter = this.get_filter_function();
            return _.filter(this.collection.models, newfilter);
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
        initialize: function () {
            _.bindAll(this, "get_filter_function", "get_filtered");
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
            
            self.filterOptions.trigger("change", self.filterOptions);
            
            return self;
        }
    });

    // Returns the View class
    return View;

} );