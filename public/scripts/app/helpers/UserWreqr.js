define([
    "jquery",
    "underscore",
    "parse",
    "backbone",
    "marionette"
], function( $, _, Parse, Backbone, Marionette ) {

    var userChannel = Backbone.Wreqr.radio.channel('user');

    Backbone.Wreqr.radio.reqres.setHandler("user", "testing", function(id) {
        return "deez" + id;
    });

    console.log(userChannel.reqres.request('testing', 'anid'));
    
    return userChannel;
} );
