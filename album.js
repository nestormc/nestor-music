/*jshint node:true*/

"use strict";

var path = require("path");
var taglib = require("taglib");
var when = require("when");


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


function getAlbumModel(mongoose, rest, logger, intents, misc) {


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
			if (err) {
				cb(err);
			} else {
				cb(null, album.tracks.filter(function(t) { return t.path === path; })[0]);
			}
		});
	};


	AlbumSchema.statics.fromFile = function(filepath, mimetype, ffdata, tags, cb) {
		var albumData = {
			artist: tags.artist || "",
			title: tags.album || "",
			year: tags.year || -1,
		};

		var trackData = {
			path: filepath,
			mime: mimetype,

			number: tags.track || -1,
			artist: tags.artist || "",
			title: tags.title || "",

			format: ffdata.format.format_name,
			bitrate: ffdata.format.bit_rate,
			length: ffdata.format.duration
		};

		function updateCallback(err, album) {
			if (err) {
				cb(err);
			} else if (!album) {
				cb(new Error("no album for " + this));
			} else {
				album.dispatchWatchable("save");

				intents.emit(
					"cover:album-art",
					album.artist,
					album.title,
					path.dirname(filepath)
				);

				cb(null, album);
			}
		}


		var artistCondition = { $or: [
			// album artist is track artist
			{ artist: albumData.artist },

			// album artist contains track artist
			{ artist: { $regex: new RegExp(regexpEscape(albumData.artist), "i") } },

			// track artist contains album artist
			{ $where: "\"" + quoteEscape(albumData.artist.toLowerCase()) + "\".indexOf(this.artist.toLowerCase()) !== -1" }
		] };


		Album.findOneAndUpdate(
			{ $and: [
				artistCondition,
				{
					title: albumData.title,
					tracks: { $not: { $elemMatch: { path: filepath } } }
				}
			] },
			{
				$setOnInsert: {
					artist: albumData.artist,
					title: albumData.title,
					year: albumData.year,
					tracks: []
				}
			},
			{ upsert : true },
			function(err, album) {
				if (err) {
					if (err.name === "MongoError" && err.lastErrorObject && err.lastErrorObject.code === 11000) {
						// Album without this track was not found but duplicate key
						// indicates the album exists with this track, update it
						Album.findOneAndUpdate(
							{ $and: [
								artistCondition,
								{
									title: albumData.title,
									tracks: { $elemMatch: { path: filepath } }
								}
							] },
							{
								$set: { "tracks.$": trackData }
							},
							updateCallback.bind("exists " + JSON.stringify(trackData))
						);
					} else {
						return cb(err);
					}
				} else if (!album) {
					return cb(new Error("No album after findOneAndUpdate !"));
				} else {
					// Album was either found without this track or created with no track
					Album.findOneAndUpdate(
						{ $and: [
							artistCondition,
							{ title: albumData.title }
						] },
						{ $push: { tracks: trackData } },
						updateCallback.bind("notfound " + JSON.stringify(trackData))
					);
				}
			}
		);
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
						logger.debug("Emit save on album %s", album.description);
						intents.emit("nestor:watchable:save", "albums", album);
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