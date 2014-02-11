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


function getAlbumModel(mongoose, rest, logger, intents) {
	var AlbumSchema = new mongoose.Schema({
		artist: String,
		title: String,
		year: String,

		tracks: [{
			path: String,
			mime: String,

			number: Number,
			title: String,

			bitrate: Number,
			length: Number,
			format: String
		}]
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


	AlbumSchema.statics.getTrack = function(id, cb) {
		Album.findOne({ tracks: { $elemMatch: { _id: id } } }, function(err, album) {
			if (err) {
				cb(err);
			} else {
				cb(null, album.tracks.id(id));
			}
		});
	};


	AlbumSchema.statics.fromFile = function(filepath, mimetype, ffdata, tags, cb) {
		var trackData = {
			path: filepath,
			mime: mimetype,

			number: tags.track || -1,
			title: tags.title || "",

			format: ffdata.format.format_name,
			bitrate: ffdata.format.bit_rate,
			length: ffdata.format.duration
		};

		var albumData = {
			artist: tags.artist || "",
			title: tags.album || "",
			year: tags.year || -1,

			tracks: [trackData]
		};

		Album.findOne({ artist: albumData.artist, title: albumData.title }, function(err, album) {
			if (err) {
				return cb(err);
			}

			if (!album) {
				album = new Album(albumData);
			} else {
				// Look for track in album
				var track = album.tracks.filter(function(t) {
					return t.path === filepath;
				})[0];

				if (track) {
					// Update
					Object.keys(trackData).forEach(function(key) {
						track[key] = trackData[key];
					});
				} else {
					// Add new track
					album.tracks.push(trackData);
				}
			}

			album.save(function(err) {
				if (err) {
					if (err.name === "MongoError" && err.code === 11000) {
						// Duplicate unique key: the same album was created in the meantime,
						// just call fromFile again, which will find and update the album 

						Album.fromFile(filepath, mimetype, ffdata, tags, cb);
						return;
					}

					cb(err);
					return;
				}

				intents.emit(
					"cover:album-art",
					album.artist,
					album.title,
					path.dirname(filepath)
				);

				cb(null, album);
			});
		});
	};


	AlbumSchema.statics.removeFile = function(path) {
		Album.findOne({ tracks: { $elemMatch: { path: path } } }, function(err, album) {
			if (album) {
				var track = album.tracks.filter(function(t) {
					return t.path === path;
				})[0];

				album.tracks.pull(track._id);

				if (album.length) {
					album.save(function() {});
				} else {
					intents.emit("media:cover:remove", {
						key: "album:" + album.artist + ":" + album.title
					});

					album.remove(function() {});
				}

			}
		});
	};


	var Album = mongoose.model("albums", AlbumSchema);


	rest.mongoose("albums", Album)
		.set("sort", {
			artist: 1,
			album: 1
		});
		/*.set("toObject", {
			virtuals: true,

			transform: function(doc, ret, options) {
				delete ret.__v;
				delete ret.id;
			}
		});*/

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
			_id: "$tracks._id",
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