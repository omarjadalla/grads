//
// grads.js
// This file is the primary interface with NOAA's GrADS dataset.
//

'use strict';

var redis;
var Redis = require('redis');
var moment = require('moment');
var request = require('request');
var Dictionary = require('./data/variable-mapping.json');
var models = { noaa: require('./data/noaa-models.json') };

var post = require('./library/post.js');
var request = require('./library/request.js');
var utilities = require('./library/utilities.js');
var conversions = require('./library/conversions.js');

if ( process.env.REDIS_URL ) {
    redis = Redis.createClient({
        url: process.env.REDIS_URL
    });
}

var Grads = function( lat, lon, alt, time, model ) {
    // Verify that model exists
    if ( typeof models.noaa[model] === 'undefined' ) {
        // throw new Error( model + ' is not a valid weather model.');
        model = 'gfs';
    }

    // Load functions
    this.remap = utilities.remap;
    this.cache = utilities.cache;
    this.mdsave = utilities.mdsave;
    this.config = utilities.config;
    this.matches = utilities.matches;
    this.increment = utilities.increment;
    this.parameters = utilities.parameters;
    this.build = request.build;
    this.fetch = request.fetch;
    this.bulkFetch = request.bulkFetch;
    this.parse = post.parse;
    this.flatten = post.flatten;

    // Time Boundaries - We pretend to know how to validate this but in reality,
    // and due to unknown time-travelling, it's difficlt to validate this with
    // 100% accuracy at the constructor level.
    var start = moment().subtract(5, 'seconds'); // Forgive tests for being a little late
    var end = moment().add( models.noaa[model].steps.time * models.noaa[model].steps.interval, 'ms' );

    // Load the model configuration
    this.alt = [];
    this.lat = [];
    this.lon = [];
    this.time = [];
    this.offset = 0;
    this.reducer = 0;
    this.counter = 0;
    this.results = {};
    this.resolution = 50; // set via query string
    this.incrementCounter = 0; // Class wide iteration offset to prevent garbage requests
    this.model = models.noaa[ model ]; // Load (known) NOAA model configuration
    this.dictionary = Dictionary[ model || 'gfs' ]; // Load a common set of variable names for accessing weather
    this.start = moment().utc().subtract(this.offset, 'hours').startOf('hour');
    this.midnight = moment().utc().subtract(this.offset, 'hours').startOf('day');

    // Read in ranges for Latitude, Longitude, and Altitude
    if ( typeof lat === 'number' || ( typeof lat === 'string' && lat.indexOf(':') === -1 ) ) {
        // Singular number passed
        lat = [ lat ];
    } else {
        if ( typeof lat === 'string' && lat.indexOf(':') !== -1 ) {
            // first:last string passed
            lat = lat.split(':');
            lat[0] = parseFloat(lat[0]);
            lat[1] = parseFloat(lat[1]);
        }

        // Array passed (or string was converted to array)
        var diffLat = ( lat[1] - lat[0] ) / this.model.options.resolution;

        if ( diffLat > this.resolution ) {
            this.reducer = Math.ceil(diffLat / this.resolution);
        }

        if ( isNaN( lat[0] ) || isNaN( lat[1] ) ) {
            throw new Error('Invalid Latitude value was set');
        }

        if ( lat[0] > lat[1] ) {
            var intermediate = lat[0];
            lat[0] = lat[1];
            lat[1] = intermediate;
        }
    }

    if ( typeof lon === 'number' || ( typeof lon === 'string' && lon.indexOf(':') === -1 ) ) {
        // Singular number passed
        lon = [ lon ];
    } else {
        if ( typeof lon === 'string' && lon.indexOf(':') !== -1 ) {
            // first:last string passed
            lon = lon.split(':');
            lon[0] = parseFloat(lon[0]);
            lon[1] = parseFloat(lon[1]);
        }

        // Array passed (or string was converted to array)
        var diffLon = (lon[1] - lon[0]) / this.model.options.resolution;

        if ( diffLon > this.resolution ) {
            var reducer = Math.ceil( diffLon / this.resolution );

            if ( reducer > this.reducer ) {
                this.reducer = reducer;
            }
        }

        if ( isNaN( lon[0] ) || isNaN( lon[1] ) ) {
            throw new Error('Invalid Longitude value was set');
        }

        if ( lon[0] > lon[1] ) {
            var intermediate = lon[0];
            lon[0] = lon[1];
            lon[1] = intermediate;
        }
    }

    if ( typeof alt === 'number' || ( typeof alt === 'string' && alt.indexOf(':') === -1 ) ) {
        // Singular number passed
        alt = [ alt ];
    } else {
        // first:last string passed
        if ( typeof alt === 'string' && alt.indexOf(':') !== -1 ) {
            alt = alt.split(':');
            alt[0] = parseFloat(alt[0]);
            alt[1] = parseFloat(alt[1]);
        }

        // Array passed (or string was converted to array)
        /*var diffAlt = (alt[1] - alt[0]) / this.model.options.resolution;

        if ( diffAlt > this.resolution ) {
            var reducer = Math.ceil( diffAlt / this.resolution );

            if ( reducer > this.reducer ) {
                this.reducer = reducer;
            }
        }*/

        if ( isNaN( alt[0] ) || isNaN( alt[1] ) ) {
            throw new Error('Invalid Altitude value was set');
        }

        if ( alt[0] > alt[1] ) {
            var intermediate = alt[0];
            alt[0] = alt[1];
            alt[1] = intermediate;
        }
    }

    if ( typeof time !== 'object' ) {
        time = [ moment(time) ];
    } else {
        var momentUsed = false;

        if ( typeof time === 'string' && time.indexof(':') !== -1 ) {
            time = alt.split(':');
            time[0] = moment(time[0]);
            time[1] = moment(time[1]);

            momentUsed = true;
        }

        if ( ( momentUsed && ( !time[0].isValid() || !time[1].isValid() ) ) ||
            ( !momentUsed && ( !moment(time[0]).isValid() || !moment(time[1]).isValid() ) ) ) {
            throw new Error('Invalid Time value was set');
        }

        if ( time[0] > time[1] ) {
            var intermediate = time[0];
            time[0] = time[1];
            time[1] = intermediate;
        }
    }

    // If we're using a degreeseast model, convert the longitude to 0-360deg
    if ( this.model.options.degreeseast ) {
        for ( var i in lon ) {
            if ( lon[i] < 0 ) {
                lon[i] = ( 360 - ( parseFloat(lon[i]) * -1 ) );
            }
        }

        // Reverse Parameter order if needed
        if ( lon[0] > lon[1] ) {
            var immediate = lon[0];
            lon[0] = lon[1];
            lon[1] = immediate;
        }
    }


    // Validate Boundaries and set grads-friendly coordinate sets
    for ( var j in lat ) {
        if ( lat[j] < this.model.range.latMin || lat[j] > this.model.range.latMax ) {
            throw new Error('Latitude is out of model bounds');
        }

        this.lat.push( this.remap( lat[j], [ this.model.range.latMin, this.model.range.latMax ] , [ 0, this.model.steps.lat ], true ) );
    }

    for ( var k in lon ) {
        if ( lon[k] < this.model.range.lonMin || lon[k] > this.model.range.lonMax ) {
            throw new Error('Longitude is out of model bounds');
        }

        this.lon.push( this.remap( lon[k], [ this.model.range.lonMin, this.model.range.lonMax ], [ 0, this.model.steps.lon ], true ) );
    }

    // Convert lat from Meters to Millibars (pressure altitude)
    // Validation is a little weird. It gets done after variable conversion to pressure.
    for ( var l in alt ) {
        alt[l] = conversions.pressure( alt[l] );

        if ( alt[l] < this.model.range.altMin ) {
            //console.info('Alt override to 10mb');
            alt[l] = 10;
        } else if ( alt[l] > this.model.range.altMax ) {
            //console.info('Alt override to 1000mb');
            alt[l] = 1000;
        }

        if ( alt[l] < this.model.range.altMin || alt[l] > this.model.range.altMax ) {
            throw new Error('Altitude is out of model bounds');
        }

        // Inverse the result because altitude works differently
        this.alt.push( this.model.steps.alt - this.remap( alt[l], [ this.model.range.altMin, this.model.range.altMax ], [ 0, this.model.steps.alt ], true ) );
    }

    for ( var m in time ) {
        if ( time[m] < start || time[m] > end ) {
            throw new Error('Time is out of model bounds');
        }

        // We're going to push whole time, since we need to figure out the offset
        // when we know which dataset we are inside of
        this.time.push( time[m] );
    }
};

module.exports = Grads;
