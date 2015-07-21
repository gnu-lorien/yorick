// Mobile Router
// =============

// Includes file dependencies
define([
	"jquery",
	"parse",
	"../models/CategoryModel",
	"../collections/CategoriesCollection",
	"../views/CategoryView",
    "../collections/BackgroundDescriptionsCollection",
    "../views/BackgroundNewView",
    "../views/CharactersListView",
    "../models/Vampire",
    "../collections/Vampires",
    "../views/CharacterView",
    "../views/BackgroundListView",
    "../views/BackgroundChangeView",
    "../views/SimpleTraitCategoryView",
    "../views/SimpleTraitNewView",
    "../models/SimpleTrait",
    "../views/SimpleTraitChangeView",
], function ($, Parse, CategoryModel, CategoriesCollection, CategoryView, BackgroundDescriptions, BackgroundsNewView, CharactersListView, Vampire, Vampires, CharacterView, BackgroundListView, BackgroundChangeView, SimpleTraitCategoryView, SimpleTraitNewView, SimpleTrait, SimpleTraitChangeView) {

    // Extends Backbone.Router
    var CategoryRouter = Parse.Router.extend( {

        // The Router constructor
        initialize: function() {

            this._character = null;

            _.bindAll(this, "get_character");

            // Instantiates a new Animal Category View
            this.animalsView = new CategoryView( { el: "#animals", collection: new CategoriesCollection( [] , { type: "animals" } ) } );

            // Instantiates a new Colors Category View
            this.colorsView = new CategoryView( { el: "#colors", collection: new CategoriesCollection( [] , { type: "colors" } ) } );

            // Instantiates a new Vehicles Category View
            this.vehiclesView = new CategoryView( { el: "#vehicles", collection: new CategoriesCollection( [] , { type: "vehicles" } ) } );

            this.backgroundsNew = new BackgroundsNewView( { el: "#backgrounds-new", collection: new BackgroundDescriptions()});

            this.characters = new CharactersListView( {el: "#characters-all", collection: new Vampires});

            this.character = new CharacterView({ el: "#character"});

            this.backgroundListView = new BackgroundListView({el: "#backgrounds-all"});
            this.backgroundChangeView = new BackgroundChangeView({el: "#background-change"});

            this.simpleTraitCategoryView = new SimpleTraitCategoryView({el: "#simpletraitcategory-all"});
            this.simpleTraitNewView = new SimpleTraitNewView({el: "#simpletrait-new"});
            this.simpleTraitChangeView = new SimpleTraitChangeView({el: "#simpletrait-change"});

            if (!Parse.User.current()) {
                Parse.User.logIn("devuser", "thedumbness");
            }

            // Tells Backbone to start watching for hashchange events
            Parse.history.start();
        },

        // Backbone.js Routes
        routes: {

            // When there is no hash bang on the url, the home method is called
            "": "home",

            // When #category? is on the url, the category method is called
            "category?:type": "category",

            "victims?:type": "victims",

            "backgrounds/:id/:type": "backgrounds",

            "characters?:type": "characters",

            "character?:id": "character",

            "background/:cid/:bid": "background",

            "simpletraits/:category/:cid/:type": "simpletraits",

            "simpletrait/:category/:cid/:bid": "simpletrait"
        },

        // Home method
        home: function() {

            // Programatically changes to the categories page
            $.mobile.changePage( "#categories" , { reverse: false, changeHash: false } );

        },

        character: function(id) {
            $.mobile.loading("show");
            var c = this.character;
            this.get_character(id).done(function (m) {
                c.model = m;
                c.render();
                $.mobile.changePage("#character", {reverse: false, changeHash:false});
            });
        },

        characters: function(type) {
            if ("all" == type) {
                $.mobile.loading("show");
                var c = this.characters.collection;
                var f = function() { $.mobile.changePage("#characters-all", {reverse: false, changeHash: false}); };
                if (!c.length) {
                    var q = new Parse.Query(Vampire);
                    q.equalTo("owner", Parse.User.current());
                    c.query = q;
                    c.fetch({add: true, merge: true}).done(f)
                } else {
                    f();
                }
            }
        },

        get_character: function(id, categories) {
            var self = this;
            categories = categories || [];
            if (self._character === null) {
                var q = new Parse.Query(Vampire);
                q.equalTo("owner", Parse.User.current());
                return q.get(id).then(function(m) {
                    self._character = m;
                    return self.get_character(id, categories);
                });
            }
            if (self._character.id != id) {
                return self._character.save().then(function() {
                    self._character = null;
                    return self.get_character(id, categories);
                })
            }
            if (0 !== categories.length) {

                var objectIds = _.chain(categories).map(function(category) {
                    return self._character.get(category);
                }).flatten().value();

                return Parse.Object.fetchAllIfNeeded(objectIds).then(function () {
                    return self.get_character(id, []);
                });
            }
            var p = new Parse.Promise;
            _.defer(function() {
                p.resolve(self._character);
            });
            return p;
        },

        background: function(cid, bid) {
            var self = this;
            self.get_character(cid, ["backgrounds"]).done(function(c) {
                var b = _.findWhere(c.get("backgrounds"), {id: bid});
                self.backgroundChangeView.register_character(c, b);
                $.mobile.changePage("#background-change", {reverse: false, changeHash: false});
            });
        },

        backgrounds: function(id, type) {
            var self = this;
            if ("all" == type) {
                $.mobile.loading("show");
                self.get_character(id, ["backgrounds"]).done(function (c) {
                    self.backgroundListView.register_character(c);
                    $.mobile.changePage("#backgrounds-all", {reverse: false, changeHash: false});
                });
            }
            if ("new" == type) {
                var bgn = this.backgroundsNew;
                if (!bgn.collection.length) {
                    $.mobile.loading("show");
                    bgn.collection.fetch({add: true}).done(function() {
                        self.get_character(id, ["backgrounds"]).done(function (c) {
                            bgn.register_character(c);
                            $.mobile.changePage("#backgrounds-new", {reverse: false, changeHash: false});
                        });
                    });
                } else {
                    $.mobile.changePage("#backgrounds-new", {reverse: false, changeHash:false});
                }
            }
        },

        simpletrait: function(category, cid, bid) {
            var self = this;
            self.get_character(cid, [category]).done(function(c) {
                var b = _.findWhere(c.get(category), {id: bid});
                self.simpleTraitChangeView.register_character(c, b);
                $.mobile.changePage("#simpletrait-change", {reverse: false, changeHash: false});
            });
        },

        simpletraits: function(category, cid, type) {
            var self = this;
            if ("all" == type) {
                $.mobile.loading("show");
                self.get_character(cid, [category]).done(function (c) {
                    self.simpleTraitCategoryView.register(c, category);
                    $.mobile.changePage("#simpletraitcategory-all", {reverse: false, changeHash: false});
                });
            }

            if ("new" == type) {
                $.mobile.loading("show");
                self.get_character(cid, [category]).done(function (c) {
                    self.simpleTraitNewView.register(c, category);
                    $.mobile.changePage("#simpletrait-new", {reverse: false, changeHash: false});
                });
            }
        },

        victims: function(type) {
            if ("all" == type) {
                $.mobile.changePage( "#victims-all", {reverse: false, changeHash: false});
            }
        },

        // Category method that passes in the type that is appended to the url hash
        category: function(type) {

            // Stores the current Category View  inside of the currentView variable
            var currentView = this[ type + "View" ];

            // If there are no collections in the current Category View
            if(!currentView.collection.length) {

                // Show's the jQuery Mobile loading icon
                $.mobile.loading( "show" );

                // Fetches the Collection of Category Models for the current Category View
                currentView.collection.fetch().done( function() {

                    // Programatically changes to the current categories page
                    $.mobile.changePage( "#" + type, { reverse: false, changeHash: false } );
    
                } );

            }

            // If there already collections in the current Category View
            else {

                // Programatically changes to the current categories page
                $.mobile.changePage( "#" + type, { reverse: false, changeHash: false } );

            }

        }

    } );

    // Returns the Router class
    return CategoryRouter;

} );