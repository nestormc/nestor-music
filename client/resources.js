/*jshint browser:true */
/*global define */

define(["rest"], function(rest) {
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
			get: function(id) {
				return rest.get("tracks/" + id);
			}
		}
	};
});