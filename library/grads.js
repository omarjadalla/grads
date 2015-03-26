/* jshint esnext:true */

var async = require('async');
var moment = require('moment');
var request = require('request');

var models = {
    noaa: require("../data/noaa-models.json")
};


/**
 *
 * Remap coordinate values into more grads friendly ranges.
 *
 */
var remap = function( value, rangeMin, rangeMax, limitMin, limitMax ) {
    return Math.floor( ((( value - rangeMin ) * ( limitMax - limitMin )) / ( rangeMax - rangeMin )) + limitMin );
};


/**
 *
 * Hacky code to build and add to multidimesional arrays
 *
 */
var mdsave = function( values, indexes, value ) {
    var cmd = "values";

    for ( var i in indexes ) {
        var index = indexes[i];

        cmd += '[' + index + ']';

        if ( parseInt( i ) === ( indexes.length - 1 ) ) {
            eval( cmd + " = " + value );
        } else if ( eval( "typeof " + cmd ) === "undefined" ) {
            eval( cmd + " = {}" );
        }
    }

    return values;
};


/**
 *
 * Generate a GrADS parameter string for request URLs.
 * Pass it any number of string arguments, it'll know what to do.
 *
 */
var parameters = function() {
    var output = "";

    for ( var i in arguments ) {
        var param = arguments[i];

        output += "[" + param + "]";
    }

    return output;
};


/**
 *
 * Get Regex matches for a given string and regex.
 *
 */
var matches = function( string, regex, index ) {
    var i = index || 1;
    var match;
    var matches = [];

    while ( match = regex.exec( string ) ) {
        matches.push( match[ i ] );
    }

    return matches;
};


class Grads {
    constructor(lat, lon, alt, model ) {
        // Verify that model exists
        if ( typeof models.noaa[model] === "undefined" ) {
            //throw new Error( model + " is not a valid weather model.");
            model = "rap";
        }

        // Load the model configuration
        this.model = models.noaa[ model ];

        // Remap set lat/lon to NOAA grads-friendly values.
        this.lat = remap( lat, this.model.range.latMin, this.model.range.latMax, 0, this.model.steps.lat );
        this.lon = remap( lon, this.model.range.lonMin, this.model.range.lonMax, 0, this.model.steps.lon );
        this.alt = alt;
        this.time = moment().utc().subtract(3, 'hours');
        this.midnight = moment().utc().startOf('day').subtract(3, 'hours');
    }

    build( variable, includeAlt ) {
       var level, model, subset, offset, hourset, altitude;

       if ( includeAlt ) {
           if ( this.model.fidelity === "low" ) { // GFS
               if ( this.alt < 1829 ) {
                   altitude = "_1829m";
               } else if ( this.alt >= 1829 && this.alt < 2743 ) {
                   altitude = "_2743m";
               } else if ( this.alt >= 2743 && this.alt < 3658 ) {
                   altitude = "_3658m";
               } if ( this.alt >= 3658 && this.alt < 25908 ) {
                   level = Math.round(( this.alt / 25908 ) * this.model.steps.alt);
                   altitude = "prs";
               } else if ( this.alt >= 25908 && this.alt < 44307 ) {
                   altitude = "30_0mb";
               }
           } else { // RAP and GFSHD
               if ( this.alt < 12000 ) {
                   level = Math.round(( this.alt / 12000 ) * this.model.steps.alt);
                   altitude = "prs";
               } else if ( this.alt >= 12000 && this.alt < 14000 ) {
                   altitude = "180_150mb";
               } else if ( this.alt >= 14000 && this.alt < 15000 ) {
                   altitude = "150_120mb";
               } else if ( this.alt >= 15000 && this.alt < 17000 ) {
                   altitude = "120_90mb";
               } else if ( this.alt >= 17000 && this.alt < 19000 ) {
                   altitude = "90_60mb";
               } else if ( this.alt >= 19000 && this.alt < 24000 ) {
                   altitude = "60_30mb";
               } else if ( this.alt >= 24000 ) {
                   altitude = "30_0mb";
               }
           }
       }

       // Figure out which dataset to grab, based on time
       hourset = Math.floor( remap( this.time.diff( this.midnight, 'hours'), 0, 24, 0, this.model.steps.hours ) );

       if ( hourset < 10 ) {
           hourset = "0" + hourset;
       }

       // Figure out which date inside of the dataset to grab
       offset = remap( this.time.diff(moment().startOf('day'), 'seconds'), 0, 86400, 0, this.model.steps.time );

       // Build the model + date portion of the URL
       model = this.model.slug + "/" + this.model.slug + this.time.format("YYYYMMDD") +
           "/" + this.model.slug + "_" + hourset + "z.ascii?";

       // Generate parameters portion of the URL, adding level if set
       if ( level ) {
           subset = parameters( level, offset, this.lat, this.lon );
       } else {
           subset = parameters( offset, this.lat, this.lon );
       }

       // Generate the entire URL, adding altitude if set
       if ( altitude ) {
           return this.model.base + model + variable + altitude + subset;
       } else {
           return this.model.base + model + variable + subset;
       }
   }


    /*
     *
     * Read the GrADS response and decode it
     *
     */
    parse( content, callback ) {
        var key, line, temp, comma, index, value, indexes, breakout;
        var lines = content.split("\n");
        var counter = /\[(\d)\]/g;
        var variables = {};
        var values = {};

        // Capture all values and their array location
        for ( var i = 1; i < lines.length; i++ ) {
            line = lines[i];

            // Stop looping when we hit the 3 blanks spaces
            // that GrADS uses to seperate values from key
            if ( line === '' ) {
                key = i;

                break;
            } else {
                comma = line.indexOf(",");
                indexes = line.substring(0, comma);
                value = parseFloat(line.substring( comma + 2 ));
                values = mdsave( values, matches( indexes, counter ), value );
            }
        }

        // Capture all keys and their array location
        for ( var j = key; j < lines.length; j++ ) {
            line = lines[j];

            // Verify we're looking at a key and not a value
            if ( line.indexOf(",") !== -1 ) {
                comma = line.indexOf(",");
                var variable = line.substring(0, comma);
                value = parseFloat( lines[ j + 1 ] );

                // Lightly process variables
                if ( variable === "time" ) {
                    // GrADS time is days since 1-1-1
                    // Set days since to Unix Epoch
                    var days = value - 719164;
                    var seconds = ( days % 1 ) * 86400;
                    var time = moment.utc( 0 )
                        .add( days, 'days' )
                        .add( seconds, 'seconds' );

                    value = time.toJSON();
                }

                variables[ variable ] = value;

                // Skip the value line
                j++;
            }
        }

        // TODO:
        //  - Initalize a multidimensional array
        //  - Map Variables to Values within Multdimensional Array
        callback( values );
   }

   /**
    *
    * Build the GrADS request URL for the given resource
    *
    */
   fetch( url, callback ) {
       var self = this;

       request( url, function( error, response, body ) {
           if ( !error ) {
               self.parse( body, callback );
           } else {
               // Wut to do?
           }
       });

       // TODO:
       // - Cache responses via Redis for 1 hour
   }
}


module.exports = Grads;
