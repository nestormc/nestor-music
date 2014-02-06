/*jshint node:true */
"use strict";

var when = require("when");
var path = require("path");
var taglib = require("taglib");

var getTrackModel = require("./track");
var getPlaylistModel = require("./playlist");


function musicPlugin(nestor) {
	var intents = nestor.intents;
	var logger = nestor.logger;
	var mongoose = nestor.mongoose;
	var rest = nestor.rest;

	var Track = getTrackModel(mongoose, rest, logger);
	var Playlist = getPlaylistModel(mongoose, rest, Track);

	// When a file is found, try to read its tags
	intents.on("media:file", function(path, mime, ffmeta) {
		var hasAudioStreams = ffmeta.streams.some(function(stream) { return stream.codec_type === "audio"; });
		var hasVideoStreams = ffmeta.streams.some(function(stream) { return stream.codec_type === "video"; });

		// Only handle files with only audio streams
		if (hasAudioStreams && !hasVideoStreams) {
			intents.emit("nestor:scheduler:enqueue", "music:read-tags", { path: path, mime: mime, meta: ffmeta });
		}
	});

	// When a file is removed, remove the corresponding track
	intents.on("media:removed", function(path) {
		Track.removeFile(path, function(track) {
			if (track) {
				// Remove cover if no more tracks in album
				Track.count({ artist: track.artist, album: track.album }, function(err, count) {
					if (count === 0) {
						intents.emit("media:cover:remove", {
							key: "album:" + track.artist + ":" + track.album
						});
					}
				});

				// Remove track from playlists
				Playlist.removeTrack(track);
			}
		});
	});

	// When tags have been read from a file, add/update track in DB
	intents.on("music:tags", function(filepath, mime, ffmeta, tags) {
		Track.fromFile(filepath, mime, ffmeta, tags, function(err, track) {
			if (err) {
				logger.error("Could not update track %s: %s", filepath, err.stack);
			} else {
				intents.emit(
					"cover:album-art",
					track.artist,
					track.album,
					path.dirname(filepath)
				);
			}
		});
	});

	// When rest layer is ready, register resources
	intents.on("nestor:rest", function(rest) {
		Track.restSetup(rest);
		Playlist.restSetup(rest);
	});

	intents.on("nestor:startup", function() {
		// Register tag reader
		intents.emit("nestor:scheduler:register", "music:read-tags", function getFileTags(data) {
			var path = data.path;
			var mime = data.mime;
			var ffmeta = data.meta;

			logger.debug("Get tags for %s", path);

			var d = when.defer();

			taglib.read(path, function(err, tags) {
				if (err) {
					tags = {};
				}

				intents.emit("music:tags", path, mime, ffmeta, tags);
				d.resolve();
			});

			return d.promise;
		});

		// Register shared resource handler
		intents.emit("share:provider", "music", function(id, builder, callback) {
			if (id.indexOf(":") === -1) {
				callback(new Error("Invalid resource id: " + id));
				return;
			}

			var parts = id.split(":"),
				type = parts.shift();

			if (type === "track") {
				var trackId = parts.shift();
				Track.findById(trackId, function(err, track) {
					if (err || !track) {
						callback(new Error("Invalid track: " + trackId));
						return;
					}

					builder.addFile(path.basename(track.path), track.path);
					callback();
				});
			} else if (type === "album") {
				// Find artist and albums, inside which colons have been doubled
				// (eg artist = "foo", album = "bar:baz" => "foo:bar::baz")
				var mergedParts = [],
					state = "search";

				parts.forEach(function(part) {
					switch(state) {
						case "search":
							mergedParts.push(part);
							state = "part";
							break;

						case "part":
							if (part.length) {
								mergedParts.push(part);
							} else {
								state = "continue";
							}
							break;

						case "continue":
							mergedParts[mergedParts.length - 1] += ":" + part;
							state = "part";
							break;
					}
				});

				var artist = mergedParts[0],
					album = mergedParts[1];

				Track.find({ artist: artist, album: album }, function(err, tracks) {
					if (err || !tracks || !tracks.length) {
						callback(new Error("Invalid album: " + parts.join(":")));
						return;
					}

					var albumdir = artist + " - " + album;

					tracks.forEach(function(track) {
						var trackfile =
								(track.number > 0 ? String("0" + track.number).slice(-2) + " - " : "") +
								track.title +
								"." + track.format;

						builder.addFile(path.join(albumdir, trackfile), track.path);
					});

					builder.setDownloadFilename(albumdir + ".zip");
					callback();
				});
			} else {
				callback(new Error("Invalid resource type: " + type));
			}
		});
	});
}

musicPlugin.manifest = {
	name: "music",
	description: "Music library",
	dependencies: ["nestor-media"],
	recommends: ["nestor-coverart", "nestor-share"],
	clientDir: __dirname + "/client"
};

module.exports = musicPlugin;