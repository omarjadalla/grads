/* jshint esnext:true */
var Grads = require("./grads.js");

var RADIANS = Math.PI / 180;
var DEGREES = 180 / Math.PI;

var ktof = function( k ) {
    return (( k - 273.15) * 1.8000) + 32.00;
};

class Conditions extends Grads {
    constructor(lat, lon, alt, model ) {
        super(lat, lon, alt, model );
    }

    wind() {
        var self = this;

        self.fetch( self.build("vgrd", true), function( vcomp ) {
            self.fetch( self.build("ugrd", true), function( ucomp ) {
                var vwind = vcomp[0][0][0];
                var uwind = ucomp[0][0][0];

                var offset = Math.atan2( vwind, uwind ) * DEGREES;
                var heading = ( 270 + offset ) - 180;
                var speed = Math.sqrt( Math.pow(Math.abs(vwind), 2) + Math.pow(Math.abs(uwind), 2) );

                console.log( heading );
                console.log( speed );
            });
        });
    }

    temp( callback ) {
        var self = this;

        self.fetch( self.build("tmpsfc"), function( variable ) {
            callback( ktof( variable[0][0] ) );
        });
    }
}

module.exports = Conditions;