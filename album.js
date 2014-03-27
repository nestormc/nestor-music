/*jshint node:true*/

"use strict";

var path = require("path");
var taglib = require("taglib");
var when = require("when");
var util =require("util");


function getTrackFile(req, cb) {
	var track = req.mongoose.item;

	process.nextTick(function() {
		cb.file(null, track.path, track.mime);
	});
}

function regexpEscape(str) {
	return str.replace(/([[\\\].*?+()])/g, "\\$1");
}

function quoteEscape(str) {
	return str.replace(/([\\"])/g, "\\$1");
}

function commonString(strings) {
	return strings

	// Remove duplicates
	.reduce(function(uniques, string) {
		if (uniques.indexOf(string) === -1) {
			uniques.push(string);
		}

		return uniques;
	}, [])

	// Sort by length
	.sort(function(a, b) {
		return a.length - b.length;
	})

	// Find out if the shortest one is a substring of the others
	.reduce(function(shortest, string) {
		return string.toLowerCase().indexOf(shortest.toLowerCase()) !== -1 ? shortest : "";
	});
}


function getAlbumModel(mongoose, rest, logger, intents) {


	/*!
	 * Track schema
	 */


	var TrackSchema = new mongoose.Schema({
		path: String,
		mime: String,

		number: Number,
		artist: String,
		title: String,

		bitrate: Number,
		length: Number,
		format: String
	});


	TrackSchema.virtual("albumArtist").get(function() {
		return this.parent().artist;
	});

	TrackSchema.virtual("album").get(function() {
		return this.parent().title;
	});


	/*!
	 * Album schema
	 */

	var AlbumSchema = new mongoose.Schema({
		artist: String,
		title: String,
		year: String,

		tracks: [TrackSchema]
	});

	AlbumSchema.index({ artist: 1, title: 1 }, { unique: true });

	// Save tags to files pre saving an album
	AlbumSchema.pre("save", function(next) {
		var album = this;

		when.all(album.tracks.map(function(track) {
			var d = when.defer();

			if (track.metadataChanged) {
				taglib.tag(track.path, function(err, tag) {
					if (err) {
						logger.warn("Could not reload tags from file %s: %s", track.path, err.message);
						return next();
					}

					tag.title = track.title;
					tag.track = track.number === -1 ? 0 : track.number;

					tag.save(function(err) {
						if (err) {
							logger.warn("Could not save tags to file %s: %s", track.path, err.message);
						}

						next();
					});
				});
			} else {
				d.resolve();
			}

			return d.promise;
		}))
		.then(function() {
			album.dispatchWatchable("save");
			next();
		})
		.otherwise(function(err) {
			next(err);
		});
	});


	AlbumSchema.statics.getTrack = function(path, cb) {
		Album.findOne({ tracks: { $elemMatch: { path: path } } }, function(err, album) {
			if (err || !album) {
				cb(err);
			} else {
				cb(null, album.tracks.filter(function(t) { return t.path === path; })[0]);
			}
		});
	};


	AlbumSchema.statics.fromFile = function(filepath, mimetype, ffdata, tags, cb) {
		var albumData = {
			artist: tags.artist || "Unknown artist",
			title: tags.album || "Unknown album",
			year: tags.year || -1,
			tracks: []
		};

		var trackData = {
			path: filepath,
			mime: mimetype,

			number: tags.track || -1,
			artist: tags.artist || "Unknown artist",
			title: tags.title || "Unknown title",

			format: ffdata.format.format_name,
			bitrate: ffdata.format.bit_rate,
			length: ffdata.format.duration
		};

		var trackDebug = trackData.artist + "/"  + trackData.title+ "/" + albumData.title;

		// First try to find existing track
		Album.findOne({ tracks: { $elemMatch: { path: filepath } } }, function(err, album) {
			if (err) {
				logger.error("ERROR find track: %s on %s", err.message, trackDebug);
				return cb(err);
			}

			if (!album) {
				// No album with track was found, try to find and update matching album, or create one
				var albumCondition = { $and: [
						{ $or: [
							// album artist is track artist
							{ artist: albumData.artist },

							// album artist contains track artist
							{ artist: { $regex: new RegExp(regexpEscape(albumData.artist), "i") } },

							// track artist contains album artist
							{ $where: "\"" + quoteEscape(albumData.artist.toLowerCase()) + "\".indexOf(this.artist.toLowerCase()) !== -1" }
						] },
						{ title: albumData.title }
					] };

				Album.findOneAndUpdate(
					albumCondition,
					{ $setOnInsert: albumData },
					{ upsert: true },
					function(err, album) {
						if (err) {
							logger.error("ERROR upsert: %s on %s", err.message, trackDebug);
							return cb(err);
						}

						if (!album) {
							logger.error("ERROR upsert: no album on %s", trackDebug);
							return cb(new Error("No album after upsert !?"));
						}

						// Album was either found without this track or created empty: add track
						var updateOp = { $push: { tracks: trackData } };

						if (albumData.year !== -1) {
							// Update album year if we have something meaningful
							updateOp.year = albumData.year;
						}

						Album.findOneAndUpdate(
							{ _id: album._id},
							updateOp,
							function(err, album) {
								if (err) {
									logger.error("ERROR add track: %s on %s", err.message, trackDebug);
									return cb(err);
								}

								if (!album) {
									logger.error("ERROR add track: no album on %s", trackDebug);
									return cb(new Error("No album after add track !?"));
								}

								// Dispatch watchable save event
								album.dispatchWatchable("save");
								cb();
							}
						);
					}
				);
			} else {
				// Album with track found, nothing to do
				cb();
			}
		});
	};


	AlbumSchema.statics.removeFile = function(path) {
		Album.findOneAndUpdate(
			{ tracks: { $elemMatch: { path: path } } },
			{ $pull: { tracks: { path: path } } },
			function(err, album) {
				if (err) {
					logger.error("Error removing track %s from album: %s", path, err.message);
				} else if (album) {
					if (album.tracks.length === 0) {
						// Remove album if empty
						logger.debug("removing album %s", album.description);

						album.remove(function(err) {
							if (err) {
								logger.error("Error removing album %s: %s", album.description, err.message);
							}

							intents.emit("cover:album-art:remove", album.description);
							album.dispatchWatchable("remove");
						});
					} else {
						album.dispatchWatchable("save");
					}
				}
			}
		);
	};


	// Throttle save events dispatched to watchable
	var pending = { save: {}, remove: {} };
	var SAVE_THROTTLE = 1000;
	AlbumSchema.methods.dispatchWatchable = function(operation) {
		var self = this;
		var id = this._id.toString();

		if (id in pending.save) {
			clearTimeout(pending.save[id]);
			delete pending.save[id];
		}

		if (id in pending.remove) {
			clearTimeout(pending.remove[id]);
			delete pending.remove[id];
		}

		pending[operation][id] = setTimeout(function() {
			if (operation === "save") {
				// Reload album to make sure it is up to date
				Album.findById(id, function(err, album) {
					if (err || !album) {
						logger.error("Error reloading album: %s", err ? err.message : "not found²");
					} else {
						// Aggregate track artists into album artist
						var albumArtist = commonString(album.tracks.map(function(track) { return track.artist; }));
						if (albumArtist === "" && album.tracks.length > 1) {
							albumArtist = "Various artists";
						}

						if (albumArtist !== album.artist) {
							Album.findOneAndUpdate(
								{ _id: id },
								{ artist: albumArtist },
								{},
								function(err) {
									if (err) {
										logger.error("Error setting album artist: %s", err.message);
									} else {
										album.dispatchWatchable("save");
									}
								}
							);
						} else {
							intents.emit(
								"cover:album-art",
								album.artist,
								album.title
							);

							logger.debug("Emit save on album %s", album.description);
							intents.emit("nestor:watchable:save", "albums", album);
						}
					}
				});
			} else {
				// No need to reload album
				logger.debug("Emit remove on album %s", self.description);
				intents.emit("nestor:watchable:remove", "albums", self);
			}
		}, SAVE_THROTTLE);
	};


	AlbumSchema.virtual("description").get(function() {
		return this.artist + " - " + this.title + " (" + this.tracks.length + " tracks)";
	});

	var Album = mongoose.model("albums", AlbumSchema);

	var albumSort = {
			artist: 1,
			year: 1,
			title: 1
		};

	var albumToObject = {
			virtuals: true,

			transform: function(doc, ret, options) {
				delete ret.__v;

				if (ret.tracks) {
					ret.tracks.sort(function(a, b) {
						return a.number - b.number;
					});
				}
			}
		};




	rest.mongoose("albums", Album)
		.set("sort", albumSort)
		.set("toObject", albumToObject);


	intents.on("nestor:startup", function() {
		intents.emit("nestor:watchable", "albums", Album, {
			sort: albumSort,
			toObject: albumToObject,
			noHooks: true
		});
	});


	rest.aggregate("tracks", Album, [
		{ $project: {
			_id: 0,
			albumId: "$_id",
			albumArtist: "$artist",
			album: "$title",
			year: 1,
			tracks: 1,
		} },
		{ $unwind: "$tracks" },
		{ $sort: {
			albumArtist: 1,
			album: 1,
			"tracks.number": 1
		} },
		{ $project: {
			_id: "$tracks.path",
			albumId: 1,
			albumArtist: 1,
			album: 1,
			year: 1,
			number: "$tracks.number",
			artist: "$tracks.artist",
			title: "$tracks.title",
			length: "$tracks.length",
			path: "$tracks.path",
			mime: "$tracks.mime",
			format: "$tracks.format",
			bitrate: "$tracks.bitrate"
		} }
	])
		.sub(":id/file")
		.get(getTrackFile);

	return Album;
}



module.exports = getAlbumModel;