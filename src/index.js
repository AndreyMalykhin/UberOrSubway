/* global google, process */

import 'index.scss';
import {Promise} from 'es6-promise';
import qs from 'qs';
import Spinner from 'spin.js';
import fetch from 'isomorphic-fetch';

/**
 * @enum
 */
const TransportType = {
    UBER: 'uber',
    SUBWAY: 'subway'
};

const transportNames = {
    [TransportType.UBER]: 'Uber',
    [TransportType.SUBWAY]: 'Subway'
};
const spinner = new Spinner();
let map;
let directionsService;
let directionsRenderer;
let userOrigin;
let userDestination;

showSpinner();

/**
 * Entry point
 *
 * @return {void}
 */
function bootstrap() {
    hideSpinner();
    const mapNode = document.getElementById('map');
    map = new google.maps.Map(mapNode, {
        center: {lat: 50.4501, lng: 30.5234},
        clickableIcons: false,
        zoom: 11
    });
    mapNode.focus();
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({map});
    gotoStep(step1);
}

/**
 * The whole app is a finite-state machine that is transitions between "steps"
 *
 * @param {Function} step
 * @return {void}
 */
function gotoStep(step) {
    step().then((nextStep) => {
        gotoStep(nextStep);
    }, (error) => {
        console.log(error);
        showError();
    });
}

/**
 * @return {Promise<Function>}
 */
function step1() {
    showMsg('Please allow us to access your location or choose it manually by clicking on the map');
    return getUserLocation().then((location) => {
        userOrigin = location;
        markUserLocation(location);
        return step2;
    })
}

/**
 * @return {Promise<Function>}
 */
function step2() {
    directionsRenderer.setMap(null);
    showMsg('Please click on where you want to go');
    return getUserDestination().then((location) => {
        userDestination = location;
        return finish;
    });
}

/**
 * Final step
 *
 * @return {Promise<void>}
 */
function finish() {
    showMsg('Thinking...');
    return ensureOptimalTransport(userOrigin, userDestination)
    .then((response) => {
        showVerdict(response.subwayDuration, response.uberDuration,
            response.optimalTransport);
    });
}

/**
 * @return {Promise<google.maps.LatLng>}
 */
function getUserLocation() {
    return new Promise((resolve) => {
        const onMapClick = map.addListener('click', (event) => {
            google.maps.event.removeListener(onMapClick);
            resolve(event.latLng);
        });
        const geolocation = navigator.geolocation;
        geolocation && geolocation.getCurrentPosition((userLocation) => {
            google.maps.event.removeListener(onMapClick);
            const {latitude, longitude} = userLocation.coords;
            resolve(new google.maps.LatLng(latitude, longitude));
        });
    });
}

/**
 * @return {Promise<google.maps.LatLng>}
 */
function getUserDestination() {
    return new Promise((resolve) => {
        const onMapClick = map.addListener('click', (event) => {
            google.maps.event.removeListener(onMapClick);
            resolve(event.latLng);
        });
    });
}

/**
 * @param {google.maps.LatLng} origin
 * @param {google.maps.LatLng} destination
 * @return {Promise<Object>}
 */
function ensureOptimalTransport(origin, destination) {
    const subwayRoutePromise = getSubwayRoute(origin, destination)
    .then((response) => {
        if (response.status != google.maps.DirectionsStatus.OK) {
            throw new Error(status);
        }

        return response;
    });

    const uberRoutePromise = getUberRoute(origin, destination)
    .then((response) => {
        if (response.status != google.maps.DirectionsStatus.OK) {
            throw new Error(response.status);
        }

        return response;
    });

    return Promise.all([
        subwayRoutePromise,
        uberRoutePromise,
        getUberRouteDuration(origin, destination)
    ])
    .then(([subwayRouteResponse, uberRouteResponse, uberRouteDuration]) => {
        const subwayRouteDuration =
            subwayRouteResponse.result.routes[0].legs[0].duration.value;
        const optimalTransport = calculateOptimalTransport(
            subwayRouteDuration, uberRouteDuration);
        directionsRenderer.setMap(map);

        switch (optimalTransport) {
        case TransportType.UBER:
            directionsRenderer.setDirections(uberRouteResponse.result);
            break;
        case TransportType.SUBWAY:
            directionsRenderer.setDirections(subwayRouteResponse.result);
            break;
        }

        return {
            subwayDuration: subwayRouteDuration,
            uberDuration: uberRouteDuration,
            optimalTransport: optimalTransport
        };
    });
}

/**
 * @param {Number|null} subwayRouteDuration
 * @param {Number|null} uberRouteDuration
 * @return {String|null}
 */
function calculateOptimalTransport(subwayRouteDuration, uberRouteDuration) {
    if (subwayRouteDuration !== null) {
        if (!uberRouteDuration
            || subwayRouteDuration <= uberRouteDuration) {
            return TransportType.SUBWAY;
        } else {
            return TransportType.UBER;
        }
    } else if (uberRouteDuration !== null) {
        if (!subwayRouteDuration
            || uberRouteDuration < subwayRouteDuration) {
            return TransportType.UBER;
        } else {
            return TransportType.SUBWAY;
        }
    }

    return null;
}

/**
 * @param {google.maps.LatLng} origin
 * @param {google.maps.LatLng} destination
 * @return {Promise<Number|null>}
 */
function getUberRouteDuration(origin, destination) {
    const priceQuery = {
        start_latitude: origin.lat(),
        start_longitude: origin.lng(),
        end_latitude: destination.lat(),
        end_longitude: destination.lng()
    };
    const timeQuery = {
        start_latitude: origin.lat(),
        start_longitude: origin.lng()
    };
    const requestOptions = {headers: {'Authorization': `Token ${process.env.UOS_UBER_SERVER_TOKEN}`}};
    const apiUrl = 'https://api.uber.com/v1/estimates';
    return Promise.all([
        fetch(`${apiUrl}/price?${qs.stringify(priceQuery)}`,requestOptions),
        fetch(`${apiUrl}/time?${qs.stringify(timeQuery)}`, requestOptions)
    ])
    .then(([priceResponse, timeResponse]) => {
        if (priceResponse.status != 200) {
            throw new Error(priceResponse.statusText);
        } else if (timeResponse.status != 200) {
            throw new Error(timeResponse.statusText);
        }

        return Promise.all([priceResponse.json(), timeResponse.json()]);
    })
    .then(([priceResponse, timeResponse]) => {
        if (!priceResponse.prices.length || !timeResponse.times.length) {
            return null;
        }

        return calculateUberRouteDuration(
            priceResponse.prices, timeResponse.times);
    });
}

/**
 * @param {Array<Object>} prices
 * @param {Array<Object>} times
 * @return {Number}
 */
function calculateUberRouteDuration(prices, times) {
    let avgRouteDuration = null;
    prices.forEach((price) => {
        const duration = price.duration;
        avgRouteDuration = avgRouteDuration == null ? duration :
            ((avgRouteDuration + duration) / 2);
    });

    let avgArrivalToUserDuration = null;
    times.forEach((time) => {
        const duration = time.estimate;
        avgArrivalToUserDuration = avgArrivalToUserDuration == null ?
            duration : ((avgArrivalToUserDuration + duration) / 2);
    });
    return avgRouteDuration + avgArrivalToUserDuration;
}

/**
 * @param {google.maps.LatLng} origin
 * @param {google.maps.LatLng} destination
 * @return {Promise<Object>}
 */
function getSubwayRoute(origin, destination) {
    return new Promise((resolve) => {
        const request = {
            origin,
            destination,
            travelMode: google.maps.TravelMode.TRANSIT,
            transitOptions: {modes: [google.maps.TransitMode.SUBWAY]}
        };
        directionsService.route(request, (result, status) => {
            resolve({status, result});
        });
    });
}

/**
 * @param {google.maps.LatLng} origin
 * @param {google.maps.LatLng} destination
 * @return {Promise<Object>}
 */
function getUberRoute(origin, destination) {
    return new Promise((resolve) => {
        const request = {
            origin,
            destination,
            travelMode: google.maps.TravelMode.DRIVING
        };
        directionsService.route(request, (result, status) => {
            resolve({status, result});
        });
    });
}

/**
 * @param {google.maps.LatLng} location
 * @return {void}
 */
function markUserLocation(location) {
    map.setCenter(location);
    const marker = new google.maps.Marker({
        position: location,
        map,
        animation: google.maps.Animation.DROP,
        label: 'A'
    });
    const info = new google.maps.InfoWindow({
        content: 'You'
    });
    info.open(map, marker);
}

/**
 * What is faster ?
 *
 * @param {Number|null} subwayDuration
 * @param {Number|null} uberDuration
 * @param {TransportType|null} optimalTransport
 */
function showVerdict(subwayDuration, uberDuration, optimalTransport) {
    uberDuration = uberDuration === null ? 'no cars nearby' :
        `${Number(uberDuration / 60).toFixed()} min`;
    subwayDuration = subwayDuration === null ? 'unknown' :
        `${Number(subwayDuration / 60).toFixed()} min`;
    const winner = optimalTransport ? `${transportNames[optimalTransport]} is faster!` : 'You are on your own, buddy :(';
    showMsg(`
        <p>Subway - ${subwayDuration}</p>
        <p>Uber - ${uberDuration}</p>
        <p><strong>${winner}</strong></p>
        <p><button id='reset-btn' class='btn btn-primary'>Reset</button></p>
    `);
    document.getElementById('reset-btn').addEventListener('click', () => {
        gotoStep(step2);
    });
}

/**
 * @param {String} msg
 * @return {void}
 */
function showMsg(msg) {
    document.getElementById('msg').innerHTML = msg;
}

/**
 * @return {void}
 */
function showError() {
    const node = document.getElementById('error');
    node.innerHTML = 'Oops, something went wrong...';
    node.classList.remove('hidden');
}

/**
 * @return {void}
 */
function showSpinner() {
    spinner.spin(document.getElementById('spinner'));
}

/**
 * @return {void}
 */
function hideSpinner() {
    spinner.stop();
}

window.bootstrap = bootstrap;
