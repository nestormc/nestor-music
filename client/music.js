/*jshint browser:true */
/*global define */

define(
[ "ui", "router", "track", "albumlist" ],
function(ui, router, MusicTrack) {
	"use strict";


	ui.started.add(function() {
		ui.player.register("music", function(path) {
			return new MusicTrack(null, path);
		});
	});



	/*!
	 * Plugin manifest
	 */

	return {
		title: "music",
		css: "albumlist",
		views: {
			albums: {
				type: "main",
				link: "albums"
			}
		}
	};
});