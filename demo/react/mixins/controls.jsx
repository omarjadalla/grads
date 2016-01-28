import React from 'react';
import Moment from 'moment';
import Range from 'react-range';
import Loader from 'react-loader';
import Submittable from 'react-submittable';
import { countries, states } from 'json!../../data/places.json';

module.exports = {
    renderPlaces( margin ) {
        return (
            <div className="col-sm-3 controls-country" style={{ marginLeft: margin + '%' }}>
                <h3>Location</h3>

                <Submittable onEnter={ this.changePlace } onCancel={ this.clearPlace }>
                    <select ref="place" onChange={ this.changePlace } defaultValue={ this.state.place }>
                        <option value="">Select a location...</option>
                        <optgroup label="Countries">
                            {countries.map(( country, i ) => {
                                return (
                                    <option value={ country.name + ' ' } key={ i }>{ country.name }</option>
                                );
                            })}
                        </optgroup>
                        <optgroup label="States">
                            {states.map(( state, i ) => {
                                return (
                                    <option value={ state.name } key={ i }>{ state.name }</option>
                                );
                            })}
                        </optgroup>
                    </select>
                </Submittable>
            </div>
        );
    },

    renderTimeline() {
        return (
            <div className="col-sm-3 controls-time">
                <h3>Date / Time</h3>
                <Range type="range" onChange={ this.changeStep } value={ this.state.step } min={ 0 } max={ this.state.timeline.length } />
                { Moment( this.state.timeline[ this.state.step ] ).format('MM/D/YY, h:mma') }
                <br />
                <a href="#" onClick={ this.endAnimation }>Stop</a>
                <a href="#" onClick={ this.startAnimation }>Start</a>
            </div>
        );
    },

    renderMetrics() {
        return (
            <div className="col-sm-6 controls-metrics">
                <h3>Visualize</h3>

                <div className="row">
                    <div onClick={ this.changeMetric.bind( this, 'temperature') } className="col-sm-3 metric">
                        <div className={ this.state.metric === 'temperature' ? 'selected' : '' }>
                            <i className="ss-thermometer"></i>
                            Temp
                        </div>
                    </div>

                    <div onClick={ this.changeMetric.bind( this, 'pressure') } className="col-sm-3 metric">
                        <div className={ this.state.metric === 'pressure' ? 'selected' : '' }>
                            <i className="ss-smoke"></i>
                            Pressure
                        </div>
                    </div>

                    <div onClick={ this.changeMetric.bind( this, 'clouds') } className="col-sm-3 metric">
                        <div className={ this.state.metric === 'clouds' ? 'selected' : '' }>
                            <i className="ss-clouds"></i>
                            Clouds
                        </div>
                    </div>

                    <div onClick={ this.changeMetric.bind( this, 'snow') }  className="col-sm-3 metric">
                        <div className={ this.state.metric === 'snow' ? 'selected' : '' }>
                            <i className="ss-snowflakes"></i>
                            Snow Depth
                        </div>
                    </div>
                </div>
            </div>
        )
    },

    render() {
        if ( !this.state.place ) {
            return (
                <div className="row">
                    { this.renderPlaces( 33 ) }
                </div>
            );
        } else if ( !this.state.loaded ) {
            return (
                <div className="row">
                    { this.renderPlaces( 0 ) }

                    <div className="col-sm-6">
                        <Loader loaded={ false } top="0" scale={.85}></Loader>
                    </div>
                </div>
            );
        } else {
            return (
                <div className="row">
                    { this.renderPlaces( 0 ) }
                    { this.renderMetrics() }
                    { this.renderTimeline() }
                </div>
            );
        }
    }
}
