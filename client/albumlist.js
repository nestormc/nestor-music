/*jshint browser:true */
/*global define */

define([
	"ist", "ui", "dom", "router", "when", "plugins",

	"resources", "util",

	"ist!templates/albumlist"
], function(ist, ui, dom, router, when, plugins, resources, util, template) {
	"use strict";

	var $ = dom.$,
		$$ = dom.$$,
		$P = dom.$P;



	// Group albums by artist
	function dataMapper(albums) {
		var data = { artists: [] };
		var artIndexes = {};

		albums.forEach(function(album) {
			if (album.artist in artIndexes) {
				data.artists[artIndexes[album.artist]].albums.push(album);
			} else {
				artIndexes[album.artist] = data.artists.length;
				data.artists.push({
					name: album.artist,
					albums: [album]
				});
			}
		});

		return data;
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
		}
	};


	var contentListConfig = {
		resource: resources.albums,
		dataMapper: dataMapper,
		behaviour: behaviour,

		listSelection: {
			itemSelector: "li.track",
			listSelector: ".album",
			onItemDblClick: function(selectedItems, index) {
				ui.player.clear();
				ui.player.enqueue(selectedItems.map(function(track) {
					return {
						track: new ui.player.Track("music", track.dataset.path)
					};
				}));

				ui.player.play(index);
			}
		},

		root: {
			template: template,
			selector: ".albumlist",
			childrenArray: "artists",
			childrenConfig: "artist",
			childSelector: ".artist"
		},

		artist: {
			template: ist("@use 'music-albums-artist'"),
			key: "name",
			selector: ".artist[data-name='%s']",
			childrenArray: "albums",
			childrenConfig: "album",
			childSelector: ".album"
		},

		album: {
			template: ist("@use 'music-albums-album'"),
			key: "_id",
			selector: ".album[data-id='%s']"
		},


		routes: {
			"!enqueue/track/:path": function(view, err, req, next) {
				ui.player.enqueue({
					track: new ui.player.Track("music", req.match.path)
				}, true);

				next();
			},

			"!add/track/:path": function(view, err, req, next) {
				ui.player.enqueue({
					track: new ui.player.Track("music", req.match.path)
				});

				next();
			},

			"!shareAlbum/:id/:artist/:title": function(view, err, req, next) {
				plugins.share("music", "album:" + req.match.id, "Album " + req.match.title + " by " + req.match.artist);
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
					trackPaths = $$(album, ".track").map(function(elem) { return elem.dataset.path; });

				/* Gather edited data in trackUpdates */
				$$(album, ".editable").forEach(function(elem) {
					elem.contentEditable = "inherit";

					if (elem.textContent !== elem.previousContent) {
						var targets, field;

						if (elem.classList.contains("name")) {
							targets = trackPaths;
							field = "artist";
						}

						if (elem.classList.contains("year")) {
							targets = trackPaths;
							field = "year";
						}

						if (elem.classList.contains("title")) {
							if (elem.parentNode.classList.contains("track")) {
								targets = [elem.parentNode.dataset.path];
								field = "title";
							} else {
								targets = trackPaths;
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


	ui.started.add(function() {
		var albumView = ui.view("albums");
		ui.helpers.setupContentList(albumView, contentListConfig);
	});
});