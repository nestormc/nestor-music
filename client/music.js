/*jshint browser:true */
/*global define */

define(
[ "ui", "router", "albumlist" ],
function(ui, router) {
	"use strict";


	/*!
	 * Plugin manifest
	 */

	return {
		title: "music",
		views: {
			albums: {
				type: "main",
				link: "albums",
				icon: "music:album",
				css: "albumlist"
			}
		}
	};
});