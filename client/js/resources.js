/*jshint browser:true */
/*global define */

define(["when", "rest"], function(when, rest) {
	"use strict";
	
	return {
		covers: {
			save: function(artist, album, uri) {
				var match = uri.match(/^data:([^;]*);base64,(.*)$/),
					key = "album:" + artist + ":" + album;

				if (match) {
					var type = match[1],
						data = match[2];

					return rest.post("covers", { key: key, type: type, data: data });
				} else {
					return rest.post("covers", { key: key, url: uri });
				}
			}
		},

		albums: {
			list: function() {
				return rest.incremental("albums", 5);
			}
		},

		tracks: {
			list: function() {
				return rest.incremental("tracks", 50);
			}
		}
	};
});