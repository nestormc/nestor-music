/*jshint node:true*/
"use strict";

var util = require("util"),
	minidom = require("minidom"),
	request = require("request"),
	when = require("when");


var SEARCH_URL = "http://musicbrainz.org/ws/2/release/?query=%s";
var AMAZON_URL = "http://images.amazon.com/images/P/%s.01.LZZZZZZZ.jpg";
var THROTTLE_MSECS = 1000;


var currentRequest = when.resolve();


function mbRequest(url, cb) {
	var current = currentRequest;
	var next = when.defer();
	currentRequest = next.promise;

	current.then(function() {
		request(url, function(err, response, data) {
			if (err) {
				cb(err);
			} else if (response.statusCode !== 200) {
				cb(new Error("HTTP " + response.statusCode + " on " + url));
			} else {
				cb(null, data);
			}

			setTimeout(function() {
				next.resolve();
			}, THROTTLE_MSECS);
		});
	});
}


module.exports = {
	searchCoverArt: function(artist, album, cb) {
		var searchUrl = util.format(
				SEARCH_URL,
				encodeURIComponent(util.format(
					"artist:\"%s\" AND release:\"%s\"",
					artist,
					album
				))
			);

		mbRequest(searchUrl, function(err, data) {
			if (err) {
				cb(err);
			} else {
				var doc = minidom(data);
				var asins = doc.getElementsByTagName("asin");

				if (asins.length > 0) {
					when.any([].map.call(asins, function(asin) {
						var deferred = when.defer();

						var amazonUrl = util.format(
							AMAZON_URL,
							asin.firstChild.textContent
						);

						request({ url: amazonUrl, encoding: null }, function(err, response, data) {
							if (err) {
								deferred.reject(err.messagfe);
							} else if (response.statusCode !== 200) {
								deferred.reject("HTTP " + response.statusCode + " on " + amazonUrl);
							} else if (response.headers["content-type"] !== "image/jpeg") {
								// amazon sometimes returns a 1x1 GIF, ignore this one
								deferred.reject("Wrong content type " + response.headers["content-type"] + " on " + amazonUrl);
							} else {
								deferred.resolve(data);
							}
						});

						return deferred.promise;
					}))
					.then(function(data) {
						cb(null, data, "image/jpeg");
					})
					.otherwise(function(errs) {
						cb(new Error("Could not fetch any of " + asins.length + " images: " + errs.join(", ")));
					});
				} else {
					cb();
				}
			}
		});
	}
};