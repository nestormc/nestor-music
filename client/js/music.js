/*jshint browser:true */
/*global define, console */

define(
[ "ui", "router", "track", "albumlist", "contentlist" ],
function(ui, router, MusicTrack, albumlist, setupContentList) {
	"use strict";


	// TODO un-global this
	window.humanTime = function(duration) {
		var hours = Math.floor(duration / 3600),
			minutes = Math.floor(duration % 3600 / 60),
			seconds = Math.floor(duration) % 60;
		
		return hours === 0 ? minutes + ":" + (seconds > 9 ? seconds : "0" + seconds)
						   : hours + "h" + (minutes > 9 ? minutes : "0" + minutes) + "m" + (seconds > 9 ? seconds : "0" + seconds) + "s";
	};




	/*!
	 * Player state change handlers
	 */


/*
	var currentTrackId;
	player.currentTrackChanged.add(function(trackId) {
		currentTrackId = trackId;
		if (activeView) refreshCurrentTrack(activeView);
	});

	var currentPlaylist;
	player.currentPlaylistChanged.add(function(playlist) {
		currentPlaylist = playlist;
		if (activeView) refreshCurrentPlaylist(activeView);
	});
*/


	/*!
	 * Resource list helpers
	 */


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


	ui.player.register("music", function(id) {
		return new MusicTrack(null, id);
	});


	/*!
	 * Fill views and setup routes when UI starts
	 */


	ui.started.add(function() {
		var albumView = ui.view("albums");
		setupContentList(albumView, albumlist);

		albumView.loading.add(function(loading) {
			albumView.$(".loading").style.display = loading ? "block" : "none";
		});

		router.on("!enqueue/:id", function(err, req, next) {
			var track = setupContentList.activeView.$(".track[data-id='" + req.match.id + "']");

			ui.player.enqueue({
				provider: "music",
				id: req.match.id,
				track: new MusicTrack(track.dataset)
			}, true);

			next();
		});

		router.on("!add/:id", function(err, req, next) {
			var track = setupContentList.activeView.$(".track[data-id='" + req.match.id + "']");

			ui.player.enqueue({
				provider: "music",
				id: req.match.id,
				track: new MusicTrack(track.dataset)
			});

			next();
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