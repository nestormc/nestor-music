/*jshint node:true*/
"use strict";

var when = require("when");
var fs = require("fs");
var glob = require("glob");
var path = require("path");
var musicbrainz = require("./musicbrainz");

var fetchers = [];

var coverKeywords = ["cover", "front", "albumart", "folder"];
var coverExts = {
	"jpg": "image/jpeg",
	"jpeg": "image/jpeg",
	"png": "image/png"
};
var coverPattern = "*{" + coverKeywords.join(",") + "}*.{" + Object.keys(coverExts).join(",") + "}";

/* Time to wait after last file discovery before searching on MusicBrainz */
var MB_SEARCH_AFTER = 20000;


function CoverFetcher(Image, nestor, artist, album) {
	this.found = false;

	this.Image = Image;
	this.logger = nestor.logger;
	this.intents = nestor.intents;

	this.artist = artist;
	this.album = album;
	this.key = "cover:" + artist + ":" + album;

	this.searchedDirs = [];
	this.lastSearch = this.searchExisting();
	this.mbSchedule = null;
	this.mbSearched = false;

	this.scheduleMusicBrainzSearch();
}

CoverFetcher.prototype.searchExisting = function() {
	var self = this;
	var d = when.defer();

	this.Image.findOne({ key: this.key }, function(err, image) {
		if (err) {
			d.reject(err);
			return self.logger.warn("Error while looking for existing image %s: %s", self.key, err.message);
		}

		if (image) {
			self.found = true;
		}

		d.resolve();
	});

	return d.promise;
};

CoverFetcher.prototype.storeCover = function(buffer, mimetype) {
	this.found = true;

	(new this.Image({
		key: this.key,
		data: buffer,
		mime: mimetype
	})).save();
};

CoverFetcher.prototype.enqueueSearcher = function(searcher) {
	if (this.found) {
		return;
	}

	var self = this;
	var next = when.defer();

	this.lastSearch.then(function() {
		if (self.found) {
			return;
		}

		searcher(next);
	}).otherwise(function(err) {
		self.logger.error("Searcher error: %s", err.stack);
	});

	this.lastSearch = next.promise;
};

CoverFetcher.prototype.addFileHint = function(filepath, ffprobeData) {
	var self = this;

	// Local directory searcher
	var dir = path.dirname(filepath);
	if (this.searchedDirs.indexOf(dir) === -1) {
		this.searchedDirs.push(dir);

		self.logger.debug("Enqueuing dir search %s", dir);

		this.enqueueSearcher(function(next) {
			self.intents.emit("nestor:scheduler:enqueue", "music:images:search-dir", {
				dir: dir,
				callback: function(err, data, mime) {
					if (err) {
						self.logger.warn("Search error: %s", err.stack);
						next.reject(err);
					} else {
						next.resolve();

						if (data) {
							self.storeCover(data, mime);
						}
					}
				}
			});
		});
	}

	this.scheduleMusicBrainzSearch();
};

CoverFetcher.prototype.scheduleMusicBrainzSearch = function() {
	if (this.mbSchedule) {
		clearTimeout(this.mbSchedule);
	}

	var self = this;
	this.mbSchedule = setTimeout(function() {
		if (!self.mbSearched) {
			self.mbSearched = true;
			self.enqueueSearcher(function(next) {
				self.logger.debug("Searching on MusicBrainz for %s", self.key);

				musicbrainz.searchCoverArt(self.artist, self.album, function(err, data, mime) {
					if (err) {
						self.logger.warn("MusicBrainz error for %s: %s", self.key, err.message);
						next.reject(err);
					} else {
						next.resolve();

						if (data) {
							self.storeCover(data, mime);
						}
					}
				});
			});
		}
	}, MB_SEARCH_AFTER);
};


module.exports = function imageStore(nestor) {
	var mongoose = nestor.mongoose;
	var rest = nestor.rest;
	var logger = nestor.logger;
	var intents = nestor.intents;

	/* Image schema */

	var ImageSchema = new mongoose.Schema({
		key: { type: String, index: true },
		data: Buffer,
		mime: String
	});

	ImageSchema.virtual("length").get(function() {
		return this.data.length;
	});

	var Image = mongoose.model("music-image", ImageSchema);

	rest.mongoose("music-images", Image)
		.set("key", "key")
		.set("toObject", {
			virtuals: true,

			transform: function(doc, ret, options) {
				delete ret.__v;
				delete ret.id;
				delete ret.data;
			}
		})
		.sub(":imageKey")
			.get(function(req, cb) {
				var image = req.mongoose.doc;

				if (image) {
					cb(null, image.data, image.mime);
				} else {
					cb.notFound();
				}
			});

	intents.on("nestor:startup", function() {
		intents.emit("nestor:scheduler:register", "music:images:search-dir", function(data) {
			var dir = data.dir;
			var callback = data.callback;
			var d = when.defer();

			glob(coverPattern, { cwd: dir, nocase: true }, function(err, files) {
				if (err) {
					logger.warn("Error while globbing %s: %s", dir, err.message);
					callback(err);
					d.resolve();
				} else if (files.length > 0) {
					var file = files[0];
					var mime = coverExts[file.match(/\.([^.]*)$/)[1].toLowerCase()];

					fs.readFile(path.join(dir, file), function(err, data) {
						if (err) {
							logger.warn("Error while reading %s: %s", path.join(dir, file), err.message);
							callback(err);
							d.resolve();
						} else {
							callback(null, data, mime);
							d.resolve();
						}
					});
				} else {
					callback();
					d.resolve();
				}
			});

			return d.promise;
		});
	});

	return {
		fetchAlbumCover: function(artist, album, fileHints) {
			var key = "cover:" + artist + ":" + album;

			if (!(key in fetchers)) {
				logger.debug("Creating CoverFetcher for %s", key);
				fetchers[key] = new CoverFetcher(Image, nestor, artist, album);
			}

			if (fileHints) {
				Object.keys(fileHints).forEach(function(filepath) {
					fetchers[key].addFileHint(filepath, fileHints[filepath]);
				});
			}
		},

		removeAlbumCover: function(artist, album) {
			Image.remove({ key: "cover:" + artist + ":" + album });
		}
	};
};