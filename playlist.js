/*jshint node:true */
"use strict";

var ObjectId = require("mongodb").BSONPure.ObjectID;




/**
 * REST handlers
 */


function playlistTransform(doc, ret, options) {
	delete ret.__v;
	delete ret.id;
}


function playlistPOSTHandler(req, cb) {
	var playlist = req.mongoose.doc,
		index = NaN;

	if (req.param("index")) {
		index = Number(req.param("index"));
	}

	if (isNaN(index)) {
		index = playlist.tracks.length;
	}

	playlist.addTracks(
		Math.max(0, Math.min(playlist.tracks.length, index)),
		[req.body._id],
		function(err) { cb.status(400, err.message); }
	);
}


function playlistPUTHandler(req, isPatch, cb) {
	var playlist = req.mongoose.doc;

	// Empty playlist
	playlist.tracks.splice(0, playlist.tracks.length);

	// Add tracks from body
	playlist.addTracks(0, req.body.map(function(item) {
		return item._id;
	}), function(err) { cb(err); });
}



/*!
 * Playlist model builder
 */

function getPlaylistModel(mongoose, rest, Track) {
	var PlaylistSchema = new mongoose.Schema({
		name: String,
		tracks: [{ type: mongoose.Schema.Types.ObjectId, ref: "track" }]
	}, { id: false });


	PlaylistSchema.virtual("artists").get(function() {
		var artistCounts = {};

		this.tracks.forEach(function(track) {
			var artist = track.get("artist");

			if (artist in artistCounts) {
				artistCounts[artist]++;
			} else {
				artistCounts[artist] = 1;
			}
		});

		var artists = Object.keys(artistCounts);
		artists.sort(function(a, b) {
			return artistCounts[b] - artistCounts[a];
		});

		return artists;
	});

	PlaylistSchema.methods.addTracks = function(index, trackIDs, cb) {
		var $or = [],
			playlist = this;

		trackIDs.forEach(function(id) {
			var oid;

			try {
				oid = new ObjectId(id);
			} catch(e) {
				return;
			}

			$or.push({ _id: oid });
		});

		Track.find($or, function(err, tracks) {
			if (err) {
				cb(err);
				return;
			}

			var foundTracks = {};
			
			tracks.forEach(function(track) {
				foundTracks[track._id.toString()] = track._id;
			});

			for (var i = 0, len = trackIDs.length; i < len; i++) {
				var id = trackIDs[i];

				if (!(id in foundTracks)) {
					cb(new Error("Track " + id + " not found"));
					return;
				}

				playlist.tracks.splice(index, 0, foundTracks[id]);
				index++;
			}

			playlist.save(cb);
		});
	};


	PlaylistSchema.statics.removeTrack = function(track) {
		Playlist.find({ tracks: track._id }, function(err, playlists) {
			if (playlists) {
				playlists.forEach(function(playlist) {
					var index;

					while(-1 !== (index = playlist.tracks.indexOf(track._id.toString()))) {
						playlist.tracks.splice(index, 1);
					}

					playlist.save();
				});
			}
		});
	};


	var Playlist = mongoose.model("playlist", PlaylistSchema);


	rest.mongoose("playlists", Playlist)
		.set("key", "name")
		.set("sort", { name: 1 })
		.set("query", function() {
			return Playlist.find().populate("tracks");
		})
		.set("toObject", {
			virtuals: true,
			transform: playlistTransform
		})
		.sub(":name")
			// Add track, body = { _id: trackID }
			.post(playlistPOSTHandler)

			// Replace tracks, body = [{ _id: trackID }, ...]
			.put(playlistPUTHandler);


	return Playlist;
}


module.exports = getPlaylistModel;