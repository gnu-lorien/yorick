// Includes file dependencies
define([
    "backbone",
    "marionette",
    "text!../templates/player_options.html",
    "../helpers/PromiseFailReport",
    "parse",
    "../helpers/RoleWreqr"
], function( Backbone, Marionette, player_options_html, PromiseFailReport, Parse, RoleHelper) {

    var NoRolesView = Marionette.ItemView.extend({
        template: _.template("Loading Your Troupes...")
    });

    var RoleView = Marionette.ItemView.extend({
        template: function (serialized_model) {
            var id = serialized_model.attributes.name;
            id = id.split('_');
            id = id[1];
            serialized_model.troupe_id = id;
            return _.template("<a class='ui-btn' href='#troupe/<%= troupe_id %>/characters/all'><%= attributes.name %></a>")(serialized_model);
        }
    });

    var RolesView = Marionette.CollectionView.extend({
        tagName: 'div',
        childView: RoleView,
        emptyView: NoRolesView
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
            _.bindAll(this, "setup");
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

            self.showChildView('troupcharactersquickaccess', new RolesView({
                collection: self.roles
            }), options);
            RoleHelper.get_current_roles().fail(PromiseFailReport);

            return self;
        },
    } );

    return View;
} );
