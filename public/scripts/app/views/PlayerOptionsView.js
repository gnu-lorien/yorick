// Includes file dependencies
define([
    "backbone",
    "marionette",
    "text!../templates/player_options.html",
    "../helpers/PromiseFailReport",
    "parse",
    "../helpers/RoleWreqr",
    "../helpers/TroupeWreqr",
    "../collections/Troupes"
], function( Backbone, Marionette, player_options_html, PromiseFailReport, Parse, RoleHelper, TroupeHelper, Troupes) {

    var NoView = Marionette.ItemView.extend({
        template: _.template("Loading Your Troupes...")
    });

    var TroupeView = Marionette.ItemView.extend({
        template: function (serialized_model) {
            return _.template("<a class='ui-btn' href='#troupe/<%= objectId %>/characters/all'><%= name %></a>")(serialized_model);
        }
    });

    var TroupesView = Marionette.CollectionView.extend({
        tagName: 'div',
        childView: TroupeView,
        emptyView: NoView
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

            self.showChildView('troupcharactersquickaccess', new TroupesView({
                collection: self.troupes
            }), options);
            // Get the troupes first so we have them when the roles start
            TroupeHelper.get_troupes().fail(PromiseFailReport);
            RoleHelper.get_current_roles().fail(PromiseFailReport);;

            return self;
        },
    } );

    return View;
} );
