// Mobile Router
// =============

// Includes file dependencies
define([
	"jquery",
	"parse",
    "pretty",
    "jscookie",
    "moment",
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
    "../views/SimpleTraitSpecializationView",
    "../views/CharacterLogView",
    "../views/CharacterHistoryView",
    "../views/SignupView",
    "../views/LoginView",
    "../views/CharacterExperienceView",
    "../views/UserSettingsProfileView",
    "../views/CharacterPortraitView",
    "../views/TroupeCharacterRelationshipsNetworkView",
    "../views/CharacterDeleteView",
    "../views/PlayerOptionsView",
    "../views/TroupeNewView",
    "../views/TroupesListView",
    "../views/TroupeView",
    "../views/TroupeAddStaffView",
    "../views/TroupeEditStaffView",
    "../models/Troupe",
    "../helpers/PromiseFailReport",
    "../views/TroupePortraitView",
    "text!../templates/footer.html",
], function ($,
             Parse,
             pretty,
             Cookie,
             moment,
             CategoryModel,
             CategoriesCollection,
             CategoryView,
             CharactersListView,
             Vampire,
             Vampires,
             CharacterView,
             SimpleTraitCategoryView,
             SimpleTraitNewView,
             SimpleTrait,
             SimpleTraitChangeView,
             VampireCreation,
             CharacterCreateView,
             CharacterNewView,
             CharacterPrintView,
             CharacterCostsView,
             SimpleTextNewView,
             SimpleTraitSpecializationView,
             CharacterLogView,
             CharacterHistoryView,
             SignupView,
             LoginView,
             CharacterExperienceView,
             UserSettingsProfileView,
             CharacterPortraitView,
             TroupeCharacterRelationshipsNetworkView,
             CharacterDeleteView,
             PlayerOptionsView,
             TroupeNewView,
             TroupesListView,
             TroupeView,
             TroupeAddStaffView,
             TroupeEditStaffView,
             Troupe,
             PromiseFailReport,
             TroupePortraitView,
             footer_html
) {

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
            this.simpleTraitSpecializationView = new SimpleTraitSpecializationView({el: "#simpletrait-specialization"});

            this.characterCreateView = new CharacterCreateView({el: "#character-create"});
            this.characterNewView = new CharacterNewView({el: "#character-new"});

            this.characterPrintView = new CharacterPrintView({el: "#printable-sheet"});
            this.characterCostsView = new CharacterCostsView({el: "#character-costs"});
            this.characterLogView = new CharacterLogView({el: "#character-log"});
            this.characterHistoryView = new CharacterHistoryView({el: "#character-history"});
            this.characterExperienceView = new CharacterExperienceView({el: "#experience-notations-all"});
            this.characterPortraitView = new CharacterPortraitView({el: "#character-portrait"});
            this.characterDeleteView = new CharacterDeleteView({el: "#character-delete"});

            this.loginView = new LoginView();
            this.signupView = new SignupView();

            this.userSettingsProfileView = new UserSettingsProfileView({el: "#user-settings-profile"});

            this.troupeCharacterRelationshipsNetworkView = new TroupeCharacterRelationshipsNetworkView({el: "#troupe-character-relationships-network"});

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

            "logout": "logout",
            "signup": "signup",

            "profile": "profile",

            // When #category? is on the url, the category method is called
            "category?:type": "category",

            "victims?:type": "victims",

            "characters?:type": "characters",

            "character?:id": "character",

            "simpletraits/:category/:cid/:type": "simpletraits",

            "simpletrait/:category/:cid/:bid": "simpletrait",
            "simpletrait/specialize/:category/:cid/:bid": "simpletraitspecialize",

            "charactercreate/:cid": "charactercreate",

            "charactercreate/simpletraits/:category/:cid/pick/:i": "charactercreatepicksimpletrait",
            "charactercreate/simpletraits/:category/:cid/unpick/:stid/:i": "charactercreateunpicksimpletrait",
            "charactercreate/simpletraits/:category/:cid/specialize/:stid/:i": "charactercreatespecializesimpletrait",
            "charactercreate/simpletext/:category/:target/:cid/pick": "charactercreatepicksimpletext",

            "characternew": "characternew",

            "character/:cid/print": "characterprint",
            "character/:cid/costs": "charactercosts",
            "character/:cid/log/:start/:changeBy": "characterlog",
            "character/:cid/history/:id": "characterhistory",
            "character/:cid/portrait": "characterportrait",
            "character/:cid/delete": "characterdelete",
            "character/:cid/troupes": "character_list_troupes",
            "character/:cid/troupes/leave": "character_pick_troupe_to_leave",
            "character/:cid/troupes/join": "character_pick_troupe_to_join",
            "character/:cid/troupe/:tid/join": "character_join_troupe",
            "character/:cid/troupe/:tid/leave": "character_leave_troupe",
            "character/:cid/troupe/:tid/show": "character_show_troupe",

            "character/:cid/experience/:start/:changeBy": "characterexperience",

            "troupe/new": "troupenew",
            "troupes": "troupes",
            "troupe/:id": "troupe",
            "troupe/:id/staff/add": "troupeaddstaff",
            "troupe/:id/staff/edit/:uid": "troupeeditstaff",
            "troupe/:id/characters/:type": "troupecharacters",
            "troupe/:id/characters/relationships/network": "troupe_relationship_network",
            "troupe/:id/character/:cid": "troupe_character",
            "troupe/:id/portrait": "troupe_portrait",

            "administration": "administration",
            "administration/characters/all": "administration_characters_all",
            "administration/character/:id": "administration_character"

        },

        // Home method
        home: function() {
            var self = this;
            this.enforce_logged_in().then(function () {
                var q = (new Parse.Query(Parse.Role)).equalTo("users", Parse.User.current());
                return q.count();
            }).then(function (count) {
                if (0 < count) {
                    Parse.User.current().set("storytellerinterface", true);
                } else {
                    Parse.User.current().set("storytellerinterface", false);
                }
                Parse.User.current().save();
                self.playerOptionsView = self.playerOptionsView || new PlayerOptionsView({el: "#player-options"}).render();
                $.mobile.changePage("#player-options", {reverse: false, changeHash: false});
            }).fail(PromiseFailReport);
        },

        logout: function() {
            Parse.User.logOut();
            window.location.hash = "";
            this.home();
        },

        signup: function() {
            if (!Parse.User.current()) {
                // Programatically changes to the categories page
                $.mobile.changePage("#signup", {reverse: false, changeHash: false});
            } else {
                window.location.hash = "";
            }
        },

        profile: function() {
            var self = this;
            self.enforce_logged_in().then(function() {
                self.set_back_button("#");
                self.userSettingsProfileView.render();
                $.mobile.changePage("#user-settings-profile", {reverse: false, changeHash: false});
            })
        },

        set_back_button: function(url) {
            $("#header-back-button").attr("href", url);
        },


        charactercosts: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, ["skills", "disciplines", "backgrounds"]).done(function (character) {
                self.characterCostsView.model = character;
                self.characterCostsView.render();
                $.mobile.changePage("#character-costs", {reverse: false, changeHash: false});
            });
        },

        characterlog: function(cid, start, changeBy) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").done(function (character) {
                self.characterLogView.register(character, start, changeBy);
                var activePage = $(".ui-page-active").attr("id");
                var r = $.mobile.changePage("#character-log", {reverse: false, changeHash: false});
                $.mobile.loading("hide");
            });
        },

        characterexperience: function(cid, start, changeBy) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").done(function (character) {
                self.characterExperienceView.register(character, start, changeBy);
                var activePage = $(".ui-page-active").attr("id");
                var r = $.mobile.changePage("#experience-notations-all", {reverse: false, changeHash: false});
                $.mobile.loading("hide");
            });
        },

        characterhistory: function(cid, id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").done(function (character) {
                self.characterHistoryView.register(character, id).then(function() {
                    var activePage = $(".ui-page-active").attr("id");
                    var r = $.mobile.changePage("#character-history", {reverse: false, changeHash: false});
                    $.mobile.loading("hide");
                });
            });
        },

        characterprint: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").done(function (character) {
                self.characterPrintView.model = character;
                self.characterPrintView.render();
                $.mobile.changePage("#printable-sheet", {reverse: false, changeHash: false});
            }).fail(PromiseFailReport);
        },

        characternew: function() {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#characters?all");
            self.characterNewView.model = new Vampire;
            self.characterNewView.render();
            $.mobile.changePage("#character-new", {reverse: false, changeHash: false});
        },

        charactercreate: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
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
            self.set_back_button("#charactercreate/" + cid);
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
                    specialCategory,
                    "#charactercreate/simpletraits/<%= self.category %>/<%= self.character.id %>/specialize/<%= b.linkId() %>/" + i);
                self.characterCreateView.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                $.mobile.changePage("#simpletrait-new", {reverse: false, changeHash: false});
            });
        },


        charactercreatespecializesimpletrait: function(category, cid, stid, i) {
            var self = this;
            i = _.parseInt(i);
            $.mobile.loading("show");
            self.set_back_button("#charactercreate/" + cid);
            self.get_character(cid, [category]).then(function (character) {
                return character.get_trait(category, stid);
            }).then(function (trait, character) {
                self.simpleTraitSpecializationView.register(
                    character,
                    trait,
                    category,
                    window.location.hash,
                    "#charactercreate/" + character.id
                );
                $.mobile.changePage("#simpletrait-specialization", {reverse: false, changeHash: false});
            }).fail(function(error) {
                console.log(error.message);
            });
        },

        charactercreateunpicksimpletrait: function(category, cid, stid, i) {
            var self = this;
            i = _.parseInt(i);
            $.mobile.loading("show");
            self.set_back_button("#charactercreate/" + cid);
            self.get_character(cid, [category]).then(function (character) {
                self.characterCreateView.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
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
            self.set_back_button("#charactercreate/" + cid);
            self.get_character(cid, [category]).done(function (c) {
                self.simpleTextNewView.register(c, category, target, "#charactercreate/" + c.id);
                self.characterCreateView.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                $.mobile.changePage("#simpletext-new", {reverse: false, changeHash: false});
            });
        },

        characterportrait: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid).done(function (c) {
                return self.characterPortraitView.register(c);
            }).always(function() {
                $.mobile.changePage("#character-portrait", {reverse: false, changeHash: false});
            });
        },

        show_character_helper: function(id, back_url) {
            $.mobile.loading("show");
            this.set_back_button(back_url);
            var c = this.character;
            this.get_character(id).done(function (m) {
                c.model = m;
                c.render();
                $.mobile.changePage("#character", {reverse: false, changeHash:false});
            }).fail(PromiseFailReport).fail(function () {
                window.location.hash = back_url;
            });
        },

        character: function(id) {
            this.show_character_helper(id, "#characters?all");
        },

        troupe_character: function(id, cid) {
            this.show_character_helper(cid, "#troupe/" + id + "/characters/all");
        },

        administration_character: function(id) {
            this.show_character_helper(id, "#administration/characters/all");
        },

        characterdelete: function(cid) {
            var self = this;
            $.mobile.loading("show");
            this.set_back_button("#character?" + cid);
            self.get_character(cid).done(function (c) {
                self.characterDeleteView.register(c, "#characters?all", function () {
                    return self.characters.collection.fetch({reset: true});
                });
                $.mobile.changePage("#character-delete", {reverse: false, changeHash: false});
            })
        },

        get_user_characters: function() {
            var self = this;
            var c = [];
            if (Parse.User.current().get("username") == "devuser") {
                c.sortbycreated = true;
            }
            var p = Parse.Promise.as([]);
            var q = new Parse.Query(Vampire);
            q.equalTo("owner", Parse.User.current());
            q.include("portrait");
            p = q.each(function (character) {
                c.push(character);
            }).then(function () {
                self.characters.collection.reset(c);
            })
            return p.done(function () {
                return Parse.Promise.as(self.characters.collection);
            })
        },

        get_troupe_characters: function(troupe) {
            var self = this;
            var c = [];
            if (Parse.User.current().get("username") == "devuser") {
                c.sortbycreated = true;
            }
            var p = Parse.Promise.as([]);
            var q = new Parse.Query(Vampire);
            q.equalTo("troupes", troupe);
            q.include("portrait");
            p = q.each(function (character) {
                c.push(character);
            }).then(function () {
                self.characters.collection.reset(c);
            })
            return p.done(function () {
                return Parse.Promise.as(self.characters.collection);
            })
        },

        get_administrator_characters: function() {
            var self = this;
            var c = [];
            if (Parse.User.current().get("username") == "devuser") {
                c.sortbycreated = true;
            }
            var p = Parse.Promise.as([]);
            var q = new Parse.Query(Vampire);
            //q.equalTo("owner", Parse.User.current());
            q.exists("owner");
            q.include("portrait");
            p = q.each(function (character) {
                c.push(character);
            }).then(function () {
                self.characters.collection.reset(c);
            })
            return p.done(function () {
                return Parse.Promise.as(self.characters.collection);
            })
        },

        characters: function(type) {
            var self = this;
            if ("all" == type) {
                self.set_back_button("#");
                $.mobile.loading("show");
                self.enforce_logged_in().then(function () {
                    return self.get_user_characters();
                }).then(function (characters) {
                    self.characters.register("#character?<%= character_id %>");
                    $.mobile.changePage("#characters-all", {reverse: false, changeHash: false});
                }).fail(PromiseFailReport).fail(function () {
                    $.mobile.loading("hide");
                });
            }
        },

        enforce_logged_in: function() {
            var self = this;
            if (!Parse.User.current()) {
                $.mobile.changePage("#login", {reverse: false, changeHash: false});
                $.mobile.loading("hide");
                var e = new Parse.Error(Parse.Error.USERNAME_MISSING, "Not logged in");
                return Parse.Promise.error(e);
            }
            $("#header-logout-button").attr("href", "#logout");
            self.footerTemplate = _.template(footer_html)();
            $('div[data-role="footer"] > div[data-role="navbar"]').html(self.footerTemplate).trigger('create');
            var u = Parse.User.current();
            trackJs.configure({
                userId: u.get("username"),
                sessionId: u.getSessionToken(),
            })
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
            return Vampire.get_character(id, categories, self);
        },

        simpletrait: function(category, cid, bid) {
            var self = this;
            self.set_back_button("#simpletraits/" + category + "/" + cid + "/all");
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

        simpletraitspecialize: function(category, cid, bid) {
            var self = this;
            self.set_back_button("#simpletraits/" + category + "/" + cid + "/all");
            self.get_character(cid, [category]).done(function(c) {
                character = c;
                return character.get_trait(category, bid);
            }).then(function (trait, character) {
                self.simpleTraitSpecializationView.register(character, trait, category);
                $.mobile.changePage("#simpletrait-specialization", {reverse: false, changeHash: false});
            }).fail(function(error) {
                console.log(error.message);
            });
        },

        simpletraits: function(category, cid, type) {
            var self = this;
            if ("all" == type) {
                $.mobile.loading("show");
                self.set_back_button("#character?" + cid);
                self.get_character(cid, [category]).done(function (c) {
                    self.simpleTraitCategoryView.register(c, category);
                    $.mobile.changePage("#simpletraitcategory-all", {reverse: false, changeHash: false});
                }).fail(function(error) {
                    console.log(error.message);
                });
            }

            if ("new" == type) {
                $.mobile.loading("show");
                self.set_back_button("#simpletraits/" + category + "/" + cid + "/all");
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

        },

        character_list_troupes: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid).then(function (c) {
                self.characterListTroupesView = self.characterListTroupesView || new TroupesListView({el: "#character-pick-troupe-to-join"}).render();
                return self.characterListTroupesView.register(
                    "#character/" + cid + "/troupe/<%= troupe_id %>/show",
                    function (q) {
                        q.containedIn("objectId", c.get_troupe_ids());
                    });
            }).then(function () {
                $.mobile.changePage("#character-pick-troupe-to-join", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        character_pick_troupe_to_leave: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid).then(function (c) {
                self.characterPickTroupeToLeaveView = self.characterPickTroupeToLeaveView || new TroupesListView({el: "#character-pick-troupe-to-leave"}).render();
                return self.characterPickTroupeToLeaveView.register(
                    "#character/" + cid + "/troupe/<%= troupe_id %>/leave",
                    function (q) {
                        q.containedIn("objectId", c.get_troupe_ids());
                    });
            }).then(function () {
                $.mobile.changePage("#character-pick-troupe-to-leave", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        character_pick_troupe_to_join: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid).then(function (c) {
                self.characterPickTroupeToJoinView = self.characterPickTroupeToJoinView || new TroupesListView({el: "#character-pick-troupe-to-join"}).render();
                return self.characterPickTroupeToJoinView.register(
                    "#character/" + cid + "/troupe/<%= troupe_id %>/join",
                    function (q) {
                        q.notContainedIn("objectId", c.get_troupe_ids());
                    });
            }).then(function () {
                $.mobile.changePage("#character-pick-troupe-to-join", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        character_show_troupe: function(cid, tid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            var character, troupe;
            self.get_character(cid).then(function (c) {
                character = c;
                var t = new Troupe({id: tid});
                return t.fetch();
            }).then(function (t) {
                troupe = t;
                return character.join_troupe(t);
            }).then(function () {
                self.troupeView = self.troupeView || new TroupeView({el: "#troupe"});
                self.troupeView.register(troupe);
                $.mobile.changePage("#troupe", {reverse: false, changeHash: false});
            }).fail(function () {
                window.location.hash = "#character?" + cid;
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        character_join_troupe: function(cid, tid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            var character, troupe;
            self.get_character(cid).then(function (c) {
                character = c;
                var t = new Troupe({id: tid});
                return t.fetch();
            }).then(function (t) {
                troupe = t;
                return character.join_troupe(t);
            }).then(function () {
                self.troupeView = self.troupeView || new TroupeView({el: "#troupe"});
                self.troupeView.register(troupe);
                $.mobile.changePage("#troupe", {reverse: false, changeHash: false});
            }).fail(function () {
                window.location.hash = "#character?" + cid;
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        character_leave_troupe: function(cid, tid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            var character, troupe;
            self.get_character(cid).then(function (c) {
                character = c;
                var t = new Troupe({id: tid});
                return t.fetch();
            }).then(function (t) {
                troupe = t;
                return character.leave_troupe(t);
            }).always(function() {
                window.location.hash = "#character?" + cid;
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        troupecharacters: function(id, type) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                return get_troupe;
            }).then(function (troupe, user) {
                return self.get_troupe_characters(troupe);
            }).then(function() {
                self.characters.register("#troupe/" + id + "/character/<%= character_id %>");
                $.mobile.changePage("#characters-all", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        troupe_portrait: function(id) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                return get_troupe;
            }).then(function (troupe) {
                self.troupePortraitView = self.troupePortraitView || new TroupePortraitView({el: "#troupe-portrait"});
                self.troupePortraitView.register(troupe);
                $.mobile.changePage("#troupe-portrait", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },


        troupe_relationship_network: function(id) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                return get_troupe;
            }).then(function (troupe, user) {
                return self.get_troupe_characters(troupe);
            }).then(function(characters) {
                return self.troupeCharacterRelationshipsNetworkView.register(characters);
            }).always(function() {
                $.mobile.changePage("#troupe-character-relationships-network", {reverse: false, changeHash: false});
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        troupeeditstaff: function(id, uid) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                var get_user = new Parse.Query("User").get(uid);
                return Parse.Promise.when(get_troupe, get_user);
            }).then(function (troupe, user) {
                self.troupeEditStaffView = self.troupeEditStaffView || new TroupeEditStaffView({el: "#troupe-edit-staff"});
                return self.troupeEditStaffView.register(troupe, user);
            }).then(function() {
                $.mobile.changePage("#troupe-edit-staff", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(function(error) {
                if (_.isArray(error)) {
                    _.each(error, function(e) {
                        console.log("Something failed" + e.message);
                    })
                } else {
                    console.log("error updating experience" + error.message);
                }
            });
        },

        troupeaddstaff: function(id) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#troupe/" + id);
                return new Parse.Query("Troupe").get(id);
            }).then(function (troupe) {
                self.troupeAddStaffView = self.troupeAddStaffView || new TroupeAddStaffView({el: "#troupe-add-staff"});
                self.troupeAddStaffView.register(troupe);
                $.mobile.changePage("#troupe-add-staff", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            });
        },

        troupe: function(id) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#troupes");
                return new Parse.Query("Troupe").get(id);
            }).then(function (troupe) {
                self.troupeView = self.troupeView || new TroupeView({el: "#troupe"});
                self.troupeView.register(troupe, !Parse.User.current().get("storytellerinterface"));
                $.mobile.changePage("#troupe", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            });
        },

        troupes: function() {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#administration");
                self.troupesListView = self.troupesListView || new TroupesListView({el: "#troupes-list"}).render();
                return self.troupesListView.register();
            }).then(function () {
                $.mobile.changePage("#troupes-list", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            });
        },

        troupenew: function() {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#troupes");
                self.troupeNewView = self.troupeNewView || new TroupeNewView({el: "#troupe-new"}).render();
                $.mobile.changePage("#troupe-new", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            });
        },

        administration: function() {
            var self = this;
            self.enforce_logged_in().then(function() {
                self.set_back_button("#");
                $.mobile.changePage("#administration", {reverse: false, changeHash: false});
            })
        },

        administration_characters_all: function() {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#administration");
                return self.get_administrator_characters();
            }).then(function() {
                self.characters.register("#administration/character/<%= character_id %>");
                $.mobile.changePage("#characters-all", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

    } );

    // Returns the Router class
    return CategoryRouter;

} );
