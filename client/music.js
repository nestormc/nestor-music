/*jshint browser:true */
/*global define, console */

define(
[ "ui", "router", "track", "albumlist" ],
function(ui, router, MusicTrack) {
	"use strict";

	/*
	var currentTrackId;
	function refreshCurrentTrack(view) {
		var track = view.$(".track[data-id='" + currentTrackId + "']"),
			playing = view.$(".track.playing");

		if (playing) {
			playing.classList.remove("playing");
		}

		if (track) {
			track.classList.add("playing");
		}
	}
	*/

	ui.started.add(function() {
		ui.player.register("music", function(id) {
			return new MusicTrack(null, id);
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