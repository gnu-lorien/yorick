// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "vis"
], function ($, Backbone, Parse, vis) {

    var View = Backbone.View.extend({
        initialize: function () {
            _.bindAll(this, "allowUpdates");
            this.network = null;
        },

        register: function(characters) {
            var self = this;
            self.characters = characters;

            return Parse.Promise.as(self.render());
        },

        events: {
            "submit form.profile-form": "update",
            "change #input-name": "allowUpdates",
            "change #input-email": "allowUpdates",
            "click .update": "update",
        },

        allowUpdates: function(e) {
            this.$(".update").removeAttr("disabled");
        },

        update: function(e) {
            var self = this;
            var user = Parse.User.current();
            user.set("realname", this.$("#input-name").val());
            user.set("email", this.$("#input-email").val());
            $.mobile.loading("show");
            self.undelegateEvents();
            user.save().then(function () {
                self.$(".error").hide();
                self.render();
            }, function(error) {
                self.$(".error").html(_.escape(error.message)).show();
            }).always(function() {
                $.mobile.loading("hide");
                self.delegateEvents();
            });

            return false;
        },

        build_network: function () {
            var self = this;
            var nodes = [];
            var edges = [];
            var lastId;
            self.characters.each(function (character, i) {
                nodes.push({
                    id: character.id,
                    shape: 'box',
                    label: character.get("name")
                });
                if (lastId) {
                    edges.push({
                        from: lastId,
                        to: character.id,
                        color: "white"
                    });
                }
                lastId = character.id;
            });

            var data = {
                nodes: nodes,
                edges: edges,
            };
            var jcontainer = self.$("#relationships-network");
            var container = jcontainer[0];
            var options = {
                /*
                 layout: {
                 hierarchical: {
                 direction: "LR"
                 }
                 },
                 */
                nodes: {
                    borderWidth: 4,
                    size: 30,
                    color: {
                        border: '#406897',
                        background: '#6AAFFF'
                    },
                    font: {color: '#eeeeee'},
                    shapeProperties: {
                        useBorderWithImage: true
                    }
                },
                edges: {
                    color: 'lightgray'
                }
            };

            if (self.network) {
                self.network.destroy();
            }
            self.network = new vis.Network(container, data, options);
            return self.network;
        },

        render: function () {
            var self = this;
            this.template = _.template($("#troupeCharacterRelationshipsNetworkView").html())({
                "user": Parse.User.current(),
                "characters": self.characters.models,
            });
            this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();
            self.build_network();
        }
    });

    // Returns the View class
    return View;

});
