// Includes file dependencies
define([
    "backbone",
    "marionette",
    "text!../templates/player_options.html",
    "../helpers/PromiseFailReport",
    "parse"
], function( Backbone, Marionette, player_options_html, PromiseFailReport, Parse) {

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
        childView: RoleView
    });

    var View = Marionette.LayoutView.extend( {
        template: _.template(player_options_html),
        regions: {
            troupcharactersquickaccess: "#troupe-characters-quick-access",
        },
        initialize: function(options) {
            var self = this;
            self.options = options || {};
            self.roles = new Backbone.Collection();
            _.bindAll(this, "setup", "update_roles");
        },
        update_roles: function() {
            var self = this;
            self._updateRoleWrapper = self._updateRoleWrapper || Parse.Promise.as();
            self._updateRoleWrapper = self._updateRoleWrapper.always(function () {
                var q = new Parse.Query(Parse.Role);
                q.each(function (role) {
                    var users_relation = role.getUsers();
                    var uq = users_relation.query();
                    uq.equalTo("objectId", Parse.User.current().id);
                    return uq.each(function (user) {
                        self.roles.add(role);
                    }).fail(function (error) {
                        console.log("Failed in promise for " + role.get("name"));
                    });
                }).fail(PromiseFailReport);
            });
            return self._updateRoleWrapper;
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
            self.update_roles();

            return self;
        },
    } );

    return View;
} );
