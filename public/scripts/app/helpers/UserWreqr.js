define([
    "jquery",
    "underscore",
    "parse",
    "backbone",
    "marionette"
], function( $, _, Parse, Backbone, Marionette ) {

    var userChannel = Backbone.Wreqr.radio.channel('user');

    return userChannel;
} );
