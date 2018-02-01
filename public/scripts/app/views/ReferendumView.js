// Includes file dependencies
/* global _ */
define([
    "jquery",
    "backbone",
    "parse",
    "backform",
    "../forms/UserForm",
    "text!../templates/profile-facebook-account.html",
    "../helpers/PromiseFailReport",
    "marionette",
    "text!../templates/referendum/referendum.html",
    "text!../templates/referendum/description.html",
    "text!../templates/referendum/options.html",
    "../models/ReferendumBallot"
], function (
    $,
    Backbone,
    Parse,
    Backform,
    UserForm,
    profile_facebook_account_html,
    PromiseFailReport,
    Marionette,
    referendum_html,
    description_html,
    options_html,
    ReferendumBallot) {

    var DescriptionView = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template(description_html),
    });
    
    var OptionsView = Marionette.ItemView.extend({
        tagName: 'div',
        template: _.template(options_html),
        templateHelpers: function() {
            var self = this;
            return {
                referendum: self.model,
                ballot_message: self.ballot_message,
                ballot: self.ballot,
                patronagestatus: self.patronagestatus,
                ballots: self.ballots,
                users: self.users
            }
        },
        initialize: function (options) {
            var self = this;
            self.ballot = options.ballot;
            self.patronagestatus = options.patronagestatus;
            self.ballots = options.ballots;
            self.users = options.users;
        },
        events: {
            "click a": "cast_ballot"
        },
        cast_ballot: function (e) {
            var self = this;
            e.preventDefault();
            self.undelegateEvents();
            
            var ballot_option = self.$(e.target).attr('name');
            
            console.log(self.$(e.target).attr('name'));
 
            Parse.Cloud.run("vote_for_referendum", {referendum_id: self.model.id, ballot_option: ballot_option})
            .fail(function (error) {
                self.ballot_message = error;
                console.error(error);
            }).then(function (cupcakeinfo) {
                self.ballot_message = cupcakeinfo;
                var q = new Parse.Query("ReferendumBallot")
                    .equalTo("owner", self.model)
                    .equalTo("caster", Parse.User.current());
                return q.first();
            }).then(function (ballot) {
                self.ballot = ballot;
            }).always(function () {
                self.delegateEvents();
                self.render();
            })
        }
    });
    
    var LayoutView = Marionette.LayoutView.extend({
        el: "#referendum",
        template: _.template(referendum_html),
        regions: {
            description: "#referendum-description",
            options: "#referendum-options"
        },
        initialize: function(options) {
            var self = this;
        },
        setup: function(options) {
            var self = this;
            var referendum = options.referendum;
            var ballot = options.ballot;
            var ballots = options.ballots;
            var patronagestatus = options.patronagestatus;
            var users = options.users;
            self.render();
            self.showChildView('description', new DescriptionView({model: referendum}))
            self.showChildView('options', new OptionsView({model: referendum, ballot: ballot, patronagestatus: patronagestatus, ballots: ballots, users: users}))
            
            return self;
        }
    });

    // Returns the View class
    return LayoutView;

});
