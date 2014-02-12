/*jshint browser:true */
/*global define */

define([
	"ist", "ui", "dom", "router", "when", "plugins",

	"resources", "util", "track",

	"ist!templates/albumlist"
], function(ist, ui, dom, router, when, plugins, resources, util, MusicTrack, template) {
	"use strict";

	var $ = dom.$,
		$$ = dom.$$,
		$P = dom.$P;



	// Group albums by artist
	function dataModifier(albums) {
		var artists = [];
		var artnames = [];

		albums.forEach(function(album) {
			var artist = album.artist;
			var artidx = artnames.indexOf(artist);

			if (artidx === -1) {
				artnames.push(artist);
				artists.push({ name: artist, albums: [] });
				artidx = artists.length - 1;
			}

			artists[artidx].albums.push(album);
		});

		return { artists: artists };
	}


	var behaviour = {
		".cover > img": {
			"error": function() {
				this.src = "images/nocover.svg";
			}
		},

		".cover": {
			"dragover": function(e) {
				var dropzone = $(this, ".dropzone");

				if (dropzone.promise) {
					return;
				}

				dropzone.classList.add("dragging");
				dropzone.promise = util.dropImage(e.dataTransfer);

				dropzone.promise
				.then(function(src) {
					dropzone.classList.add("valid");
					$(dropzone, ".valid").src = src;
				})
				.otherwise(function() {
					dropzone.classList.add("invalid");
				});

				e.preventDefault();
				return false;
			}
		},

		".cover .dropzone": {
			"dragleave": function(e) {
				delete this.promise;

				this.classList.remove("dragging");
				this.classList.remove("valid");
				this.classList.remove("invalid");

				e.stopPropagation();
			},

			"drop": function(e) {
				var album = $P(this, ".album"),
					dropzone = this;

				this.promise.then(function(src) {
					$(album, ".cover img").src = src;
					resources.covers.save(album.dataset.artist, album.dataset.title, src);
					delete dropzone.promise;
				})
				.otherwise(function() {
					delete dropzone.promise;
				});

				this.classList.remove("dragging");
				this.classList.remove("valid");
				this.classList.remove("invalid");

				e.preventDefault();
				return false;
			}
		},

		".list": {
			/* Unselect tracks */
			"click": function(e) {
				var view = $P(this, ".main-view");

				e.preventDefault();

				view.$$(".selected").forEach(function(sel) {
					sel.classList.remove("selected");
				});

				return false;
			}
		},

		"li.track": {
			/* Prevent text selection when shift-clicking tracks */
			"mousedown": function(e) {
				if (e.shiftKey || e.ctrlKey || e.target.contentEditable !== "true") {
					e.preventDefault();
				}
				return false;
			},

			/* Handle track selection with click, ctrl+click, shift+click */
			"click": (function() {
				var firstClicked;

				return function(e) {
					var view = $P(this, ".main-view");

					e.preventDefault();
					e.stopPropagation();

					if (!e.ctrlKey) {
						view.$$(".selected").forEach(function(sel) {
							sel.classList.remove("selected");
						});
					}

					if (e.shiftKey && firstClicked) {
						var tracks = view.$$("li.track"),
							idx1 = tracks.indexOf(firstClicked),
							idx2 = tracks.indexOf(this);

						tracks.slice(Math.min(idx1, idx2), Math.max(idx1, idx2) + 1).forEach(function(track) {
							track.classList.add("selected");
						});

						return false;
					}

					if (e.ctrlKey) {
						this.classList.add("selected");
						firstClicked = this;
						return false;
					}

					this.classList.add("selected");
					firstClicked = this;

					return false;
				};
			}()),

			"dblclick": function(e) {
				var view = $P(this, ".main-view");

				e.preventDefault();

				var tracks = view.$$(".selected"),
					index = tracks.indexOf(this);

				if (tracks.length === 1) {
					// Put whole album in playlist
					var selectedTrack = tracks[0];

					tracks = $$(selectedTrack.parentNode, ".track");
					index = tracks.indexOf(selectedTrack);
				}

				ui.player.clear();
				ui.player.enqueue(tracks.map(function(track) {
					return {
						provider: "music",
						id: track.dataset.id,
						track: new MusicTrack(track)
					};
				}));

				ui.player.play(index);

				return false;
			}
		}
	};


	return {
		resource: resources.albums,
		dataModifier: dataModifier,
		behaviour: behaviour,

		root: {
			template: template,
			selector: ".albumlist",
			nextArray: "artists",
			nextConfig: "artist"
		},

		artist: {
			template: ist("@use 'music-albums-artist'"),
			key: "name",
			selector: ".artist[data-name='%s']",
			nextArray: "albums",
			nextConfig: "album"
		},

		album: {
			template: ist("@use 'music-albums-album'"),
			key: "_id",
			selector: ".album[data-id='%s']"
		},


		routes: {
			"!shareAlbum/:id/:artist/:title": function(view, err, req, next) {
				plugins.share("music", "album:" + req.match.id, "Album " + req.match.artist + " - " + req.match.title);
				next();
			},

			"!editAlbum/:id": function(view, err, req, next) {
				var album = view.$(".album[data-id='" + req.match.id + "']");
				album.classList.add("editing");

				$$(album, ".editable").forEach(function(elem) {
					elem.previousContent = elem.textContent;
					elem.contentEditable = "true";
				});

				next();
			},

			"!cancelAlbumEdit/:id": function(view, err, req, next) {
				var album = view.$(".album[data-id='" + req.match.id + "']");
				album.classList.remove("editing");

				$$(album, ".editable").forEach(function(elem) {
					elem.textContent = elem.previousContent;
					elem.contentEditable = "inherit";
				});

				next();
			},

			"!commitAlbumEdit/:id": function(view, err, req, next) {
				var album = view.$(".album[data-id='" + req.match.id + "']");
				album.classList.remove("editing");

				var trackUpdates = {},
					trackIds = $$(album, ".track").map(function(elem) { return elem.dataset.id; });

				/* Gather edited data in trackUpdates */
				$$(album, ".editable").forEach(function(elem) {
					elem.contentEditable = "inherit";

					if (elem.textContent !== elem.previousContent) {
						var targets, field;

						if (elem.classList.contains("name")) {
							targets = trackIds;
							field = "artist";
						}

						if (elem.classList.contains("year")) {
							targets = trackIds;
							field = "year";
						}

						if (elem.classList.contains("title")) {
							if (elem.parentNode.classList.contains("track")) {
								targets = [elem.parentNode.dataset.id];
								field = "title";
							} else {
								targets = trackIds;
								field = "album";
							}
						}

						if (elem.classList.contains("number")) {
							targets = [elem.parentNode.dataset.id];
							field = "number";
						}

						targets.forEach(function(trackId) {
							if (!(trackId in trackUpdates)) {
								trackUpdates[trackId] = {};
							}

							trackUpdates[trackId][field] = elem.textContent;
						});
					}
				});

				when.map(Object.keys(trackUpdates), function(trackId) {
					return resources.tracks.update(trackId, trackUpdates[trackId]);
				}).otherwise(function(err) {
					ui.error("Update error", err.stack);
				}).ensure(function() {
					// TODO update album
					console.log("Update finished");
				});

				next();
			}
		}
	};
});