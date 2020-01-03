// Includes file dependencies
define([
    "backbone",
    "marionette",
    "text!../templates/player_options.html",
    "../helpers/PromiseFailReport",
    "parse",
    "../helpers/RoleWreqr",
    "../helpers/TroupeWreqr",
    "../collections/Troupes",
    "text!../templates/troupe-list-entry.html"
], function( Backbone, Marionette, player_options_html, PromiseFailReport, Parse, RoleHelper, TroupeHelper, Troupes, troupe_list_entry_html) {

    var TroupeView = Marionette.ItemView.extend({
        tagName: 'li',
        className: 'ul-li-has-thumb',
        template: _.template(troupe_list_entry_html),
        templateHelpers: function() {
            return {"e": this.model};
        },
        onRender: function () {
            this.$el.enhanceWithin();
        }
    });

    var TroupesView = Marionette.CompositeView.extend({
        template: function(serialized_model) {
            return _.template('<h2>Troupe Characters All</h2><% if (loading) { %> <p>Loading Your Troupes...</p><% } %><ul data-role="listview"></ul>')(serialized_model);
        },
        initialize: function(options) {
            var self = this;
            self.options = options;
            this.listenTo(self.model, "change", self.render);
        },
        childView: TroupeView,
        childViewContainer: "ul",
        onRender: function () {
            this.$el.enhanceWithin();
        },
        collectionEvents: {
            "reset": function() {
                var self = this;
                _.defer(function () {
                    self.$el.enhanceWithin();
                });
            }
        }
    });

    var View = Marionette.LayoutView.extend( {
        template: _.template(player_options_html),
        regions: {
            troupcharactersquickaccess: "#troupe-characters-quick-access",
        },
        initialize: function(options) {
            var self = this;
            self.options = options || {};
            self.roles = RoleHelper.channel.reqres.request("all");
            self.listenTo(self.roles, "add reset remove change", self.update_troupes);
            self.troupes = new Troupes;
            var global_troupes = TroupeHelper.channel.reqres.request("all");
            self.listenTo(global_troupes, "add reset remove change", self.update_troupes);
            _.bindAll(this, "setup", "update_troupes");
        },
        update_troupes: function() {
            var self = this;
            self._updateTroupeWrapper = self._updateTroupeWrapper || Parse.Promise.as();
            self._updateTroupeWrapper = self._updateTroupeWrapper.always(function () {
                var troupes = [];
                _.each(self.roles.models, function(role) {
                    var id = role.attributes.attributes.name;
                    id = id.split('_');
                    id = id[1];
                    troupes.push(TroupeHelper.channel.reqres.request("get", id));
                });
                self.troupes.reset(troupes);
            });
            return self._updateTroupeWrapper;
        },
        setup: function() {
            var self = this;
            var options = self.options || {};
            self.render();

            var is_st = Parse.User.current().get("storytellerinterface");
            var is_ad = Parse.User.current().get("admininterface");

            // Don't try to display the troupe characters quick access if we don't think they have any special roles
            if (!is_ad && !is_st)
                return self;

            var setupState = new Backbone.Model;
            setupState.set("loading", true);
            self.showChildView('troupcharactersquickaccess', new TroupesView({
                model: setupState,
                collection: self.troupes
            }), options);
            // Get the troupes first so we have them when the roles start
            var loadingPromises = [];
            loadingPromises.push(TroupeHelper.get_troupes());
            loadingPromises.push(RoleHelper.get_current_roles());
            Parse.Promise.when(loadingPromises).fail(PromiseFailReport).always(function () {
                setupState.set("loading", false);
            });

            return self;
        },
    } );

    return View;
} );
