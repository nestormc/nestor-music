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
		css: "albumlist",
		views: {
			albums: {
				type: "main",
				link: "albums",
				icon: "album"
			}
		}
	};
});