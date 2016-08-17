// Mobile Router
// =============

/* global _ */
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
    "../views/UsersView",
    "../views/TroupeEditStaffView",
    "../models/Troupe",
    "../helpers/PromiseFailReport",
    "../views/TroupePortraitView",
    "text!../templates/footer.html",
    "../views/AdministrationUserView",
    "../views/PasswordReset",
    "../views/CharacterApprovalView",
    "../helpers/InjectAuthData",
    //"../views/AdministrationUserPatronagesView",
    "../views/AdministrationUserView",
    "../collections/Patronages",
    "../views/PatronagesView",
    "../views/PatronageView",
    "../collections/Users",
    "../models/Patronage",
    "../helpers/UserWreqr",
    "../views/CharactersSummarizeListView",
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
             UsersView,
             TroupeEditStaffView,
             Troupe,
             PromiseFailReport,
             TroupePortraitView,
             footer_html,
             AdministrationUserView,
             PasswordResetView,
             CharacterApprovalView,
             InjectAuthData,
             AdministrationUserPatronagesView,
             Patronages,
             PatronagesView,
             PatronageView,
             Users,
             Patronage,
             UserChannel,
             CharactersSummarizeListView
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
            this.troupeCharacters = new CharactersListView({el: "#troupe-characters-all", collection: new Vampires});

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
            this.characterApprovalView = new CharacterApprovalView({el: "#character-approval"});

            this.loginView = new LoginView();
            this.signupView = new SignupView();

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
            "reset": "resetpassword",

            "profile": "profile",

            // When #category? is on the url, the category method is called
            "category?:type": "category",

            "victims?:type": "victims",

            "characters?:type": "characters",

            "character?:id": "character",

            "simpletraits/:category/:cid/:type": "simpletraits",

            "simpletrait/:category/:cid/:bid": "simpletrait",
            "simpletrait/specialize/:category/:cid/:bid": "simpletraitspecialize",
            
            "simpletext/:category/:target/:cid/pick": "simpletextpick",

            "charactercreate/:cid": "charactercreate",

            "charactercreate/simpletraits/:category/:cid/pick/:i": "charactercreatepicksimpletrait",
            "charactercreate/simpletraits/:category/:cid/unpick/:stid/:i": "charactercreateunpicksimpletrait",
            "charactercreate/simpletraits/:category/:cid/specialize/:stid/:i": "charactercreatespecializesimpletrait",
            "charactercreate/simpletext/:category/:target/:cid/pick": "charactercreatepicksimpletext",
            "charactercreate/complete/:cid": "charactercreatecomplete",

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
            "character/:cid/approval": "characterapproval",

            "character/:cid/experience/:start/:changeBy": "characterexperience",

            "troupe/new": "troupenew",
            "troupes": "troupes",
            "troupe/:id": "troupe",
            "troupe/:id/staff/add": "troupeaddstaff",
            "troupe/:id/staff/edit/:uid": "troupeeditstaff",
            "troupe/:id/characters/:type": "troupecharacters",
            "troupe/:id/characters/summarize/:type": "troupesummarizecharacters",
            "troupe/:id/characters/relationships/network": "troupe_relationship_network",
            "troupe/:id/character/:cid": "troupe_character",
            "troupe/:id/portrait": "troupe_portrait",

            "administration": "administration",
            "administration/characters/all": "administration_characters_all",
            "administration/character/:id": "administration_character",
            "administration/users/all": "administration_users",
            "administration/user/:id": "administration_user",
            "administration/patronages/user/:id": "administration_user_patronages",
            "administration/patronages": "administration_patronages",
            "administration/patronage/:id": "administration_patronage",
            "administration/patronages/new": "administration_patronage_new",
            "administration/patronages/new/:userid": "administration_patronage_new",

        },

        // Home method
        home: function() {
            var self = this;
            this.enforce_logged_in().then(function () {
                var q = (new Parse.Query(Parse.Role)).equalTo("users", Parse.User.current());
                return q.count();
            }).then(function (count) {
                var user = Parse.User.current();
                if (0 < count) {
                    user.set("storytellerinterface", true);
                } else {
                    user.set("storytellerinterface", false);
                }
                InjectAuthData(user);
                return user.save();
            }).then(function () {
                self.playerOptionsView = self.playerOptionsView || new PlayerOptionsView({el: "#player-options"}).render();
                $.mobile.changePage("#player-options", {reverse: false, changeHash: false});
            }).fail(PromiseFailReport);
        },

        logout: function() {
            Parse.User.logOut().always(function () {
                return hello('facebook').logout();
            }).always(function() {
                window.location.hash = "";
                window.location.reload();
            });
        },

        signup: function() {
            if (!Parse.User.current()) {
                // Programatically changes to the categories page
                $.mobile.changePage("#signup", {reverse: false, changeHash: false});
            } else {
                window.location.hash = "";
            }
        },

        resetpassword: function() {
            var self = this;
            self.resetPasswordView = self.resetPasswordView || new PasswordResetView({el: "#user-reset-password"});
            self.resetPasswordView.render();
            $.mobile.changePage("#user-reset-password", {reverse: false, changeHash: false});
        },

        profile: function() {
            var self = this;
            self.enforce_logged_in().then(function() {
                return UserChannel.get_users();
            }).then(function() {
                self.set_back_button("#");
                self.userSettingsProfileView = self.userSettingsProfileView || new UserSettingsProfileView().setup();
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
            self.get_character(cid, "all").then(function (character) {
                self.characterHistoryView.register(character, id).then(function () {
                    var activePage = $(".ui-page-active").attr("id");
                    var r = $.mobile.changePage("#character-history", {reverse: false, changeHash: false});
                    $.mobile.loading("hide");
                });
            }).fail(PromiseFailReport);
        },

        characterapproval: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").then(function (character) {
                self.characterApprovalView.register(character).then(function () {
                    var activePage = $(".ui-page-active").attr("id");
                    var r = $.mobile.changePage("#character-approval", {reverse: false, changeHash: false});
                    $.mobile.loading("hide");
                });
            }).fail(PromiseFailReport);
        },


        characterprint: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").done(function (character) {
                self.characterPrintView.character = character;
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
            }).fail(PromiseFailReport);
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
        
        charactercreatecomplete: function(cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#charactercreate/" + cid);
            self.get_character(cid).done(function (c) {
                return c.complete_character_creation();
            }).then(function () {
                window.location.hash = "#character?" + cid;
            }).fail(function (error) {
                alert(error.message);
                window.location.hash = "#charactercreate/" + cid;
            }).fail(PromiseFailReport);
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
                c.scroll_back_after_page_change();
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

        administration_users: function() {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#administration");
                self.troupeAddStaffView = self.troupeAddStaffView || new UsersView({el: "#troupe-add-staff"});
                self.troupeAddStaffView.register("#administration/user/<%= id %>");
                $.mobile.changePage("#troupe-add-staff", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            });
        },
        
        administration_user: function(id) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#administration/users/all");
                return Parse.Promise.when(
                    new Parse.Query("User").get(id),
                    self.get_patronages(),
                    UserChannel.get_users());
            }).then(function (user, patronages, users) {
                var my_patronages = _.select(patronages.models, "attributes.owner.id", id);
                self.administrationUserView = self.administrationUserView || new AdministrationUserView({patronages: patronages});
                self.administrationUserView.register(user);
                self.administrationUserView.patronages.reset(my_patronages);
                $.mobile.changePage("#administration-user-view", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },
        
        administration_user_patronages: function(id) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#administration/users/all");
                return new Parse.Query("User").get(id);
            }).then(function (user) {
                self.administrationUserPatronagesView = self.administrationUserPatronagesView || new AdministrationUserPatronagesView({el: "#administration-user-patronages-view"});
                self.administrationUserPatronagesView.register(user);
                $.mobile.changePage("#administration-user-patronages-view", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },
        
        administration_patronages: function() {
            var self = this;
            self.set_back_button("#administration");
            $.mobile.loading("show");
            self.enforce_logged_in().then(function () {
                return Parse.Promise.when(
                    self.get_patronages(),
                    UserChannel.get_users());
            }).then(function (patronages, users) {
                if (!_.has(self, "administrationPatronagesView")) {
                    self.administrationPatronagesView = new PatronagesView({el: "#administration-patronages-view-list", collection: patronages});
                    self.administrationPatronagesView.render();
                }
                $.mobile.changePage("#administration-patronages-view", {reverse: false, changeHash: false});
            }).fail(PromiseFailReport).fail(function () {
                $.mobile.loading("hide");
            });
        },

        administration_patronage: function(id) {
            var self = this;
            self.set_back_button("#administration/patronages");
            $.mobile.loading("show");
            self.enforce_logged_in().then(function () {
                return Parse.Promise.when(
                    self.get_patronage(id),
                    UserChannel.get_users());
            }).then(function (patronage, users) {
                if (self.administrationPatronageView) {
                    self.administrationPatronageView.remove();
                }
                self.administrationPatronageView = new PatronageView({model: patronage});
                self.administrationPatronageView.render();
                $("#administration-patronage-view").find("div[role='main']").append(self.administrationPatronageView.el);
                $.mobile.changePage("#administration-patronage-view", {reverse: false, changeHash: false});
            }).fail(PromiseFailReport).fail(function () {
                $.mobile.loading("hide");
            });
        },

        administration_patronage_new: function(userid) {
            var self = this;
            self.set_back_button("#administration/patronages");
            $.mobile.loading("show");
            self.enforce_logged_in().then(function () {
                return Parse.Promise.when(
                    new Patronage,
                    UserChannel.get_users());
            }).then(function (patronage, users) {
                if (self.administrationPatronageView) {
                    self.administrationPatronageView.remove();
                }
                patronage.set("owner", users.get(userid));
                self.administrationPatronageView = new PatronageView({model: patronage});
                self.administrationPatronageView.render();
                $("#administration-patronage-view").find("div[role='main']").append(self.administrationPatronageView.el);
                $.mobile.changePage("#administration-patronage-view", {reverse: false, changeHash: false});
            }).fail(PromiseFailReport).fail(function () {
                $.mobile.loading("hide");
            });
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

        get_troupe_characters: function(troupe, options) {
            var self = this;
            options = _.defaults({}, options, {
                includedeleted: false
            });
            var c = [];
            if (Parse.User.current().get("username") == "devuser") {
                c.sortbycreated = true;
            }
            var p = Parse.Promise.as([]);
            var q = new Parse.Query(Vampire);
            q.equalTo("troupes", troupe);
            q.include("portrait");
            q.include("owner");
            p = q.each(function (character) {
                var shouldinclude = true;
                console.log(JSON.stringify(options));
                if (!options.includedeleted) {
                    if (!character.has("owner")) {
                        shouldinclude = false;
                    }
                }
                if (shouldinclude) {
                    c.push(character);
                }
            }).then(function () {
                self.troupeCharacters.collection.reset(c);
            })
            return p.done(function () {
                return Parse.Promise.as(self.troupeCharacters.collection);
            })
        },
        
        get_troupe_summarize_characters: function(troupe, collection, options) {
            var self = this;
            options = _.defaults({}, options, {
                includedeleted: true,
            });
            var c = [];
            if (Parse.User.current().get("username") == "devuser") {
                c.sortbycreated = true;
            }
            var p = Parse.Promise.as([]);
            var q = new Parse.Query(Vampire);
            q.equalTo("troupes", troupe);
            q.include("portrait");
            q.include("owner");
            _.each(Vampire.all_simpletrait_categories(), function (e) {
                q.include(e[0]);
            })
            p = q.each(function (character) {
                var shouldinclude = true;
                if (!options.includedeleted) {
                    if (!character.has("owner")) {
                        shouldinclude = false;
                    }
                }
                if (shouldinclude) {
                    c.push(character);
                }
            }).then(function () {
                collection.reset(c);
            })
            return p.done(function () {
                return Parse.Promise.as(collection);
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
            q.include("owner");
            p = q.each(function (character) {
                c.push(character);
            }).then(function () {
                self.characters.collection.reset(c);
            })
            return p.done(function () {
                return Parse.Promise.as(self.characters.collection);
            })
        },

        get_patronages: function() {
            var self = this;
            var options = options || {};
            _.defaults(options, {update: true});
            self.patronages = self.patronages || new Patronages;
            return self.patronages.fetch();
        },

        get_patronage: function(id) {
            var self = this;
            if (!id) {
                return Parse.Promise.as(new Patronage);
            }
            if (_.has(self, "patronages")) {
                var have = self.patronages.get(id);
                if (have) {
                    return Parse.Promise.as(have);
                }
            }
            return new Parse.Query("Patronage").get(id);
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
            var u = Parse.User.current();
            $("#header-logout-button").attr("href", "#logout");
            $("#header-logout-button").text("Log Out " + u.get("username"));
            self.footerTemplate = _.template(footer_html)();
            $('div[data-role="footer"] > div[data-role="navbar"]').html(self.footerTemplate).trigger('create');
            trackJs.configure({
                userId: u.get("username"),
                sessionId: u.getSessionToken(),
            })
            var adminq = (new Parse.Query(Parse.Role)).equalTo("users", Parse.User.current()).equalTo("name", "Administrator");
            var siteadminq = (new Parse.Query(Parse.Role)).equalTo("users", Parse.User.current()).equalTo("name", "SiteAdministrator");
            var q = Parse.Query.or(adminq, siteadminq);
            return q.count().then(function (count) {
                var isadministrator = count ? true : false;
                var user = Parse.User.current();
                if (user.get("admininterface") != isadministrator) {
                    user.set("admininterface", isadministrator);
                    InjectAuthData(user);
                    return user.save();
                }
                return Parse.Promise.as(Parse.User.current());
            });
        },

        get_character: function(id, categories) {
            var self = this;
            return self.enforce_logged_in().then(function () {
                return self._get_character(id, categories);
            })
        },

        _check_character_mismatch: function(character) {
            if (character.get("owner").id != Parse.User.current().id) {
                return character.check_server_client_permissions_mismatch().then(function () {
                    if (character.is_mismatched) {
                        $.mobile.loading("show", {
                            text: "Server data mismatch. Attempting to correct.",
                            textVisible: true
                        });
                        return character.update_troupe_acls();
                    }
                    return Parse.Promise.as(character);
                });
            }
            return Parse.Promise.as(character);
        },

        _get_character: function(id, categories) {
            var self = this;
            return Vampire.get_character(id, categories, self)
                .then(self._check_character_mismatch);
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
        
        simpletextpick: function(category, target, cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, [category]).done(function (c) {
                self.simpleTextNewView.register(c, category, target, "#character?" + c.id);
                self.character.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                $.mobile.changePage("#simpletext-new", {reverse: false, changeHash: false});
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
                self.characterListTroupesView = self.characterListTroupesView || new TroupesListView({el: "#character-pick-troupe-to-show"}).render();
                return self.characterListTroupesView.register(
                    "#character/" + cid + "/troupe/<%= troupe_id %>/show",
                    function (q) {
                        q.containedIn("objectId", c.get_troupe_ids());
                    });
            }).then(function () {
                $.mobile.changePage("#character-pick-troupe-to-show", {reverse: false, changeHash: false});
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
                self.troupeCharacters = self.troupeCharacters || new CharactersListView({el: "#troupe-characters-all", collection: new Vampires});
                self.troupeCharacters.register("#troupe/" + id + "/character/<%= character_id %>");
                $.mobile.changePage("#troupe-characters-all", {reverse: false, changeHash: false});
            }).always(function() {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },
        
        troupesummarizecharacters: function(id, type) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function() {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                return get_troupe;
            }).then(function (troupe, user) {
                self.troupeSummarizeCharacters = self.troupeSummarizeCharacters || new CharactersSummarizeListView({collection: new Vampires}).setup();
                self.troupeCharacters.register("#troupe/" + id + "/character/<%= character_id %>");
                return self.get_troupe_summarize_characters(troupe, self.troupeSummarizeCharacters.collection);
            }).then(function() {
                $.mobile.changePage("#troupe-summarize-characters-all", {reverse: false, changeHash: false});
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
                self.troupeAddStaffView = self.troupeAddStaffView || new UsersView({el: "#troupe-add-staff"});
                self.troupeAddStaffView.register("#troupe/" + troupe.id + "/staff/edit/<%= id %>");
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
                var is_st = Parse.User.current().get("storytellerinterface");
                var is_ad = Parse.User.current().get("admininterface");
                self.troupeView.register(troupe, !(is_st || is_ad));
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
