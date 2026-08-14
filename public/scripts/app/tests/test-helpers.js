/**
 * Test Helpers for Yorick Jasmine/Karma test suites
 */
define([
    "underscore",
    "jquery",
    "parse",
    "../testsiteconfig",
    "../models/Vampire",
    "../models/Werewolf",
    "../models/ChangelingBetaSlice",
    "../models/Character",
    "../models/Troupe",
    "../models/SimpleTrait",
    "../models/Description",
    "../models/Approval",
    "../collections/Approvals"
], function (
    _,
    $,
    Parse,
    siteconfig,
    Vampire,
    Werewolf,
    ChangelingBetaSlice,
    Character,
    Troupe,
    SimpleTrait,
    Description,
    Approval,
    Approvals
) {
    var ParseInit = function () {
        Parse.$ = $;
        Parse.initialize("APPLICATION_ID", "yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR");
        Parse.serverURL = siteconfig.serverURL;
    };

    var character_types = [
        {
            name: "Vampire",
            template: Vampire
        },
        {
            name: "Werewolf",
            template: Werewolf
        },
        {
            name: "Changeling",
            template: ChangelingBetaSlice
        }
    ];

    var loginAs = function (username, password) {
        ParseInit();
        var current = Parse.User.current();
        if (!current || !_.eq(current.get("username"), username)) {
            if (current) {
                Parse.User.logOut();
            }
            return Parse.User.logIn(username, password);
        }
        return Parse.Promise.as(current);
    };

    var ParseStart = function () {
        return loginAs("devuser", "thedumbness");
    };

    var MemberParseStart = function () {
        return loginAs("sampmem", "sampmem");
    };

    var ASTParseStart = function () {
        return loginAs("sampast", "sampast");
    };

    var createTestUser = function (prefix) {
        ParseInit();
        if (Parse.User.current()) {
            Parse.User.logOut();
        }
        var uniqueName = (prefix || "testuser") + "_" + Math.random().toString(36).slice(2, 10);
        var user = new Parse.User();
        user.set("username", uniqueName);
        user.set("password", "secretpass123");
        user.set("email", uniqueName + "@example.com");
        return user.signUp(null).then(function (createdUser) {
            return Parse.Promise.as(createdUser);
        });
    };

    return {
        ParseInit: ParseInit,
        character_types: character_types,
        loginAs: loginAs,
        ParseStart: ParseStart,
        MemberParseStart: MemberParseStart,
        ASTParseStart: ASTParseStart,
        createTestUser: createTestUser,
        siteconfig: siteconfig
    };
});
