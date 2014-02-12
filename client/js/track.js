/*jshint browser:true*/
/*global define*/

define(["when", "ui", "resources", "ist!templates/dataset"], function(when, ui, resources, dsTemplate) {
	"use strict";


	var lastCover;
	var coverContainer;
	function getTrackDisplay(cover) {
		if (cover === lastCover) {
			return coverContainer;
		}

		if (!coverContainer) {
			coverContainer = document.createElement("div");
			coverContainer.style.backgroundSize = "contain";
			coverContainer.style.backgroundRepeat = "no-repeat";
			coverContainer.style.backgroundPosition = "center center";
			coverContainer.style.transition = "background .2s ease-in-out";
		}

		function setImage(src) {
			coverContainer.style.backgroundImage = "url(" + src + ")";
		}

		var img = new Image();

		img.addEventListener("error", function() {
			setImage("images/nocover.svg");
		});

		img.addEventListener("load", function() {
			setImage(img.src);
		});

		lastCover = img.src = cover;
		return coverContainer;
	}




	function trackPlayable(track) {
		track.playable.dispatch();
	}


	function trackEnded(track) {
		track.ended.dispatch();
	}


	function trackLoadProgress(track) {
		var audio = track.audio;

		if (audio.buffered.length) {
			if (Math.abs(audio.buffered.end(audio.buffered.length - 1) - audio.duration) < 0.1) {
				track.loaded.dispatch();
			}
		}
	}


	function trackTimeUpdate(track) {
		track.timeChanged.dispatch(track.audio.currentTime);
	}


	function trackDurationChange(track) {
		track.lengthChanged.dispatch(track.audio.duration);
	}


	function MusicTrack(dataset, id) {
		var audio = new Audio();
		this.audio = audio;

		audio.preload = "none";
		audio.autoplay = false;

		this.data = null;

		var audioEvents = {
			"canplay": trackPlayable.bind(null, this),
			"ended": trackEnded.bind(null, this),
			"timeupdate": trackTimeUpdate.bind(null, this),
			"durationchange": trackDurationChange.bind(null, this),
			"progress": trackLoadProgress.bind(null, this),
			// "error": trackError.bind(null, this)
		};
		this.events = audioEvents;

		Object.keys(audioEvents).forEach(function(event) {
			audio.addEventListener(event, audioEvents[event]);
		});

		var metadataDeferred = when.defer();
		var displayDeferred = when.defer();
		var datasetDeferred = when.defer();

		this.requestedLoad = false;
		this.requestedSeek = null;

		this.data = datasetDeferred.promise;
		this.data.then(function(d) {
			metadataDeferred.resolve({
				title: d.title,
				subtitle: d.artist
			});

			var coverUrl = "/rest/covers/album:" + d.artist + ":" + d.album;
			displayDeferred.resolve(getTrackDisplay(coverUrl));
		});

		if (dataset) {
			datasetDeferred.resolve(dataset);
		} else {
			resources.tracks.get(id).then(function(track) {
				var element = dsTemplate.render(track).firstChild;
				datasetDeferred.resolve(element.dataset);
			});
		}

		this.playable = ui.signal();
		this.loaded = ui.signal();
		this.ended = ui.signal();
		this.timeChanged = ui.signal();
		this.lengthChanged = ui.signal();
		this.metadata = metadataDeferred.promise;
		this.display = displayDeferred.promise;
	}


	MusicTrack.prototype = {
		load: function() {
			var track = this;

			this.requestedLoad = true;
			this.data.then(function(d) {
				if (track.requestedLoad) {
					if (track.audio.src === "") {
						track.audio.src = d.file;
					}

					track.audio.preload = "auto";
				}
			});
		},

		stopLoading: function() {
			this.requestedLoad = false;

			this.audio.src = "";
			this.audio.preload = "none";
		},

		play: function() {
			if (this.requestedSeek !== null) {
				this.audio.currentTime = this.requestedSeek;
				this.requestedSeek = null;
			}

			this.audio.play();
		},

		pause: function() {
			this.audio.pause();
		},

		seek: function(time) {
			try {
				this.audio.currentTime = time;
			} catch(e) {
				this.requestedSeek = time;
			}
		},

		dispose: function() {
			var audioEvents = this.events;
			var audio = this.audio;

			Object.keys(audioEvents).forEach(function(event) {
				audio.removeEventListener(event, audioEvents[event]);
			});

			audio.pause();
			audio.preload = "none";
			audio.src = "";

			this.playable.dispose();
			this.loaded.dispose();
			this.ended.dispose();
			this.timeChanged.dispose();
			this.lengthChanged.dispose();
		}
	};


	return MusicTrack;
});