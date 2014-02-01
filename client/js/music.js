/*jshint browser:true */
/*global define, console */

define(
[
	"ui", "router",

	"albumlist",
	"player",
	"playlists",

	"ist!templates/applet"
],
function(
	ui, router,

	albumlist,
	player,
	playlists,

	appletTemplate
) {
	"use strict";

	var music,
		currentTrackId, currentPlaylist;


	// TODO un-global this
	window.humanTime = function(duration) {
		var hours = Math.floor(duration / 3600),
			minutes = Math.floor(duration % 3600 / 60),
			seconds = Math.floor(duration) % 60;
		
		return hours === 0 ? minutes + ":" + (seconds > 9 ? seconds : "0" + seconds)
						   : hours + "h" + (minutes > 9 ? minutes : "0" + minutes) + "m" + (seconds > 9 ? seconds : "0" + seconds) + "s";
	};

/*
	var albumsNestedList = [
		// Toplevel
		{
			template: albumlistTemplate,
			selector: ".albumlist",
			children: "artists"
		},

		// Artists
		{
			template: "@use 'music-albums-artist'",
			key: "name",
			selector: ".artist[data-name=\"%s\"]",
			children: "albums"
		},

		// Albums
		{
			template: "@use 'music-albums-album'",
			key: "_id",
			selector: ".album[data-id=\"%s\"]",
			children: "tracks"
		},

		// Tracks
		{
			template: "@use 'music-albums-track'",
			key: "_id",
			selector: ".track[data-id=\"%s\"]"
		}
	];


	function nestedListUpdater(container, levels) {
		var rendered;

		function renderLevel(index, data) {
			if (index === 0) {
				// Top level
			}
		}

		return function update(data) {
		};
	}
*/


	music = {
		manifest: {
			"title": "music",
			"pages": {
				"albums": {},
				"playlists": { icon: "playlist" }
			}
		},

		currentContainer: null,

		setupListHandler: function(route, resource, updater, template, behaviour) {
			var loaded = false,
				promise, data, rendered;

			router.on(route, function(err, req, next) {
				if (err) {
					next(err);
					return;
				}

				var container = ui.container(route);

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
					container.appendChild(rendered);


					// Add scroll handler to load more
					container.scrolledToEnd.add(function() {
						if (!loaded) {
							container.$(".loading").style.display = "block";
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

						music.refreshCurrentTrack();
						music.refreshCurrentPlaylist();

						container.$(".loading").style.display = "none";
						container.behave(behaviour);
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

				music.currentContainer = container;
				container.show();
				next();
			});
		},

		refreshCurrentTrack: function() {
			if (music.currentContainer) {
				var track = music.currentContainer.$(".track[data-id='" + currentTrackId + "']"),
					playing = music.currentContainer.$(".track.playing");

				if (playing) {
					playing.classList.remove("playing");
				}

				if (track) {
					track.classList.add("playing");
				}
			}
		},

		refreshCurrentPlaylist: function() {
			if (music.currentContainer) {
				var playlist = music.currentContainer.$(".playlist[data-name='" + currentPlaylist + "']"),
					playing = music.currentContainer.$(".playlist.playing"),
					floating = music.currentContainer.$(".playlist[data-name='!floating']");

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
		},
		
		init: function() {
			ui.loadCSS("player");
			ui.loadCSS("albumlist", "");

			albumlist.init(this);
			playlists.init(this);

			/* Enqueue track actions */
		
			router.on("!enqueue/:id", function(err, req, next) {
				var track = music.currentContainer.$(".track[data-id='" + req.match.id + "']");
				player.enqueue(track, player.playing === -1 ? 0 : player.playing + 1);

				next();
			});

			router.on("!add/:id", function(err, req, next) {
				var track = music.currentContainer.$(".track[data-id='" + req.match.id + "']");
				player.enqueue(track);

				next();
			});

			/* Player state changes */

			player.currentTrackChanged.add(function(trackId) {
				currentTrackId = trackId;
				music.refreshCurrentTrack();
			});

			player.currentPlaylistChanged.add(function(playlist) {
				currentPlaylist = playlist;
				music.refreshCurrentPlaylist();
			});
		},
		
		renderApplet: function() {
			return appletTemplate.render({ player: player.render() });
		}
	};
	
	return music;
});