Music library plugin for nestor
===============================

Dependencies
------------

This plugin depends on nestor-media to scan the filesystem for music files.  It listens to `media:file` and `media:removed` intents to update the library.

It also dispatches `cover:album-art` intents so that cover art is automagically fetched for stored albums, if nestor-coverart is installed. 