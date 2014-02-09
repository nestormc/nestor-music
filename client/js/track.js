/*jshint browser:true*/
/*global define*/

define(["ui"], function(ui) {
	"use strict";


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


	function MusicTrack(element) {
		var audio = new Audio();
		this.audio = audio;

		audio.preload = "none";
		audio.autoplay = false;

		this.data = element.dataset;

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

		this.playable = ui.signal();
		this.loaded = ui.signal();
		this.ended = ui.signal();
		this.timeChanged = ui.signal();
		this.lengthChanged = ui.signal();

		this.requestedSeek = null;
	}


	MusicTrack.prototype = {
		load: function() {
			if (this.audio.src === "") {
				this.audio.src = this.data.file;
			}

			this.audio.preload = "auto";
		},

		stopLoading: function() {
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
		},

		getMetadata: function() {
			return {
				title: this.data.title,
				subtitle: this.data.artist
			};
		},

		getDisplay: function() {
			var container = document.createElement("div");
			container.style.backgroundSize = "contain";
			container.style.backgroundRepeat = "no-repeat";
			container.style.backgroundPosition = "center center";

			function setImage(src) {
				container.style.backgroundImage = "url(" + src + ")";
			}

			var img = new Image();

			img.addEventListener("error", function() {
				setImage("images/nocover.svg");
			});

			img.addEventListener("load", function() {
				setImage(img.src);
			});

			img.src = "/rest/covers/album:" + this.data.artist + ":" + this.data.album;

			return container;
		}
	};


	return MusicTrack;
});