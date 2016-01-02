// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse",
    "vis"
], function ($, Backbone, Parse, vis) {

    var View = Backbone.View.extend({
        initialize: function () {
            _.bindAll(this, "select_node", "make_relationship");
            this.network = null;
            this.selected_nodes = [];
        },

        register: function(characters) {
            var self = this;
            self.characters = characters;
            var me_id = Parse.User.current().get("name") | "Me";
            var nodes = [{
                id: me_id,
                shape: 'box',
                label: me_id,
            }];
            var edges = [];
            var lastId;
            self.characters.each(function (character, i) {
                nodes.push({
                    id: character.id,
                    shape: 'box',
                    label: character.get("name")
                });
                /*
                edges.push({
                    from: me_id,
                    to: character.id,
                    color: "white"
                });
                */
                /*
                if (lastId) {
                    edges.push({
                        from: lastId,
                        to: character.id,
                        color: "white"
                    });
                }
                lastId = character.id;
                */
            });

            var queries = [];
            self.characters.each(function (character, i) {
                var q = new Parse.Query("CharacterRelationship");
                q.equalTo("from", character.id);
                queries.push(q.each(function (r) {
                    edges.push({
                        from: r.get("from"),
                        to: r.get("to"),
                        color: r.get("color"),
                    });
                }));
            });

            return Parse.Promise.when(queries).then(function() {
                self.data = {
                    nodes: nodes,
                    edges: edges,
                };
                return Parse.Promise.as(self.render());
            })
        },

        events: {
            "click .update": "update",
            "click .make-relationship": "make_relationship",
        },

        select_node: function(params) {
            var self = this;
            self.selected_nodes = params.nodes;
            if (self.selected_nodes.length >= 2) {
                self.$(".make-relationship").removeAttr("disabled");
            } else {
                self.$(".make-relationship").attr("disabled", "disabled");
            }
        },

        make_relationship: function() {
            var self = this;
            var promises = [];
            if (2 == self.selected_nodes.length) {
                var relationship = new Parse.Object("CharacterRelationship");
                relationship.set("from", self.selected_nodes[0]);
                relationship.set("to", self.selected_nodes[1]);
                relationship.set("color", "red");
                promises.push(relationship.save());
            } else {
                var new_relationships = [];
                while (self.selected_nodes.length != 0) {
                    var node = self.selected_nodes.pop();
                    _.each(self.selected_nodes, function (to_node) {
                        var relationship = new Parse.Object("CharacterRelationship");
                        relationship.set("from", node);
                        relationship.set("to", to_node);
                        relationship.set("color", "red");
                        new_relationships.push(relationship)
                    })
                }
                promises.push(Parse.Object.saveAll(new_relationships));
            }
            Parse.Promise.when(promises).then(function() {
                window.location.reload();
            })
        },

        build_network: function () {
            var self = this;

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
                },
                interaction: {
                    multiselect: true,
                }
            };

            if (self.network) {
                self.network.destroy();
            }
            self.network = new vis.Network(container, self.data, options);
            self.network.on("selectNode", self.select_node);
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
