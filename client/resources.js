/*jshint browser:true */
/*global define */

define(["rest", "io"], function(rest, io) {
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
			watch: function() {
				return io.watch("albums");
			}
		},

		tracks: {
			get: function(path) {
				return rest.get("tracks/%s", path);
			}
		}
	};
});