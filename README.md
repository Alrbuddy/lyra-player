# Lyra

A personal, fully offline music player PWA for iPhone. Dark Spotify-style layout with a glass look. No accounts, no servers — your songs live only on your device.

## Features

- **Import from the Files app** — MP3, M4A, WAV, FLAC, AAC, OGG. ID3 tags and cover art are read automatically (jsmediatags, vendored), with a filename fallback.
- **Playback** — lock-screen controls via the Media Session API, queue with shuffle and repeat (off/all/one), "play next", play counts.
- **Lyrics** — paste lyrics for any song. Never auto-scrolls unless you turn it on (optional speed slider). LRC `[mm:ss.xx]` timestamps highlight the current line while playing.
- **Library** — Home, Search (songs, albums, artists, playlists, and lyrics text), Your Library with playlists, likes, and multi-select, Import, Settings.
- **Backup** — export metadata, lyrics, playlists, likes, and play counts as JSON (audio not included). Restore merges by title + artist + duration.
- **Offline** — service worker precaches the whole app. After the first load it works with no connection.

## Install (iPhone)

1. Open the app URL in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. Open **Lyra** from the home screen icon.

## Getting songs onto the phone

A web app cannot run a Wi-Fi transfer server. On Windows, sync your music folder with **iCloud for Windows**, **Google Drive**, or **OneDrive**. The files appear in the iPhone **Files** app — then open Lyra → **Import** → **Files** and pick them.

## Storage

Audio and artwork are stored in IndexedDB (never localStorage). The app requests persistent storage on first import. Nothing is uploaded anywhere.

## Development

Plain HTML/CSS/JS, no build step. Serve the folder from any static host under a subpath (all paths are relative). `vendor/jsmediatags.min.js` is BSD-3-Clause (license included in `vendor/`).

Service worker: bump `VERSION` in `sw.js` after changing any cached file.
