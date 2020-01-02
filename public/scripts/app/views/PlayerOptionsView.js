// Includes file dependencies
define([
    "marionette",
    "text!../templates/player_options.html",
], function( Marionette, player_options_html) {

    var View = Marionette.LayoutView.extend( {
        template: _.template(player_options_html),
        regions: {
            troupcharactersquickaccess: "#troupe-characters-quick-access",
        },
        setup: function() {
            var self = this;
            var options = self.options || {};
            self.render();
            return self;
        },
    } );

    return View;
} );
