/*jshint node:true */
"use strict";

var when = require("when");
var path = require("path");
var taglib = require("taglib");
var util = require("util");

var getAlbumModel = require("./album");


function musicPlugin(nestor) {
	var intents = nestor.intents;
	var logger = nestor.logger;
	var mongoose = nestor.mongoose;
	var rest = nestor.rest;
	var misc = nestor.misc;

	var Album = getAlbumModel(mongoose, rest, logger, intents, misc);

	// When a file is found, try to read its tags
	intents.on("media:file", function(path, mime, ffmeta) {
		if (!ffmeta) {
			return;
		}

		var hasAudioStreams = ffmeta.streams.some(function(stream) { return stream.codec_type === "audio"; });
		var hasVideoStreams = ffmeta.streams.some(function(stream) { return stream.codec_type === "video"; });

		// Only handle files with only audio streams
		if (hasAudioStreams && !hasVideoStreams) {
			intents.emit("nestor:scheduler:enqueue", "music:read-tags", { path: path, mime: mime, meta: ffmeta });
		}
	});

	// When a file is removed, remove the corresponding track
	intents.on("media:removed", function(path) {
		Album.removeFile(path);
	});

	// When tags have been read from a file, add/update track in DB
	intents.on("music:tags", function(filepath, mime, ffmeta, tags) {
		Album.fromFile(filepath, mime, ffmeta, tags, function(err) {
			if (err) {
				logger.error("Could not update album from track %s: %s", filepath, err.stack);
			}
		});
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
				var trackPath = parts.shift();

				Album.getTrack(trackPath, function(err, track) {
					if (err || !track) {
						callback(new Error("Unknown track " + trackPath));
					} else {
						builder.addFile(path.basename(track.path), track.path);
						callback();
					}
				});
			} else if (type === "album") {
				var albumId = parts.shift();

				Album.findById(albumId, function(err, album) {
					if (err || !album) {
						callback(new Error("Unknown album " + albumId));
					} else {
						var albumdir = album.artist + " - " + album.title;
						album.tracks.forEach(function(track) {
							var trackfile;

							if (track.number === -1) {
								trackfile = util.format("%s.%s", track.title, track.format);
							} else {
								trackfile = util.format("%d - %s.%s", track.number, track.title, track.format);
							}

							builder.addFile(path.join(albumdir, trackfile), track.path);
						});

						builder.setDownloadFilename(albumdir + ".zip");
						callback();
					}
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

	client: {
		public: __dirname + "/client/public",

		build: {
			base: __dirname + "/client"
		}
	}
};

module.exports = musicPlugin;