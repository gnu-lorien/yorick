// Mobile Router
// =============

/* global _ */
// Includes file dependencies
define([
    "require",
    "jquery",
    "parse",
    "pretty",
    "jscookie",
    "moment",
    "backbone",
    "../collections/CategoriesCollection",
    "../views/CharactersListView",
    "../models/Vampire",
    "../models/Werewolf",
    "../collections/Vampires",
    "../views/CharacterView",
    "../models/SimpleTrait",
    "../models/VampireCreation",
    "../views/CharacterNewView",
    "../views/CharacterCostsView",
    "../views/SimpleTextNewView",
    "../views/SimpleTraitSpecializationView",
    "../views/CharacterLogView",
    "../views/SignupView",
    "../views/LoginView",
    "../views/CharacterExperienceView",
    "../views/CharacterPortraitView",
    "../views/CharacterDeleteView",
    "../views/PlayerOptionsView",
    "../views/TroupeEditStaffView",
    "../models/Troupe",
    "../helpers/PromiseFailReport",
    "../views/TroupePortraitView",
    "text!../templates/footer.html",
    "../helpers/InjectAuthData",
    "../collections/Patronages",
    "../collections/Users",
    "../models/Patronage",
    "../helpers/UserWreqr",
    "../views/CharacterRenameView",
    "../views/SimpleTraitNewSpecializationView",
    "../views/CharacterCreateSimpleTraitNewView",
    "../models/Werewolf",
    "../views/CharactersSelectToPrintView",
    "../views/CharacterLongTextView",
    "../models/ChangelingBetaSlice",
    "../helpers/ReportError"
], function (require,
    $,
    Parse,
    pretty,
    Cookie,
    moment,
    Backbone,
    CategoriesCollection,
    CharactersListView,
    Vampire,
    Werewolf,
    Vampires,
    CharacterView,
    SimpleTrait,
    VampireCreation,
    CharacterNewView,
    CharacterCostsView,
    SimpleTextNewView,
    SimpleTraitSpecializationView,
    CharacterLogView,
    SignupView,
    LoginView,
    CharacterExperienceView,
    CharacterPortraitView,
    CharacterDeleteView,
    PlayerOptionsView,
    TroupeEditStaffView,
    Troupe,
    PromiseFailReport,
    TroupePortraitView,
    footer_html,
    InjectAuthData,
    Patronages,
    Users,
    Patronage,
    UserChannel,
    CharacterRenameView,
    SimpleTraitNewSpecializationView,
    CharacterCreateSimpleTraitNewView,
    Werewolf,
    CharactersSelectToPrintView,
    CharacterLongTextView,
    ChangelingBetaSlice,
    ReportError
) {

    // Extends Backbone.Router
    var CategoryRouter = Parse.Router.extend({

        // The Router constructor
        initialize: function () {

            this._character = null;

            _.bindAll(this, "get_character");

            this.characters = new CharactersListView({ el: "#characters-all", collection: new Vampires });
            this.troupeCharacters = new CharactersListView({ el: "#troupe-characters-all", collection: new Vampires });

            this.characterMainPage = new CharacterView({ el: "#character" });

            this.simpleTextNewView = new SimpleTextNewView({ el: "#simpletext-new" });
            this.simpleTraitSpecializationView = new SimpleTraitSpecializationView({ el: "#simpletrait-specialization" });
            this.simpleTraitNewSpecializationView = new SimpleTraitNewSpecializationView({ el: "#simpletrait-new-specialization" });
            this.characterCreateSimpleTraitNewView = new CharacterCreateSimpleTraitNewView({ el: "#character-create-simpletrait-new" });

            this.characterNewView = new CharacterNewView({ el: "#character-new-form" });

            this.characterCostsView = new CharacterCostsView({ el: "#character-costs" });
            this.characterLogView = new CharacterLogView({ el: "#character-log" });
            this.characterExperienceView = new CharacterExperienceView({ el: "#experience-notations-all" });
            this.characterPortraitView = new CharacterPortraitView({ el: "#character-portrait" });
            this.characterDeleteView = new CharacterDeleteView({ el: "#character-delete" });

            this.loginView = new LoginView();
            this.signupView = new SignupView();

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

            "about": "about",
            "privacy": "privacy_policy",

            "logout": "logout",
            "signup": "signup",
            "reset": "resetpassword",

            "profile": "profile",

            "patronage/:id": "a_patronage",

            // When #category? is on the url, the category method is called
            "category?:type": "category",

            "victims?:type": "victims",

            "characters?:type": "characters",

            "character?:id": "character",

            "simpletraits/:category/:cid/:type": "simpletraits",

            "simpletrait/:category/:cid/:bid": "simpletrait",
            "simpletrait/specialize/:category/:cid/:bid": "simpletraitspecialize",
            "simpletrait/spacer/:category/:cid/:name/:value/:free_value/new": "simpletraitnew",
            "simpletrait/specialize/:category/:cid/:name/:value/:free_value/new": "simpletrait_new_specialize",

            "simpletext/:category/:target/:cid/pick": "simpletextpick",
            "simpletext/:category/:target/:cid/unpick": "simpletextunpick",

            "charactercreate/:cid": "charactercreate",

            "charactercreate/simpletraits/:category/:cid/pick/:i": "charactercreatepicksimpletrait",
            "charactercreate/simpletraits/:category/:cid/unpick/:stid/:i": "charactercreateunpicksimpletrait",
            "charactercreate/simpletraits/:category/:cid/specialize/:stid/:i": "charactercreatespecializesimpletrait",
            "charactercreate/simpletext/:category/:target/:cid/pick": "charactercreatepicksimpletext",
            "charactercreate/simpletext/:category/:target/:cid/unpick": "charactercreateunpicksimpletext",
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
            "character/:cid/rename": "characterrename",
            "character/:cid/approved": "character_show_approved",
            "character/:cid/extendedprinttext": "character_extended_print_text",
            "character/:cid/backgroundlt": "character_background_long_text",
            "character/:cid/noteslt": "character_notes_long_text",

            "character/:cid/experience/:start/:changeBy": "characterexperience",

            "troupe/new": "troupenew",
            "troupes": "troupes",
            "troupe/:id": "troupe",
            "troupe/:id/staff/add": "troupeaddstaff",
            "troupe/:id/staff/edit/:uid": "troupeeditstaff",
            "troupe/:id/characters/:type": "troupecharacters",
            "troupe/:id/characters/summarize/:type": "troupesummarizecharacters",
            "troupe/:id/characters/selecttoprint/:type": "troupe_select_to_print_characters",
            "troupe/:id/characters/print/:type": "troupe_print_characters",
            "troupe/:id/characters/relationships/network": "troupe_relationship_network",
            "troupe/:id/character/:cid": "troupe_character",
            "troupe/:id/portrait": "troupe_portrait",

            "administration": "administration",
            "administration/characters/all": "administration_characters_all",
            "administration/characters/summarize": "administration_characters_summarize",
            "administration/character/:id": "administration_character",
            "administration/users/all": "administration_users",
            "administration/user/:id": "administration_user",
            "administration/patronages/user/:id": "administration_user_patronages",
            "administration/patronages": "administration_patronages",
            "administration/patronagescsv": "administration_patronages_csv",
            "administration/patronage/:id": "administration_patronage",
            "administration/patronages/new": "administration_patronage_new",
            "administration/patronages/new/:userid": "administration_patronage_new",
            "administration/descriptions": "administration_descriptions",
            "administration/bnsctdbs_kith_rules": "administration_bnsctdbs_kith_rules",
            "administration/bnsmetv1_clan_rules": "administration_bnsmetv1_clan_rules",
            "administration/bnsmetv1_elder_discipline_rules": "administration_bnsmetv1_elder_discipline_rules",
            "administration/bnsmetv1_technique_rules": "administration_bnsmetv1_technique_rules",
            "administration/bnsmetv1_ritual_rules": "administration_bnsmetv1_ritual_rules",

            // Referendums
            "referendums": "referendums", // Listing of active referendums
            "referendum/:id": "referendum", // Description of an individual referendum with the ballot questions
            "administration/referendums": "administration_referendums", // Listing of active referendums
            "administration/referendum/:id": "administration_referendum", // Admin view of a referendum
        },

        // Home method
        home: function () {
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
                self.playerOptionsView = self.playerOptionsView || new PlayerOptionsView({ el: "#player-options" }).setup();
                $.mobile.changePage("#player-options", { reverse: false, changeHash: false });
            }).fail(PromiseFailReport);
        },

        logout: function () {
            Parse.User.logOut().always(function () {
                return hello('facebook').logout();
            }).always(function () {
                window.location.hash = "";
                window.location.reload();
            });
        },

        signup: function () {
            if (!Parse.User.current()) {
                // Programatically changes to the categories page
                $.mobile.changePage("#signup", { reverse: false, changeHash: false });
            } else {
                window.location.hash = "";
            }
        },

        about: function () {
            $.mobile.changePage("#about", { reverse: false, changeHash: false })
        },

        privacy_policy: function () {
            var self = this;
            require(["../views/PrivacyPolicyView"], function (PrivacyPolicyView) {
                self.privacyPolicyView = self.privacyPolicyView || new PrivacyPolicyView({ el: "#privacy" });
                self.privacyPolicyView.render();
                $.mobile.changePage("#privacy", { reverse: false, changeHash: false });
            });
        },

        resetpassword: function () {
            var self = this;
            require(["../views/PasswordReset"], function (PasswordResetView) {
                self.resetPasswordView = self.resetPasswordView || new PasswordResetView({ el: "#user-reset-password" });
                self.resetPasswordView.render();
                $.mobile.changePage("#user-reset-password", { reverse: false, changeHash: false });
            });
        },

        profile: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#");
            require(["../views/UserSettingsProfileView"], function (UserSettingsProfileView) {
                self.enforce_logged_in().then(function () {
                    return UserChannel.get_users();
                }).then(function () {
                    self.userSettingsProfileView = self.userSettingsProfileView || new UserSettingsProfileView().setup();
                    $.mobile.changePage("#user-settings-profile", { reverse: false, changeHash: false });
                });
            });
        },

        a_patronage: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#profile");
            require(["../views/PatronageView"], function (PatronageView) {
                self.enforce_logged_in().then(function () {
                    return Parse.Promise.when(
                        self.get_patronage(id),
                        UserChannel.get_users());
                }).then(function (patronage, users) {
                    if (self.administrationPatronageView) {
                        self.administrationPatronageView.remove();
                    }
                    self.administrationPatronageView = new PatronageView({ model: patronage });
                    self.administrationPatronageView.render();
                    $("#administration-patronage-view").find("div[role='main']").append(self.administrationPatronageView.el);
                    $.mobile.changePage("#administration-patronage-view", { reverse: false, changeHash: false });
                }).always(function () {
                    // The loader must come down whichever way the route
                    // ends. Hiding it only on the failure path leaves a
                    // stuck spinner that swallows the next click.
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        set_back_button: function (url) {
            $("#header-back-button").attr("href", url);
        },


        charactercosts: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, ["skills", "disciplines", "backgrounds"]).done(function (character) {
                self.characterCostsView.model = character;
                self.characterCostsView.render();
                $.mobile.changePage("#character-costs", { reverse: false, changeHash: false });
            });
        },

        // Both of these used to have no failure handler at all, so a denied
        // fetch left `ui-loading` spinning forever with no way out.
        // `show_character_helper` below is the shape to copy: hide the
        // loader, report, and send the user back where they came from.
        characterlog: function (cid, start, changeBy) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").done(function (character) {
                self.characterLogView.register(character, start, changeBy);
                $.mobile.changePage("#character-log", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(ReportError.on("Couldn't open the character log")).fail(function () {
                window.location.hash = "#characters?all";
            });
        },

        characterexperience: function (cid, start, changeBy) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").done(function (character) {
                self.characterExperienceView.register(character, start, changeBy);
                $.mobile.changePage("#experience-notations-all", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(ReportError.on("Couldn't open the experience history")).fail(function () {
                window.location.hash = "#characters?all";
            });
        },

        characterhistory: function (cid, id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            require(["../views/CharacterHistoryView"], function (CharacterHistoryView) {
                self.get_character(cid, "all").then(function (character) {
                    self.characterHistoryView = self.characterHistoryView || new CharacterHistoryView({ el: "#character-history" });
                    return self.characterHistoryView.register(character, id);
                }).then(function () {
                    var activePage = $(".ui-page-active").attr("id");
                    var r = $.mobile.changePage("#character-history", { reverse: false, changeHash: false });
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        characterapproval: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            require(["../views/CharacterApprovalView"], function (CharacterApprovalView) {
                self.get_character(cid, "all").then(function (character) {
                    return character.fetch_long_text("extended_print_text");
                }).then(function (character) {
                    self.characterApprovalView = self.characterApprovalView || new CharacterApprovalView({ el: "#character-approval > div[role='main']" });
                    return self.characterApprovalView.register(character);
                }).then(function () {
                    var activePage = $(".ui-page-active").attr("id");
                    var r = $.mobile.changePage("#character-approval", { reverse: false, changeHash: false });
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        withCharacterCreateView: function () {
            var self = this;
            var p = new Parse.Promise;
            require(["../views/CharacterCreateViewNew"], function (CharacterCreateViewNew) {
                self.characterCreateView = self.characterCreateView || new CharacterCreateViewNew({
                    el: "#character-create"
                });
                p.resolve(self.characterCreateView);
            });
            return p;
        },

        withCharacterPrintView: function (cb) {
            var self = this;
            require(["../views/CharacterPrintView"], function (CharacterPrintView) {
                self.characterPrintView = self.characterPrintView || new CharacterPrintView({ el: "#printable-sheet" });
                cb();
            });
        },

        character_show_approved: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.withCharacterPrintView(function () {
                self.get_character(cid, "all").then(function (character) {
                    return character.fetch_long_text("extended_print_text");
                }).then(function (character) {
                    return character.get_transformed_last_approved();
                }).then(function (transformed) {
                    if (null == transformed) {
                        $.mobile.changePage("#character-print-no-approval", { reverse: false, changeHash: false });
                    } else {
                        transformed.transform_description = [];
                        self.characterPrintView.setup({
                            character: transformed
                        });
                        $.mobile.changePage("#printable-sheet", { reverse: false, changeHash: false });
                    }
                }).fail(PromiseFailReport);
            });
        },

        characterrename: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").then(function (character) {
                self.characterRenameView = self.characterRenameView || new CharacterRenameView({ el: "#character-rename-main" });
                return self.characterRenameView.register(character);
            }).then(function () {
                $.mobile.changePage("#character-rename", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        characterprint: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.withCharacterPrintView(function () {
                self.get_character(cid, "all").then(function (character) {
                    return character.fetch_long_text("extended_print_text");
                }).then(function (character) {
                    character.transform_description = [];
                    self.characterPrintView.setup({
                        character: character
                    });
                    $.mobile.changePage("#printable-sheet", { reverse: false, changeHash: false });
                }).fail(PromiseFailReport);
            });
        },

        characternew: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#characters?all");
            // R38: this route had no `enforce_logged_in()` at all, so the
            // new-character form rendered in full for an anonymous visitor.
            // Both sessions working on this reached the same gate
            // independently; the anonymous-*write* hole behind it - `Vampire`
            // and its child classes granting create to "*" - is closed by the
            // security remediation merged alongside this, at the class-level
            // permissions and again in `require_a_user` in cloud/main.js.
            self.enforce_logged_in().then(function () {
                self.characterNewView.render();
                $.mobile.changePage("#character-new", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        charactercreate: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.withCharacterCreateView().then(function () {
                return self.get_character(cid, []);
            }).then(function (character) {
                return character.fetch_all_creation_elements();
            }).then(function (character) {
                self.characterCreateView.setup({
                    character: character
                })
                self.characterCreateView.scroll_back_after_page_change();
                $.mobile.changePage("#character-create", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        charactercreatepicksimpletrait: function (category, cid, i) {
            var self = this;
            i = _.parseInt(i);
            $.mobile.loading("show");
            self.set_back_button("#charactercreate/" + cid);
            self.withCharacterCreateView().then(function () {
                return self.get_character(cid, [category]);
            }).then(function (c) {
                // Creation pool enforcement used to be presentational only:
                // the wizard stops rendering a pick link once a pool is
                // exhausted, but this route checked nothing, so a hand-typed
                // URL walked the counter past zero and corrupted the
                // character. The check belongs here, where the decision is
                // actually made.
                return c.fetch_all_creation_elements().then(function () {
                    var creation = c.get("creation");
                    var remaining = creation ? creation.get(category + "_" + i + "_remaining") : undefined;
                    if (_.isNumber(remaining) && remaining <= 0) {
                        return Parse.Promise.error({
                            code: Parse.Error.VALIDATION_ERROR,
                            message: "No creation picks left for " + category + " at rating " + i + "."
                        });
                    }
                    return Parse.Promise.as(c);
                });
            }).then(function (c) {
                var specialCategory;
                if ("disciplines" == category) {
                    specialCategory = "in clan disciplines";
                } else if ("wta_gifts" == category) {
                    specialCategory = ["affinity", "show_only_value_1"];
                }
                self.characterCreateView.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                return self.characterCreateSimpleTraitNewView.register(
                    c,
                    category,
                    i,
                    "#charactercreate/<%= self.character.id %>",
                    specialCategory,
                    "#charactercreate/simpletraits/<%= self.category %>/<%= self.character.id %>/specialize/<%= b.linkId() %>/" + i);
            }).then(function () {
                $.mobile.changePage("#character-create-simpletrait-new", { reverse: false, changeHash: false });
            }).fail(ReportError.on("Couldn't open that pick")).fail(function () {
                $.mobile.loading("hide");
                window.location.hash = "#charactercreate/" + cid;
            });
        },


        charactercreatespecializesimpletrait: function (category, cid, stid, i) {
            var self = this;
            i = _.parseInt(i);
            $.mobile.loading("show");
            self.set_back_button("#charactercreate/" + cid);
            self.get_character(cid, [category]).then(function (character) {
                return character.get_trait(category, stid);
            }).then(function (trait, character) {
                return self.simpleTraitSpecializationView.register(
                    character,
                    trait,
                    category,
                    window.location.hash,
                    "#charactercreate/" + character.id
                );
            }).then(function () {
                $.mobile.changePage("#simpletrait-specialization", { reverse: false, changeHash: false });
            }).fail(function (error) {
                console.log(error.message);
            });
        },

        charactercreateunpicksimpletrait: function (category, cid, stid, i) {
            var self = this;
            i = _.parseInt(i);
            $.mobile.loading("show");
            self.set_back_button("#charactercreate/" + cid);
            self.withCharacterCreateView().then(function () {
                return self.get_character(cid, [category]);
            }).then(function (character) {
                self.characterCreateView.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                return character.unpick_from_creation(category, stid, i);
            }).done(function (c) {
                window.location.hash = "#charactercreate/" + c.id;
            }).fail(function (error) {
                console.log(error.message);
            });
        },

        charactercreatepicksimpletext: function (category, target, cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#charactercreate/" + cid);
            self.withCharacterCreateView().then(function () {
                return self.get_character(cid, [category])
            }).then(function (c) {
                self.characterCreateView.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                return self.simpleTextNewView.register(c, category, target, "#charactercreate/" + c.id);
            }).then(function () {
                $.mobile.changePage("#simpletext-new", { reverse: false, changeHash: false });
            });
        },

        charactercreateunpicksimpletext: function (category, target, cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#charactercreate/" + cid);
            self.get_character(cid, [category]).then(function (character) {
                self.character.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                return character.unpick_text(target);
            }).then(function (c) {
                window.location.hash = "#charactercreate/" + c.id;
            }).fail(PromiseFailReport);
        },

        charactercreatecomplete: function (cid) {
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

        characterportrait: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid).done(function (c) {
                return self.characterPortraitView.register(c);
            }).always(function () {
                $.mobile.changePage("#character-portrait", { reverse: false, changeHash: false });
            });
        },

        character_extended_print_text: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").then(function (character) {
                return character.fetch_long_text("extended_print_text");
            }).then(function (character) {
                character.transform_description = [];
                self.cept = self.cept || new CharacterLongTextView({
                    el: "#extended-print-text",
                });
                self.cept.setup(
                    character,
                    {
                        category: "extended_print_text",
                        pretty: "Extended Print Text",
                        description: "Additional text to display with your printed character sheet.",
                    });
                $.mobile.changePage("#extended-print-text", { reverse: false, changeHash: false });
            }).fail(PromiseFailReport);
        },

        character_background_long_text: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").then(function (character) {
                return character.fetch_long_text("background");
            }).then(function (character) {
                character.transform_description = [];
                self.clt = self.clt || new CharacterLongTextView({
                    el: "#long-text",
                });
                self.clt.setup(
                    character,
                    {
                        category: "background",
                        pretty: "Background",
                        description: "History and backstory for your character.",
                    });
                $.mobile.changePage("#long-text", { reverse: false, changeHash: false });
            }).fail(PromiseFailReport).always(function () {
                $.mobile.loading("hide");
            });
        },

        character_notes_long_text: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, "all").then(function (character) {
                return character.fetch_long_text("notes");
            }).then(function (character) {
                character.transform_description = [];
                self.clt = self.clt || new CharacterLongTextView({
                    el: "#long-text",
                });
                self.clt.setup(
                    character,
                    {
                        category: "notes",
                        pretty: "Notes",
                        description: "Notes about your character's interactions and progression",
                    });
                $.mobile.changePage("#long-text", { reverse: false, changeHash: false });
            }).fail(PromiseFailReport).always(function () {
                $.mobile.loading("hide");
            });
        },

        show_character_helper: function (id, back_url) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button(back_url);
            self.get_character(id).done(function (m) {
                self.characterMainPage.model = m;
                self.characterMainPage.render();
                self.characterMainPage.scroll_back_after_page_change();
                $.mobile.changePage("#character", { reverse: false, changeHash: false });
            }).then(function () {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport).fail(function () {
                window.location.hash = back_url;
            });
        },

        character: function (id) {
            this.show_character_helper(id, "#characters?all");
        },

        troupe_character: function (id, cid) {
            this.show_character_helper(cid, "#troupe/" + id + "/characters/all");
        },

        administration_character: function (id) {
            this.show_character_helper(id, "#administration/characters/all");
        },

        administration_users: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration");
            require(["../views/UsersView"], function (UsersView) {
                self.enforce_logged_in().then(function () {
                    var is_ad = Parse.User.current().get("admininterface");
                    if (is_ad) {
                        self.troupeAddStaffView = self.troupeAddStaffView || new UsersView({ el: "#troupe-add-staff" });
                        self.troupeAddStaffView.register("#administration/user/<%= id %>");
                        $.mobile.changePage("#troupe-add-staff", { reverse: false, changeHash: false });
                    }
                }).always(function () {
                    $.mobile.loading("hide");
                });
            });
        },

        administration_user: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration/users/all");
            require(["../views/AdministrationUserView"], function (AdministrationUserView) {
                self.enforce_logged_in().then(function () {
                    return Parse.Promise.when(
                        new Parse.Query("User").get(id),
                        self.get_patronages(),
                        UserChannel.get_users());
                }).then(function (user, patronages, users) {
                    var is_ad = Parse.User.current().get("admininterface");
                    if (is_ad) {
                        var my_patronages = _.select(patronages.models, "attributes.owner.id", id);
                        self.administrationUserView = self.administrationUserView || new AdministrationUserView({ patronages: patronages });
                        self.administrationUserView.register(user);
                        self.administrationUserView.patronages.reset(my_patronages);
                        $.mobile.changePage("#administration-user-view", { reverse: false, changeHash: false });
                    }
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        administration_user_patronages: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration/users/all");
            // R44: this used to construct `AdministrationUserView` against
            // `#administration-user-patronages-view`. That view's regions
            // (#abs-form, #patronage-list-region, ...) only exist inside
            // `#administration-user-view`, so Marionette threw on
            // construction - inside a legacy Parse.Promise callback, which
            // does not catch synchronous throws - and the route died before
            // `changePage`, leaving the loader stuck. The page was broken for
            // everyone, admin included. It renders the one thing it is named
            // for now: that user's patronages.
            require(["../views/PatronagesView"], function (PatronagesView) {
                var user;
                self.enforce_admin().then(function () {
                    return new Parse.Query("User").get(id);
                }).then(function (found) {
                    user = found;
                    return self.get_patronages();
                }).then(function (patronages) {
                    var theirs = _.filter(patronages.models, function (p) {
                        var owner = p.get("owner");
                        return owner && owner.id === id;
                    });
                    if (self.administrationUserPatronagesView) {
                        self.administrationUserPatronagesView.destroy();
                    }
                    self.administrationUserPatronagesView = new PatronagesView({
                        el: "#administration-user-patronages-list",
                        collection: new Patronages(theirs),
                        back_url_base: "#administration/patronage/"
                    });
                    self.administrationUserPatronagesView.render();
                    $("#administration-user-patronages-heading")
                        .text("Patronages for " + user.get("username"));
                    $("#administration-user-patronages-view").enhanceWithin();
                    $.mobile.changePage("#administration-user-patronages-view", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(self.admin_route_failed("Couldn't list that user's patronages"));
            });
        },

        administration_patronages: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration");
            require(["../views/PatronagesView"], function (PatronagesView) {
                self.enforce_logged_in().then(function () {
                    return Parse.Promise.when(
                        self.get_patronages(),
                        UserChannel.get_users());
                }).then(function (patronages, users) {
                    var is_ad = Parse.User.current().get("admininterface");
                    if (is_ad) {
                        // Singular/plural mismatch: this used to read
                        // `self.administrationPatronageView` - the *detail*
                        // view - so once any detail or new-patronage route had
                        // run, every later visit to the list route reused that
                        // object instead and the list stayed empty for the rest
                        // of the session.
                        self.administrationPatronagesView = self.administrationPatronagesView ||
                            new PatronagesView({
                                el: "#administration-patronages-view-list",
                                collection: patronages,
                                back_url_base: "#administration/patronage/"
                            }).render();
                        $.mobile.changePage("#administration-patronages-view", { reverse: false, changeHash: false });
                    }
                }).always(function () {
                    // The loader must come down whichever way the route
                    // ends. Hiding it only on the failure path leaves a
                    // stuck spinner that swallows the next click.
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        administration_patronages_csv: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration");
            require(["../views/PatronagesCSVView"], function (PatronagesCSVView) {
                self.enforce_logged_in().then(function () {
                    return Parse.Promise.when(
                        self.get_patronages(),
                        UserChannel.get_users());
                }).then(function (patronages, users) {
                    var is_ad = Parse.User.current().get("admininterface");
                    if (is_ad) {
                        // Deliberately rebuilt every visit: the view renders
                        // once at construction, so reusing it would show the
                        // collection as it stood on the first visit. (It had
                        // the same singular/plural typo R34 fixes on the list
                        // route above, but here the typo was load-bearing -
                        // `administrationPatronageCSVView` is never assigned,
                        // so the left-hand side always won.)
                        self.administrationPatronagesCSVView =
                            new PatronagesCSVView({ el: "#administration-patronages-view-csv-list", collection: patronages }).render();
                        $.mobile.changePage("#administration-patronages-view-csv", { reverse: false, changeHash: false });
                    }
                }).always(function () {
                    // The loader must come down whichever way the route
                    // ends. Hiding it only on the failure path leaves a
                    // stuck spinner that swallows the next click.
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },


        administration_patronage: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration/patronages");
            require(["../views/PatronageView"], function (PatronageView) {
                // R36: the list and CSV routes checked `admininterface`; the
                // individual patronage routes did not.
                self.enforce_admin().then(function () {
                    return Parse.Promise.when(
                        self.get_patronage(id),
                        UserChannel.get_users());
                }).then(function (patronage, users) {
                    if (self.administrationPatronageView) {
                        self.administrationPatronageView.remove();
                    }
                    self.administrationPatronageView = new PatronageView({ model: patronage });
                    self.administrationPatronageView.render();
                    $("#administration-patronage-view").find("div[role='main']").append(self.administrationPatronageView.el);
                    $.mobile.changePage("#administration-patronage-view", { reverse: false, changeHash: false });
                }).always(function () {
                    // The loader must come down whichever way the route
                    // ends. Hiding it only on the failure path leaves a
                    // stuck spinner that swallows the next click.
                    $.mobile.loading("hide");
                }).fail(self.admin_route_failed("Couldn't open that patronage"));
            });
        },

        administration_patronage_new: function (userid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration/patronages");
            require(["../views/PatronageView"], function (PatronageView) {
                // R36: as with the detail route above, this one had no gate.
                self.enforce_admin().then(function () {
                    return Parse.Promise.when(
                        new Patronage,
                        UserChannel.get_users());
                }).then(function (patronage, users) {
                    if (self.administrationPatronageView) {
                        self.administrationPatronageView.remove();
                    }
                    patronage.set("owner", users.get(userid));
                    self.administrationPatronageView = new PatronageView({ model: patronage });
                    self.administrationPatronageView.render();
                    $("#administration-patronage-view").find("div[role='main']").append(self.administrationPatronageView.el);
                    $.mobile.changePage("#administration-patronage-view", { reverse: false, changeHash: false });
                }).always(function () {
                    // The loader must come down whichever way the route
                    // ends. Hiding it only on the failure path leaves a
                    // stuck spinner that swallows the next click.
                    $.mobile.loading("hide");
                }).fail(self.admin_route_failed("Couldn't start a new patronage"));
            });
        },

        administration_descriptions: function () {
            var self = this;
            self.set_back_button("#administration");
            $.mobile.loading("show");
            require(["../views/DescriptionsView"], function (DescriptionsView) {
                self.enforce_admin().then(function () {
                    self.administrationDescriptionsView = self.administrationDescriptionsView ||
                        new DescriptionsView().setup();
                    return self.administrationDescriptionsView.update_categories();
                }).then(function () {
                    $.mobile.changePage("#administration-descriptions", { reverse: false, changeHash: false });
                }).fail(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        administration_bnsctdbs_kith_rules: function () {
            var self = this;
            self.set_back_button("#administration");
            $.mobile.loading("show");
            require(["../views/EditRules"], function (EditRules) {
                // R37: this page relied entirely on class-level
                // permissions, so it rendered in full for a non-admin who
                // then discovered the refusal only on submit - and, before
                // R2, not even then.
                self.enforce_admin().then(function () {
                    self.administrationEditRules = self.administrationEditRules ||
                        new EditRules().setup();
                    self.administrationEditRules.update_rule_name("bnsctdbs_KithRule");
                    return self.administrationEditRules.update_categories();
                }).then(function () {
                    $.mobile.changePage("#administration-descriptions", { reverse: false, changeHash: false });
                }).fail(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        administration_bnsmetv1_clan_rules: function () {
            var self = this;
            self.set_back_button("#administration");
            $.mobile.loading("show");
            require(["../views/EditRules"], function (EditRules) {
                // R37: this page relied entirely on class-level
                // permissions, so it rendered in full for a non-admin who
                // then discovered the refusal only on submit - and, before
                // R2, not even then.
                self.enforce_admin().then(function () {
                    self.administrationEditRules = self.administrationEditRules ||
                        new EditRules().setup();
                    self.administrationEditRules.update_rule_name("bnsmetv1_ClanRule");
                    return self.administrationEditRules.update_categories();
                }).then(function () {
                    $.mobile.changePage("#administration-descriptions", { reverse: false, changeHash: false });
                }).fail(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        administration_bnsmetv1_elder_discipline_rules: function () {
            var self = this;
            self.set_back_button("#administration");
            $.mobile.loading("show");
            require(["../views/EditRules"], function (EditRules) {
                // R37: this page relied entirely on class-level
                // permissions, so it rendered in full for a non-admin who
                // then discovered the refusal only on submit - and, before
                // R2, not even then.
                self.enforce_admin().then(function () {
                    self.administrationEditRules = self.administrationEditRules ||
                        new EditRules().setup();
                    self.administrationEditRules.update_rule_name("bnsmetv1_ElderDisciplineRule");
                    return self.administrationEditRules.update_categories();
                }).then(function () {
                    $.mobile.changePage("#administration-descriptions", { reverse: false, changeHash: false });
                }).fail(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        administration_bnsmetv1_technique_rules: function () {
            var self = this;
            self.set_back_button("#administration");
            $.mobile.loading("show");
            require(["../views/EditRules"], function (EditRules) {
                // R37: this page relied entirely on class-level
                // permissions, so it rendered in full for a non-admin who
                // then discovered the refusal only on submit - and, before
                // R2, not even then.
                self.enforce_admin().then(function () {
                    self.administrationEditRules = self.administrationEditRules ||
                        new EditRules().setup();
                    self.administrationEditRules.update_rule_name("bnsmetv1_TechniqueRule");
                    return self.administrationEditRules.update_categories();
                }).then(function () {
                    $.mobile.changePage("#administration-descriptions", { reverse: false, changeHash: false });
                }).fail(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        administration_bnsmetv1_ritual_rules: function () {
            var self = this;
            self.set_back_button("#administration");
            $.mobile.loading("show");
            require(["../views/EditRules"], function (EditRules) {
                // R37: this page relied entirely on class-level
                // permissions, so it rendered in full for a non-admin who
                // then discovered the refusal only on submit - and, before
                // R2, not even then.
                self.enforce_admin().then(function () {
                    self.administrationEditRules = self.administrationEditRules ||
                        new EditRules().setup();
                    self.administrationEditRules.update_rule_name("bnsmetv1_RitualRule");
                    return self.administrationEditRules.update_categories();
                }).then(function () {
                    $.mobile.changePage("#administration-descriptions", { reverse: false, changeHash: false });
                }).fail(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },


        characterdelete: function (cid) {
            var self = this;
            $.mobile.loading("show");
            this.set_back_button("#character?" + cid);
            self.get_character(cid).done(function (c) {
                self.characterDeleteView.register(c, "#characters?all", function () {
                    return self.characters.collection.fetch({ reset: true });
                });
                $.mobile.changePage("#character-delete", { reverse: false, changeHash: false });
            })
        },

        get_user_characters: function () {
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

        get_troupe_characters: function (troupe, options) {
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
            return p.then(function () {
                return Parse.Promise.as(self.troupeCharacters.collection);
            })
        },

        get_troupe_summarize_characters: function (troupe, collection) {
            var self = this;
            var c = [];
            if (Parse.User.current().get("username") == "devuser") {
                c.sortbycreated = true;
            }
            var p = Parse.Promise.as([]);

            var q = new Parse.Query(Werewolf);
            q.equalTo("troupes", troupe);
            q.include("portrait");
            q.include("owner");
            q.equalTo("type", "Werewolf");
            _.each(Werewolf.all_simpletrait_categories(), function (e) {
                q.include(e[0]);
            });

            $.mobile.loading("show", { text: "Fetching all characters", textVisible: true });
            p = q.each(function (character) {
                c.push(character);
                return character.get_long_text("extended_print_text");
            })

            var vq = new Parse.Query(Vampire);
            vq.equalTo("troupes", troupe);
            vq.include("portrait");
            vq.include("owner");
            vq.notEqualTo("type", "Werewolf");
            _.each(Vampire.all_simpletrait_categories(), function (e) {
                vq.include(e[0]);
            });

            p = p.then(function () {
                return vq.each(function (character) {
                    c.push(character);
                    return character.get_long_text("extended_print_text");
                });
            });

            p = p.then(function () {
                $.mobile.loading("show", { text: "Updating local character list", textVisible: true });
                collection.reset(c);
            })
            return p.then(function () {
                $.mobile.loading("show", { text: "Transitioning", textVisible: true });
                return Parse.Promise.as(collection);
            })
        },

        get_administrator_characters: function () {
            var self = this;
            var c = [];
            if (Parse.User.current().get("username") == "devuser") {
                c.sortbycreated = true;
            }
            var p = Parse.Promise.as([]);

            var q = new Parse.Query(Werewolf);
            q.exists("owner");
            q.include("portrait");
            q.include("owner");
            q.equalTo("type", "Werewolf");
            p = q.each(function (character) {
                c.push(character);
            })

            var vq = new Parse.Query(Vampire);
            vq.exists("owner");
            vq.include("portrait");
            vq.include("owner");
            vq.notEqualTo("type", "Werewolf");
            p = p.then(function () {
                return vq.each(function (character) {
                    c.push(character);
                });
            });

            p = p.then(function () {
                self.characters.collection.reset(c);
            })

            return p.then(function () {
                return Parse.Promise.as(self.characters.collection);
            })
        },

        get_administrator_summarize_characters: function () {
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
            _.each(Vampire.all_simpletrait_categories(), function (e) {
                q.include(e[0]);
            });
            _.each(Werewolf.all_simpletrait_categories(), function (e) {
                q.include(e[0]);
            });
            p = q.each(function (character) {
                c.push(character);
            }).then(function () {
                self.characters.collection.reset(c);
            })
            return p.then(function () {
                return Parse.Promise.as(self.characters.collection);
            })
        },

        get_patronages: function () {
            var self = this;
            var options = options || {};
            _.defaults(options, { update: true });
            self.patronages = self.patronages || new Patronages;
            return self.patronages.fetch();
        },

        get_patronage: function (id) {
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

        characters: function (type) {
            var self = this;
            if ("all" == type) {
                self.set_back_button("#");
                $.mobile.loading("show");
                self.enforce_logged_in().then(function () {
                    return self.get_user_characters();
                }).then(function (characters) {
                    self.characters.register("#character?<%= character_id %>");
                    $.mobile.changePage("#characters-all", { reverse: false, changeHash: false });
                }).always(function () {
                    // The loader must come down whichever way the route
                    // ends. Hiding it only on the failure path leaves a
                    // stuck spinner that swallows the next click.
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            }
        },

        enforce_logged_in: function () {
            var self = this;
            if (!Parse.User.current()) {
                $.mobile.changePage("#login", { reverse: false, changeHash: false });
                $.mobile.loading("hide");
                var e = new Parse.Error(Parse.Error.USERNAME_MISSING, "Not logged in");
                return Parse.Promise.error(e);
            }
            var u = Parse.User.current();
            $("#header-logout-button").attr("href", "#logout");
            $("#header-logout-button").text("Log Out " + u.get("username"));
            self.footerTemplate = _.template(footer_html)();
            $('div[data-role="footer"] > div[data-role="navbar"]').html(self.footerTemplate).trigger('create');
            if (typeof trackJs !== "undefined") {
                trackJs.configure({
                    userId: u.get("username"),
                    sessionId: u.getSessionToken(),
                });
            } else {
                console.log("Something is blocking trackJs. No user debugging available.");
            }
            var check_admin_status = true;
            if (self.lastadminchecktime) {
                var now = new Date();
                var timediff = now - self.lastadminchecktime;
                if (timediff < 300000) {
                    check_admin_status = false;
                }
            }
            if (check_admin_status) {
                self.lastadminchecktime = new Date();
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
            } else {
                return Parse.Promise.as(Parse.User.current());
            }
        },

        /**
         * Route-level administrator gate.
         *
         * Gating was inconsistent per route rather than absent by design:
         * `administration_users` and `administration_user` checked
         * `admininterface`, while `#administration` itself - the front door
         * listing all thirteen destinations - checked nothing, and neither did
         * the five rule editors, the Descriptions admin, the individual
         * patronage routes, or the referendum admin. Most destinations are
         * protected server-side, so the gap was information disclosure and
         * confusion rather than a breach; but a page a non-admin cannot use
         * should not render for them, and discovering the refusal only on
         * submit is worse than being told up front.
         */
        enforce_admin: function () {
            var self = this;
            return self.enforce_logged_in().then(function () {
                if (Parse.User.current().get("admininterface")) {
                    return Parse.Promise.as(Parse.User.current());
                }
                return Parse.Promise.error(new Parse.Error(
                    Parse.Error.OPERATION_FORBIDDEN,
                    "Administrator access is required for that page."));
            });
        },

        /** The shared tail for an admin route: report, drop the loader, leave. */
        admin_route_failed: function (context) {
            return function (error) {
                $.mobile.loading("hide");
                if (Parse.User.current()) {
                    // A logged-out visitor is already on #login courtesy of
                    // `enforce_logged_in`; do not bounce them again.
                    window.location.hash = "";
                }
                return ReportError(error, context);
            };
        },

        get_character: function (id, categories) {
            var self = this;
            return self.enforce_logged_in().then(function () {
                return self._get_character(id, categories);
            })
        },

        _check_character_mismatch: function (character) {
            var owner = character.get("owner");
            if (!_.isUndefined(owner) && owner.id != Parse.User.current().id) {
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

        /**
         * R29. Take a newer version of the character, without ever discarding
         * unsaved work.
         *
         * `Model.get_character` caches the character on this router and, for
         * the same id, never re-reads it: a storyteller who loaded a character
         * before the player's latest change kept rendering the old trait
         * values for as long as the page lived - so they could approve a change
         * their screen had never shown them. The suites work around it by
         * reloading the whole app between cycles.
         *
         * The rule this follows is that nothing unsaved may be lost. If the
         * local copy has pending edits they are saved *and waited on* first;
         * Parse sends only the dirty keys, so the other session's changes to
         * other fields survive the merge. Only then is the cache dropped, which
         * makes the caller re-run its own query - `fetch()` would not do, since
         * it would quietly drop the `include`s the sheet needs for the portrait
         * and owner. The user is told the view was behind rather than having it
         * change under them silently.
         *
         * A failed check never blocks the page: if the probe cannot run, the
         * cached copy is used exactly as before.
         */
        _refresh_if_stale: function (id) {
            var self = this;
            var cached = self._character;
            if (!cached || cached.id !== id) {
                return Parse.Promise.as(null);
            }
            return new Parse.Query("Vampire").select("updatedAt").get(id).then(function (latest) {
                var mine = cached.updatedAt ? cached.updatedAt.getTime() : 0;
                var theirs = latest.updatedAt ? latest.updatedAt.getTime() : 0;
                if (theirs <= mine) {
                    return Parse.Promise.as(null);
                }
                var flush = cached.dirty() ? cached.save() : Parse.Promise.as(cached);
                return flush.then(function () {
                    self._character = null;
                    ReportError(
                        "This character changed somewhere else while you had it open, " +
                        "so the newest version has been loaded.",
                        "Refreshed");
                    return Parse.Promise.as(null);
                });
            }, function () {
                return Parse.Promise.as(null);
            });
        },

        _get_character: function (id, categories) {
            var self = this;
            return self._refresh_if_stale(id).then(function () {
                return self._get_character_from_cache(id, categories);
            });
        },

        _get_character_from_cache: function (id, categories) {
            var self = this;
            if (self.last_fetched_character_id == id) {
                var p;
                if (self.last_fetched_character_type == "Werewolf") {
                    p = Werewolf.get_character(id, categories, self);
                } else if (self.last_fetched_character_type == "ChangelingBetaSlice") {
                    p = ChangelingBetaSlice.get_character(id, categories, self);
                } else {
                    p = Vampire.get_character(id, categories, self);
                }
                return p.then(self._check_character_mismatch);
            } else {
                var q = new Parse.Query("Vampire").select("type");
                return q.get(id).then(function (c) {
                    self.last_fetched_character_id = id;
                    self.last_fetched_character_type = c.get("type");
                    if (c.get("type") == "Werewolf") {
                        return Werewolf.get_character(id, categories, self);
                    } else if (c.get("type") == "ChangelingBetaSlice") {
                        return ChangelingBetaSlice.get_character(id, categories, self);
                    } else {
                        return Vampire.get_character(id, categories, self);
                    }
                }).then(self._check_character_mismatch);
            }
        },

        withSimpleTraitChangeView: function (cb) {
            var self = this;
            require(["../views/SimpleTraitChangeView"], function (SimpleTraitChangeView) {
                self.simpleTraitChangeView = self.simpleTraitChangeView || new SimpleTraitChangeView({ el: "#simpletrait-change" });
                cb();
            });
        },

        simpletrait: function (category, cid, bid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#simpletraits/" + category + "/" + cid + "/all");
            self.withSimpleTraitChangeView(function () {
                self.get_character(cid, [category]).done(function (character) {
                    return character.get_trait(category, bid);
                }).then(function (trait, character) {
                    self.simpleTraitChangeView.register(character, trait, category);
                    $.mobile.changePage("#simpletrait-change", { reverse: false, changeHash: false });
                }).fail(function (error) {
                    console.log(error.message);
                });
            });
        },

        simpletraitspecialize: function (category, cid, bid) {
            var self = this;
            self.set_back_button("#simpletraits/" + category + "/" + cid + "/all");
            self.get_character(cid, [category]).done(function (c) {
                character = c;
                return character.get_trait(category, bid);
            }).then(function (trait, character) {
                return self.simpleTraitSpecializationView.register(
                    character,
                    trait,
                    category,
                    "#simpletraits/<%= self.category %>/<%= self.character.id %>/all",
                    "#simpletraits/<%= self.category %>/<%= self.character.id %>/all"
                );
            }).then(function () {
                $.mobile.changePage("#simpletrait-specialization", { reverse: false, changeHash: false });
            }).fail(function (error) {
                console.log(error.message);
            });
        },

        simpletraitnew: function (category, cid, name, value, free_value) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#simpletraits/" + category + "/" + cid + "/all");
            self.withSimpleTraitChangeView(function () {
                self.get_character(cid, [category]).then(function (character) {
                    var trait = new SimpleTrait({
                        name: decodeURIComponent(name),
                        value: _.parseInt(value),
                        free_value: _.parseInt(free_value),
                        category: category,
                    });
                    self.simpleTraitChangeView.register(character, trait, category);
                    $.mobile.changePage("#simpletrait-change", { reverse: false, changeHash: false });
                }).fail(function (error) {
                    console.log(error.message);
                });
            });
        },

        simpletrait_new_specialize: function (category, cid, name, value, free_value) {
            var self = this;
            self.set_back_button("#simpletraits/" + category + "/" + cid + "/all");
            self.get_character(cid, [category]).then(function (character) {
                var trait = new SimpleTrait({
                    name: decodeURIComponent(name),
                    value: _.parseInt(value),
                    free_value: _.parseInt(free_value)
                })
                return self.simpleTraitNewSpecializationView.register(
                    trait,
                    category,
                    "#simpletraits/<%= self.category %>/" + cid + "/all",
                    "#simpletrait/spacer/<%= self.category %>/" + cid + "/<%= b.get('name') %>/<%= b.get('value') %>/<%= b.get('free_value') %>/new"
                );
            }).then(function () {
                $.mobile.changePage("#simpletrait-new-specialization", { reverse: false, changeHash: false });
            }).fail(function (error) {
                console.log(error.message);
            });
        },

        simpletextpick: function (category, target, cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, [category]).then(function (c) {
                self.character.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                return self.simpleTextNewView.register(c, category, target, "#character?" + c.id);
            }).then(function () {
                $.mobile.changePage("#simpletext-new", { reverse: false, changeHash: false });
            });
        },

        simpletextunpick: function (category, target, cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            self.get_character(cid, [category]).then(function (character) {
                self.character.backToTop = document.documentElement.scrollTop || document.body.scrollTop;
                return character.unpick_text(target);
            }).then(function (c) {
                window.location.hash = "#character?" + c.id;
            }).fail(PromiseFailReport);
        },

        simpletraits: function (category, cid, type) {
            var self = this;
            if ("all" == type) {
                $.mobile.loading("show");
                self.set_back_button("#character?" + cid);
                require(["../views/SimpleTraitCategoryView"], function (SimpleTraitCategoryView) {
                    self.get_character(cid, [category]).done(function (c) {
                        self.simpleTraitCategoryView = self.simpleTraitCategoryView || new SimpleTraitCategoryView({ el: "#simpletraitcategory-all" });
                        self.simpleTraitCategoryView.register(c, category);
                        $.mobile.changePage("#simpletraitcategory-all", { reverse: false, changeHash: false });
                    }).fail(function (error) {
                        console.log(error.message);
                    });
                });
            }

            if ("new" == type) {
                $.mobile.loading("show");
                self.set_back_button("#simpletraits/" + category + "/" + cid + "/all");
                require(["../views/SimpleTraitNewView"], function (SimpleTraitNewView) {
                    self.simpleTraitNewView = self.simpleTraitNewView || new SimpleTraitNewView({ el: "#simpletrait-new > div[role='main']" });
                    self.get_character(cid, [category]).done(function (c) {
                        return self.simpleTraitNewView.register(c, category);
                    }).then(function () {
                        $.mobile.changePage("#simpletrait-new", { reverse: false, changeHash: false });
                    }).fail(function (error) {
                        console.log(error.message);
                    });
                });
            }
        },

        victims: function (type) {
            if ("all" == type) {
                $.mobile.changePage("#victims-all", { reverse: false, changeHash: false });
            }
        },

        // Category method that passes in the type that is appended to the url hash
        category: function (type) {

            // Stores the current Category View  inside of the currentView variable
            var currentView = this[type + "View"];

            // If there are no collections in the current Category View
            if (!currentView.collection.length) {

                // Show's the jQuery Mobile loading icon
                $.mobile.loading("show");

                // Fetches the Collection of Category Models for the current Category View
                currentView.collection.fetch().done(function () {

                    // Programatically changes to the current categories page
                    $.mobile.changePage("#" + type, { reverse: false, changeHash: false });

                });

            }

            // If there already collections in the current Category View
            else {

                // Programatically changes to the current categories page
                $.mobile.changePage("#" + type, { reverse: false, changeHash: false });

            }

        },

        character_list_troupes: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            require(["../views/TroupesListView"], function (TroupesListView) {
                self.get_character(cid).then(function (c) {
                    self.characterListTroupesView = self.characterListTroupesView || new TroupesListView({ el: "#character-pick-troupe-to-show" }).render();
                    return self.characterListTroupesView.register(
                        "#character/" + cid + "/troupe/<%= troupe_id %>/show",
                        function (q) {
                            q.containedIn("objectId", c.get_troupe_ids());
                        });
                }).then(function () {
                    $.mobile.changePage("#character-pick-troupe-to-show", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        character_pick_troupe_to_leave: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            require(["../views/TroupesListView"], function (TroupesListView) {
                self.get_character(cid).then(function (c) {
                    self.characterPickTroupeToLeaveView = self.characterPickTroupeToLeaveView || new TroupesListView({ el: "#character-pick-troupe-to-leave" }).render();
                    return self.characterPickTroupeToLeaveView.register(
                        "#character/" + cid + "/troupe/<%= troupe_id %>/leave",
                        function (q) {
                            q.containedIn("objectId", c.get_troupe_ids());
                        });
                }).then(function () {
                    $.mobile.changePage("#character-pick-troupe-to-leave", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        character_pick_troupe_to_join: function (cid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            require(["../views/TroupesListView"], function (TroupesListView) {
                self.get_character(cid).then(function (c) {
                    self.characterPickTroupeToJoinView = self.characterPickTroupeToJoinView || new TroupesListView({ el: "#character-pick-troupe-to-join" }).render();
                    return self.characterPickTroupeToJoinView.register(
                        "#character/" + cid + "/troupe/<%= troupe_id %>/join",
                        function (q) {
                            q.notContainedIn("objectId", c.get_troupe_ids());
                        });
                }).then(function () {
                    $.mobile.changePage("#character-pick-troupe-to-join", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        character_show_troupe: function (cid, tid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            require(["../views/TroupeView"], function (TroupeView) {
                var character, troupe;
                self.get_character(cid).then(function (c) {
                    character = c;
                    var t = new Troupe({ id: tid });
                    return t.fetch();
                }).then(function (t) {
                    troupe = t;
                    self.troupeView = self.troupeView || new TroupeView({ el: "#troupe" });
                    self.troupeView.register(troupe);
                    $.mobile.changePage("#troupe", { reverse: false, changeHash: false });
                }).fail(function () {
                    window.location.hash = "#character?" + cid;
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        character_join_troupe: function (cid, tid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            require(["../views/TroupeView"], function (TroupeView) {
                var character, troupe;
                self.get_character(cid).then(function (c) {
                    character = c;
                    var t = new Troupe({ id: tid });
                    return t.fetch();
                }).then(function (t) {
                    troupe = t;
                    return character.join_troupe(t);
                }).then(function () {
                    self.troupeView = self.troupeView || new TroupeView({ el: "#troupe" });
                    self.troupeView.register(troupe);
                    $.mobile.changePage("#troupe", { reverse: false, changeHash: false });
                }).fail(function () {
                    window.location.hash = "#character?" + cid;
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        character_leave_troupe: function (cid, tid) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#character?" + cid);
            var character, troupe;
            self.get_character(cid).then(function (c) {
                character = c;
                var t = new Troupe({ id: tid });
                return t.fetch();
            }).then(function (t) {
                troupe = t;
                return character.leave_troupe(t);
            }).always(function () {
                window.location.hash = "#character?" + cid;
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        troupecharacters: function (id, type) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function () {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                return get_troupe;
            }).then(function (troupe, user) {
                return self.get_troupe_characters(troupe);
            }).then(function () {
                self.troupeCharacters = self.troupeCharacters || new CharactersListView({ el: "#troupe-characters-all", collection: new Vampires });
                self.troupeCharacters.register("#troupe/" + id + "/character/<%= character_id %>");
                $.mobile.changePage("#troupe-characters-all", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        troupesummarizecharacters: function (id, type) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#troupe/" + id);
            require(["../views/CharactersSummarizeListView"], function (CharactersSummarizeListView) {
                self.enforce_logged_in().then(function () {
                    var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                    return get_troupe;
                }).then(function (troupe, user) {
                    self.troupeSummarizeCharacters = self.troupeSummarizeCharacters || new CharactersSummarizeListView({ collection: new Vampires }).setup();
                    self.troupeCharacters.register("#troupe/" + id + "/character/<%= character_id %>");
                    return self.get_troupe_summarize_characters(troupe, self.troupeSummarizeCharacters.collection);
                }).then(function () {
                    $.mobile.changePage("#troupe-summarize-characters-all", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        get_troupe_print_options: function () {
            var self = this;
            self.troupePrintOptions = self.troupePrintOptions || new Backbone.Model({
                font_size: 100,
                exclude_extended: false
            });
            return self.troupePrintOptions;
        },

        troupe_select_to_print_characters: function (id, type) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function () {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                return get_troupe;
            }).then(function (troupe, user) {
                self.troupeSelectToPrintCharacters = self.troupeSelectToPrintCharacters || new CharactersSelectToPrintView({
                    collection: new Vampires,
                    el: "#troupe-select-to-print-characters-all > div[role='main']",
                    print_options: self.get_troupe_print_options()
                }).setup();
                self.troupeCharacters.register("#troupe/" + id + "/character/<%= character_id %>");
                self.troupeSelectToPrintCharacters.submission_template = _.template("#troupe/" + id + "/characters/print/selected");
                return self.get_troupe_summarize_characters(troupe, self.troupeSelectToPrintCharacters.collection);
            }).then(function () {
                $.mobile.changePage("#troupe-select-to-print-characters-all", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },

        troupe_print_characters: function (id, type) {
            var self = this;
            $.mobile.loading("show");
            if ("selected" == type) {
                self.set_back_button("#troupe/" + id + "/characters/selecttoprint/all");
            } else {
                self.set_back_button("#troupe/" + id);
            }
            require(["../views/CharactersPrintView"], function (CharactersPrintView) {
                self.enforce_logged_in().then(function () {
                    var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                    return get_troupe;
                }).then(function (troupe, user) {
                    self.troupePrintCharacters = self.troupePrintCharacters || new CharactersPrintView({
                        collection: new Vampires,
                        el: "#troupe-print-characters-all > div[role='main']",
                        print_options: self.get_troupe_print_options()
                    }).setup();
                    self.troupeCharacters.register("#troupe/" + id + "/character/<%= character_id %>");
                    if ("selected" == type && self.troupeSelectToPrintCharacters) {
                        self.troupePrintCharacters.collection.reset(self.troupeSelectToPrintCharacters.get_filtered());
                    } else {
                        return self.get_troupe_summarize_characters(troupe, self.troupePrintCharacters.collection);
                    }
                }).then(function () {
                    $.mobile.changePage("#troupe-print-characters-all", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        troupe_portrait: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function () {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                return get_troupe;
            }).then(function (troupe) {
                self.troupePortraitView = self.troupePortraitView || new TroupePortraitView({ el: "#troupe-portrait" });
                self.troupePortraitView.register(troupe);
                $.mobile.changePage("#troupe-portrait", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(PromiseFailReport);
        },


        troupe_relationship_network: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#troupe/" + id);
            require(["../views/TroupeCharacterRelationshipsNetworkView"], function (TroupeCharacterRelationshipsNetworkView) {
                self.enforce_logged_in().then(function () {
                    var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                    return get_troupe;
                }).then(function (troupe, user) {
                    return self.get_troupe_characters(troupe);
                }).then(function (characters) {
                    self.tcrnv = self.tcrnv || new TroupeCharacterRelationshipsNetworkView({ el: "#troupe-character-relationships-network" });
                    return self.tcrnv.register(characters);
                }).always(function () {
                    $.mobile.changePage("#troupe-character-relationships-network", { reverse: false, changeHash: false });
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        troupeeditstaff: function (id, uid) {
            var self = this;
            $.mobile.loading("show");
            self.enforce_logged_in().then(function () {
                self.set_back_button("#troupe/" + id);
                var get_troupe = new Parse.Query("Troupe").include("portrait").get(id);
                var get_user = new Parse.Query("User").get(uid);
                return Parse.Promise.when(get_troupe, get_user);
            }).then(function (troupe, user) {
                self.troupeEditStaffView = self.troupeEditStaffView || new TroupeEditStaffView({ el: "#troupe-edit-staff" });
                return self.troupeEditStaffView.register(troupe, user);
            }).then(function () {
                $.mobile.changePage("#troupe-edit-staff", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(function (error) {
                if (_.isArray(error)) {
                    _.each(error, function (e) {
                        console.log("Something failed" + e.message);
                    })
                } else {
                    console.log("error updating experience" + error.message);
                }
            });
        },

        troupeaddstaff: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#troupe/" + id);
            require(["../views/UsersView"], function (UsersView) {
                self.enforce_logged_in().then(function () {
                    return new Parse.Query("Troupe").get(id);
                }).then(function (troupe) {
                    self.troupeAddStaffView = self.troupeAddStaffView || new UsersView({ el: "#troupe-add-staff" });
                    self.troupeAddStaffView.register("#troupe/" + troupe.id + "/staff/edit/<%= id %>");
                    $.mobile.changePage("#troupe-add-staff", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                });
            });
        },

        troupe: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#troupes");
            require(["../views/TroupeView"], function (TroupeView) {
                self.enforce_logged_in().then(function () {
                    return new Parse.Query("Troupe").get(id);
                }).then(function (troupe) {
                    self.troupeView = self.troupeView || new TroupeView({ el: "#troupe" });
                    var is_st = Parse.User.current().get("storytellerinterface");
                    var is_ad = Parse.User.current().get("admininterface");
                    self.troupeView.register(troupe, (is_st || is_ad));
                    $.mobile.changePage("#troupe", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                });
            });
        },

        troupes: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#");
            require(["../views/TroupesListView"], function (TroupesListView) {
                self.enforce_logged_in().then(function () {
                    self.troupesListView = self.troupesListView || new TroupesListView({ el: "#troupes-list" }).render();
                    return self.troupesListView.register();
                }).then(function () {
                    $.mobile.changePage("#troupes-list", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                });
            });
        },

        troupenew: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#troupes");
            require(["../views/TroupeNewView"], function (TroupeNewView) {
                self.enforce_logged_in().then(function () {
                    self.troupeNewView = self.troupeNewView || new TroupeNewView({ el: "#troupe-new" }).render();
                    $.mobile.changePage("#troupe-new", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                });
            });
        },

        administration: function () {
            var self = this;
            self.enforce_admin().then(function () {
                self.set_back_button("#");
                $.mobile.changePage("#administration", { reverse: false, changeHash: false });
            }).fail(self.admin_route_failed("Couldn't open the administration menu"));
        },

        administration_characters_all: function () {
            var self = this;
            $.mobile.loading("show");
            self.enforce_admin().then(function () {
                self.set_back_button("#administration");
                return self.get_administrator_characters();
            }).then(function () {
                self.characters.register("#administration/character/<%= character_id %>");
                $.mobile.changePage("#characters-all", { reverse: false, changeHash: false });
            }).always(function () {
                $.mobile.loading("hide");
            }).fail(self.admin_route_failed("Couldn't list every character"));
        },

        administration_characters_summarize: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration");
            require(["../views/CharactersSummarizeListView"], function (CharactersSummarizeListView) {
                self.enforce_admin().then(function () {
                    return self.get_administrator_summarize_characters();
                }).then(function () {
                    self.administrationSummarizeCharacters = self.administrationSummarizeCharacters || new CharactersSummarizeListView({ collection: self.characters.collection }).setup();
                    self.troupeCharacters.register("#administration/character/<%= character_id %>");
                    $.mobile.changePage("#troupe-summarize-characters-all", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(PromiseFailReport);
            });
        },

        referendums: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#");
            require(["../views/ReferendumsListView"], function (ReferendumsListView) {
                self.enforce_logged_in().then(function () {
                    self.referendumsListView = self.referendumsListView || new ReferendumsListView({ el: "#referendums-list" }).render();
                    return self.referendumsListView.register();
                }).then(function () {
                    $.mobile.changePage("#referendums-list", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                });
            });
        },

        referendum: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#referendums");
            require(["../models/Referendum", "../views/ReferendumView"], function (Referendum, ReferendumView) {
                self.enforce_logged_in().then(function () {
                    var q = new Parse.Query(Referendum);
                    q.include("portrait");
                    var ballotq = new Parse.Query("ReferendumBallot")
                        .equalTo("owner", new Referendum({ id: id }))
                        .equalTo("caster", Parse.User.current());
                    return Parse.Promise.when(
                        q.get(id),
                        ballotq.first(),
                        Parse.Cloud.run("get_my_patronage_status"));
                }).then(function (referendum, ballot, patronagestatus) {
                    self.referendumView = self.referendumView || new ReferendumView({ el: "#referendum" });
                    return self.referendumView.setup({
                        referendum: referendum,
                        patronagestatus: patronagestatus,
                        ballot: ballot
                    });
                }).then(function () {
                    $.mobile.changePage("#referendum", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                });
            });
        },

        administration_referendums: function () {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration");
            require(["../views/ReferendumsListView"], function (ReferendumsListView) {
                // R36: the admin referendum routes had no gate either, and the
                // detail one shows every caster's ballot.
                self.enforce_admin().then(function () {
                    self.referendumsListView = self.referendumsListView || new ReferendumsListView({ el: "#referendums-list" }).render();
                    return self.referendumsListView.register("#administration/referendum/<%= referendum_id %>");
                }).then(function () {
                    $.mobile.changePage("#referendums-list", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(self.admin_route_failed("Couldn't list the referendums"));
            });
        },

        administration_referendum: function (id) {
            var self = this;
            $.mobile.loading("show");
            self.set_back_button("#administration/referendums");
            require(["../models/Referendum", "../collections/ReferendumBallots", "../views/ReferendumView"], function (Referendum, Ballots, ReferendumView) {
                // R36: see the list route above.
                self.enforce_admin().then(function () {
                    var q = new Parse.Query(Referendum);
                    q.include("portrait");
                    var ballots = new Ballots;
                    return Parse.Promise.when(
                        q.get(id),
                        ballots.fetch(new Referendum({ id: id })),
                        UserChannel.get_users(),
                        Parse.Cloud.run("get_my_patronage_status"));
                }).then(function (referendum, ballots, users, patronagestatus) {
                    self.referendumView = self.referendumView || new ReferendumView({ el: "#referendum" });
                    return self.referendumView.setup({
                        referendum: referendum,
                        ballots: ballots,
                        users: users,
                        patronagestatus: patronagestatus
                    });
                }).then(function () {
                    $.mobile.changePage("#referendum", { reverse: false, changeHash: false });
                }).always(function () {
                    $.mobile.loading("hide");
                }).fail(self.admin_route_failed("Couldn't open that referendum"));
            });
        },


    });

    // Returns the Router class
    return CategoryRouter;

});