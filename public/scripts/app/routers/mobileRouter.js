// Mobile Router
// =============

// Includes file dependencies
define([
	"jquery",
	"parse",
    "pretty",
    "jscookie",
	"../models/CategoryModel",
	"../collections/CategoriesCollection",
	"../views/CategoryView",
    "../views/CharactersListView",
    "../models/Vampire",
    "../collections/Vampires",
    "../views/CharacterView",
    "../views/SimpleTraitCategoryView",
    "../views/SimpleTraitNewView",
    "../models/SimpleTrait",
    "../views/SimpleTraitChangeView",
    "../models/VampireCreation",
    "../views/CharacterCreateView",
    "../views/CharacterNewView",
    "../views/CharacterPrintView",
    "../views/CharacterCostsView",
    "../views/SimpleTextNewView",
    "../views/LoginOrSignupView"
], function ($, Parse, pretty, Cookie, CategoryModel, CategoriesCollection, CategoryView, CharactersListView, Vampire, Vampires, CharacterView, SimpleTraitCategoryView, SimpleTraitNewView, SimpleTrait, SimpleTraitChangeView, VampireCreation, CharacterCreateView, CharacterNewView, CharacterPrintView, CharacterCostsView, SimpleTextNewView, LoginOrSignupView) {

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

            this.characters = new CharactersListView( {el: "#characters-all", collection: new Vampires});

            this.character = new CharacterView({ el: "#character"});

            this.simpleTraitCategoryView = new SimpleTraitCategoryView({el: "#simpletraitcategory-all"});
            this.simpleTraitNewView = new SimpleTraitNewView({el: "#simpletrait-new"});
            this.simpleTraitChangeView = new SimpleTraitChangeView({el: "#simpletrait-change"});
            this.simpleTextNewView = new SimpleTextNewView({el: "#simpletext-new"});

            this.characterCreateView = new CharacterCreateView({el: "#character-create"});
            this.characterNewView = new CharacterNewView({el: "#character-new"});

            this.characterPrintView = new CharacterPrintView({el: "#printable-sheet"});
            this.characterCostsView = new CharacterCostsView({el: "#character-costs"});

            this.loginView = new LoginOrSignupView();

            /*
            if (!Parse.User.current()) {
                Parse.User.logIn("devuser", "thedumbness");
            }
            */

            // Tells Backbone to start watching for hashchange events
            Parse.history.start();
        },

        // Backbone.js Routes
        routes: {

            // When there is no hash bang on the url, the home method is called
            "": "home",
            "start": "home",

            // When #category? is on the url, the category method is called
            "category?:type": "category",

            "victims?:type": "victims",

            "characters?:type": "characters",

            "character?:id": "character",

            "simpletraits/:category/:cid/:type": "simpletraits",

            "simpletrait/:category/:cid/:bid": "simpletrait",

            "charactercreate/:cid": "charactercreate",

            "charactercreate/simpletraits/:category/:cid/pick/:i": "charactercreatepicksimpletrait",
            "charactercreate/simpletraits/:category/:cid/unpick/:stid/:i": "charactercreateunpicksimpletrait",
            "charactercreate/simpletext/:category/:target/:cid/pick": "charactercreatepicksimpletext",

            "characternew": "characternew",

            "character/:cid/print": "characterprint",
            "character/:cid/costs": "charactercosts"

        },

        // Home method
        home: function() {

            // Programatically changes to the categories page
            $.mobile.changePage( "#categories" , { reverse: false, changeHash: false } );

        },

        charactercosts: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.get_character(cid, ["skills", "disciplines", "backgrounds"]).done(function (character) {
                self.characterCostsView.model = character;
                self.characterCostsView.render();
                $.mobile.changePage("#character-costs", {reverse: false, changeHash: false});
            });
        },

        characterprint: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.get_character(cid, ["skills", "disciplines", "backgrounds"]).done(function (character) {
                self.characterPrintView.model = character;
                self.characterPrintView.render();
                $.mobile.changePage("#printable-sheet", {reverse: false, changeHash: false});
            });
        },

        characternew: function() {
            var self = this;
            $.mobile.loading("show");
            self.characterNewView.model = new Vampire;
            self.characterNewView.render();
            $.mobile.changePage("#character-new", {reverse: false, changeHash: false});
        },

        charactercreate: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.get_character(cid, []).then(function (character) {
                return character.fetch_all_creation_elements();
            }).done(function (character) {
                self.characterCreateView.model = character;
                self.characterCreateView.render();
                self.characterCreateView.scroll_back_after_page_change();
                $.mobile.changePage("#character-create", {reverse: false, changeHash: false});
                $.mobile.loading("hide");
            }).fail(function (error) {
                console.log("Failed to get the character create page", pretty(error));
            });
        },

        charactercreatepicksimpletrait: function(category, cid, i) {
            var self = this;
            i = _.parseInt(i);
            $.mobile.loading("show");
            self.get_character(cid, [category]).done(function (c) {
                var specialCategory;
                if ("disciplines" == category) {
                    specialCategory = "in clan disciplines";
                }
                self.simpleTraitNewView.register(
                    c,
                    category,
                    i,
                    "#charactercreate/<%= self.character.id %>",
                    specialCategory);
                self.characterCreateView.backToTop = document.body.scrollTop;
                $.mobile.changePage("#simpletrait-new", {reverse: false, changeHash: false});
            });
        },

        charactercreateunpicksimpletrait: function(category, cid, stid, i) {
            var self = this;
            i = _.parseInt(i);
            $.mobile.loading("show");
            self.get_character(cid, [category]).then(function (character) {
                self.characterCreateView.backToTop = document.body.scrollTop;
                return character.unpick_from_creation(category, stid, i);
            }).done(function (c) {
                window.location.hash = "#charactercreate/" + c.id;
            }).fail(function(error) {
                console.log(error.message);
            });
        },

        charactercreatepicksimpletext: function(category, target, cid) {
            var self = this;
            $.mobile.loading("show");
            self.get_character(cid, [category]).done(function (c) {
                self.simpleTextNewView.register(c, category, target, "#charactercreate/" + c.id);
                self.characterCreateView.backToTop = document.body.scrollTop;
                $.mobile.changePage("#simpletext-new", {reverse: false, changeHash: false});
            });
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
            var self = this;
            if ("all" == type) {
                $.mobile.loading("show");
                self.enforce_logged_in().then(function () {
                    var c = self.characters.collection;
                    var f = function () {
                        $.mobile.changePage("#characters-all", {reverse: false, changeHash: false});
                    };
                    if (!c.length) {
                        var q = new Parse.Query(Vampire);
                        q.equalTo("owner", Parse.User.current());
                        c.query = q;
                        c.fetch({add: true, merge: true}).done(f)
                    } else {
                        f();
                    }
                });
            }
        },

        enforce_logged_in: function() {
            if (!Parse.User.current()) {
                $.mobile.changePage("#login-or-signup", {reverse: false, changeHash: false});
                $.mobile.loading("hide");
                var e = new Parse.Error(Parse.Error.USERNAME_MISSING, "Not logged in");
                return Parse.Promise.error(e);
            }
            console.log("Logged in as", Parse.User.current().get("username"));
            return Parse.Promise.as([]);
        },

        get_character: function(id, categories) {
            var self = this;
            return self.enforce_logged_in().then(function () {
                return self._get_character(id, categories);
            })
        },

        _get_character: function(id, categories) {
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
                }).flatten().without(undefined).filter(function(id) {
                    return id.id;
                }).value();

                return Parse.Object.fetchAllIfNeeded(objectIds).done(function () {
                    return self.get_character(id, []);
                });
            }
            /* FIXME: Hack to inject something that should be created with the character */
            return self._character.ensure_creation_rules_exist();
        },

        simpletrait: function(category, cid, bid) {
            var self = this;
            self.get_character(cid, [category]).done(function(c) {
                character = c;
                return character.get_trait(category, bid);
            }).then(function (trait, character) {
                self.simpleTraitChangeView.register(character, trait, category);
                $.mobile.changePage("#simpletrait-change", {reverse: false, changeHash: false});
            }).fail(function(error) {
                console.log(error.message);
            });
        },

        simpletraits: function(category, cid, type) {
            var self = this;
            if ("all" == type) {
                $.mobile.loading("show");
                self.get_character(cid, [category]).done(function (c) {
                    self.simpleTraitCategoryView.register(c, category);
                    $.mobile.changePage("#simpletraitcategory-all", {reverse: false, changeHash: false});
                }).fail(function(error) {
                    console.log(error.message);
                });
            }

            if ("new" == type) {
                $.mobile.loading("show");
                self.get_character(cid, [category]).done(function (c) {
                    self.simpleTraitNewView.register(c, category);
                    $.mobile.changePage("#simpletrait-new", {reverse: false, changeHash: false});
                }).fail(function(error) {
                    console.log(error.message);
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