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


function getAlbumModel(mongoose, rest, logger, intents, misc) {
	var TrackSchema = new mongoose.Schema({
		path: String,
		mime: String,

		number: Number,
		title: String,

		bitrate: Number,
		length: Number,
		format: String
	});


	TrackSchema.virtual("artist").get(function() {
		return this.parent().artist;
	});

	TrackSchema.virtual("album").get(function() {
		return this.parent().title;
	});


	var AlbumSchema = new mongoose.Schema({
		artist: String,
		title: String,
		year: String,

		tracks: [TrackSchema]
	});

	AlbumSchema.index({ artist: 1, title: 1 }, { unique: true });

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
			artist: misc.titleCase(tags.artist || ""),
			title: misc.titleCase(tags.album || ""),
			year: tags.year || -1,
		};

		var trackData = {
			path: filepath,
			mime: mimetype,

			number: tags.track || -1,
			title: misc.titleCase(tags.title || ""),

			format: ffdata.format.format_name,
			bitrate: ffdata.format.bit_rate,
			length: ffdata.format.duration
		};

		function updateCallback(err, album) {
			if (err) {
				cb(err);
			} else {
				// Manual save event because findOneAndUpdate does not trigger post hooks
				intents.emit("nestor:watchable:save", "albums", album);
				logger.debug("Emitted save on album with %s tracks", album.tracks.length);

				intents.emit(
					"cover:album-art",
					album.artist,
					album.title,
					path.dirname(filepath)
				);

				cb(null, album);
			}
		}

		Album.findOneAndUpdate(
			{
				artist: albumData.artist,
				title: albumData.title,
				tracks: { $not: { $elemMatch: { path: filepath } } }
			},
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
					if (err.name === "MongoError" && err.lastErrorObject.code === 11000) {
						// Album without this track was not found but duplicate key
						// indicates the album exists with this track, update it
						Album.findOneAndUpdate(
							{
								artist: albumData.artist,
								title: albumData.title,
								tracks: { $elemMatch: { path: filepath } }
							},
							{
								$set: { "tracks.$": trackData }
							},
							updateCallback
						);
					} else {
						return cb(err);
					}
				} else if (!album) {
					return cb(new Error("No album after findOneAndUpdate !"));
				} else {
					// Album was either found without this track or created with no track
					Album.findOneAndUpdate(
						{ artist: albumData.artist, title: albumData.title },
						{ $push: { tracks: trackData } },
						updateCallback
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
						logger.debug("removing album %s - %s", album.artist, album.title);

						intents.emit("cover:album-art:remove", album.artist, album.title);

						album.remove(function(err) {
							if (err) {
								logger.error("Error removing album %s - %s: %s", album.artist, album.title, err.message);
							}
						});
					} else {
						// Force update
						intents.emit("nestor:watchable:save", "albums", album);
					}
				}
			}
		);
	};


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
			toObject: albumToObject
		});
	});


	rest.aggregate("tracks", Album, [
		{ $project: {
			_id: 0,
			albumId: "$_id",
			artist: 1,
			album: "$title",
			year: 1,
			tracks: 1,
		} },
		{ $unwind: "$tracks" },
		{ $sort: {
			artist: 1,
			album: 1,
			"tracks.number": 1
		} },
		{ $project: {
			_id: "$tracks.path",
			albumId: 1,
			artist: 1,
			album: 1,
			year: 1,
			number: "$tracks.number",
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