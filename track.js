/*jshint node:true */
"use strict";

var taglib = require("taglib");


/*!
 * REST handlers
 */


function getTrackFile(req, cb) {
	var file = req.mongoose.doc.file;

	process.nextTick(function() {
		cb.file(null, file.path, file.mime);
	});
}


/*!
 * Track model builder
 */

function getTrackModel(mongoose, rest, logger) {
	var TrackSchema = new mongoose.Schema({
		path: { type: String, index: 1 },
		mime: String,

		artist: String,
		album: String,
		number: Number,
		title: String,
		year: Number,

		bitrate: Number,
		length: Number,
		format: String
	});


	TrackSchema.index({ artist: 1, album: 1, number: 1 });


	TrackSchema.virtual("file").get(function() {
		return { path: this.path, mime: this.mime };
	});


	TrackSchema.statics.fromFile = function(path, mimetype, ffdata, tags, cb) {
		var trackdata = {
			path: path,
			mime: mimetype,

			title: tags.title || "",
			artist: tags.artist || "",
			album: tags.album || "",
			number: tags.track || -1,
			year: tags.year || -1,

			format: ffdata.format.format_name,
			bitrate: ffdata.format.bit_rate,
			length: ffdata.format.duration
		};

		Track.findOne({ path: path }, function(err, track) {
			if (err) {
				return cb(err);
			}

			if (track) {
				track.fromDisk = true;
				track.update(trackdata, function(err) {
					cb(err, track);
				});
			} else {
				track = new Track(trackdata);
				track.fromDisk = true;
				
				track.save(function(err) {
					cb(err, track);
				});
			}
		});
	};


	TrackSchema.statics.removeFile = function(path, found) {
		Track.findOne({ path: path }, function(err, track) {
			if (track) {
				track.remove();
				found(track);
			}
		});
	};


	TrackSchema.pre("save", function(next) {
		var track = this;

		// Only save tag if we did not just load the track from disk
		if (!this.fromDisk) {
			taglib.tag(this.path, function(err, tag) {
				if (err) {
					logger.warn("Could not reload tags from file %s: %s", track.path, err.message);
					return next();
				}

				tag.artist = track.artist;
				tag.album = track.album;
				tag.title = track.title;
				tag.track = track.number === -1 ? 0 : track.number;
				tag.year = track.year === -1 ? 0 : track.year;

				tag.save(function(err) {
					if (err) {
						logger.warn("Could not save tags to file %s: %s", track.path, err.message);
					}

					next();
				});
			});
		} else {
			next();
		}
	});


	var Track = mongoose.model("track", TrackSchema);


	rest.mongoose("tracks", Track)
		.set("sort", {
			artist: 1,
			album: 1,
			number: 1
		})
		.set("toObject", {
			virtuals: true,

			transform: function(doc, ret, options) {
				delete ret.__v;
				delete ret.id;
			}
		})
		.sub(":id/file")
			.get(getTrackFile);


	return Track;
}

module.exports = getTrackModel;