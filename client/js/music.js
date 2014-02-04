/*jshint browser:true */
/*global define, console */

define(
[ "ui", "router", "albumlist", "player", "playlists" ],
function(ui, router, albumlist, player, playlists) {
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



	/*!
	 * Resource list helpers
	 */


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


	function refreshCurrentPlaylist(view) {
		var playlist = view.$(".playlist[data-name='" + currentPlaylist + "']"),
			playing = view.$(".playlist.playing"),
			floating = view.$(".playlist[data-name='!floating']");

		if (floating) {
			floating.style.display = currentPlaylist === "!floating" ? "block" : "none";
		}

		if (playing) {
			playing.classList.remove("playing");
		}

		if (playlist) {
			playlist.classList.add("playing");
		}
	}
		

	var activeView;
	function setupResourceList(view, listdef) {
		var resource = listdef.resource;
		var updater = listdef.dataUpdater;
		var template = listdef.template;
		var behaviour = listdef.behaviour;
		var routes = listdef.routes;

		if (routes) {
			Object.keys(routes).forEach(function(route) {
				router.on(route, routes[route].bind(null, view));
			});
		}

		var loaded = false;
		var promise;
		var data;
		var rendered;

		view.displayed.add(function() {
			activeView = view;

			if (!promise) {
				loaded = false;
				promise = resource.list();

				data = updater(data, []);

				// Render template
				try {
					rendered = template.render(data);
				} catch(e) {
					console.log("RENDER: " + e.stack);
				}

				view.appendChild(rendered);

				// Add scroll handler to load more
				view.scrolledToEnd.add(function() {
					if (!loaded) {
						view.$(".loading").style.display = "block";
						promise.fetchMore();
					}
				});

				promise
				.whenData(function(items) {
					// Call data updater
					data = updater(data, items);

					// Update template
					try {
						rendered.update(data);
					} catch(e) {
						console.log("UPDATE: " + e.stack);
					}

					refreshCurrentTrack(view);
					refreshCurrentPlaylist(view);

					view.$(".loading").style.display = "none";
					view.behave(behaviour);
				})
				.then(function() {
					// Nothing more to load
					loaded = true;
				})
				.otherwise(function(err) {
					console.log(err);
				});

				ui.stopping.add(function() {
					// Cancel loading when UI stops
					promise.cancel();
				});
			}

		});
	}



	/*!
	 * Global action routes
	 */


	router.on("!enqueue/:id", function(err, req, next) {
		var track = activeView.$(".track[data-id='" + req.match.id + "']");
		player.enqueue(track, player.playing === -1 ? 0 : player.playing + 1);

		next();
	});

	router.on("!add/:id", function(err, req, next) {
		var track = activeView.$(".track[data-id='" + req.match.id + "']");
		player.enqueue(track);

		next();
	});



	/*!
	 * Fill views when UI starts
	 */


	ui.started.add(function() {
		setupResourceList(ui.view("albums"), albumlist);
		setupResourceList(ui.view("playlists"), playlists);

		var playerView = ui.view("player");
		playerView.appendChild(player.render());
		playerView.show();
	});



	/*!
	 * Plugin manifest
	 */

	return {
		title: "music",
		css: "albumlist",
		views: {
			player: {
				type: "applet",
				css: "player"
			},

			albums: {
				type: "main",
				link: "albums"
			},

			playlists: {
				type: "main",
				link: "playlists",
				icon: "playlist"
			}
		}
	};
});