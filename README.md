# Couple Player (prototype)

A single web page that keeps the same video in sync on two devices. Nothing is uploaded or stored anywhere.

## How it works
- **Video stays local.** Each person picks their own copy of the file; it plays from the device (`URL.createObjectURL`).
- **Peer-to-peer link.** The two browsers connect over a WebRTC data channel (via PeerJS). A free public PeerJS server is used only for the initial handshake (room code), like toffeeshare. After that, messages go directly device to device.
- **Only commands travel:** play, pause, seek, plus a small heartbeat.
- **Clock sync.** Ping/pong estimates the time difference between the devices, so a "play at 12.3s" message is adjusted for network delay.
- **Drift correction.** Whoever pressed play/pause/seek last leads. The other device checks the leader's position every second: under 40 ms it does nothing, up to 0.5 s it speeds up/slows down slightly (max 8%), beyond that it jumps.
- **Either side controls.** Pause on one phone pauses the other.
- **Mobile autoplay.** Phones block playback that wasn't started by a tap, so each person taps "Tap to start syncing" once.
- **File check.** Warns if the two videos have different lengths.

## Partner status and series
- A big banner at the top shows what your partner is doing: "looking for a video", or "watching the movie *Inception (2010)*" / "the series *Breaking Bad*, Season 1 · Episode 3". The name comes from the file name (`titles.js` strips quality tags, groups, years, and reads S01E03 / 1x03 patterns). It warns when you two picked different things.
- **Choose a series folder** (on a computer) or **Choose several episodes** (on phones, which can't pick folders). Episodes are sorted by season/episode. Picking an episode on one side switches the other side to the same episode, matched by season and episode number, so file names don't have to be identical. When an episode ends, both move on to the next one together.

## Video, Music and YouTube
The main screen has three tabs:
- **🎬 Video**: a movie, or a series folder (episodes matched by season/episode on both sides, auto-next together).
- **🎵 Music**: a song or an album folder in a fun player: animated colours, a spinning record, dancing bars, its own play/prev/next and progress bar, and a **💗 Send a heart** button that floats hearts on both screens. Albums play through in order together.
- **▶ YouTube**: paste a link; it syncs through the YouTube player (`yt.js`). YouTube only allows a few fixed speeds, so drift is corrected by small jumps.

## YouTube browse and party invites
- The YouTube tab has **🔥 Trending videos**, **🎵 Trending music** and **Search**. Tap a video to play it in the main player for both of you (`ytbrowse.js`).
- With a YouTube Data API key (set in `config.js`, or pasted into the key box in the app) it uses the official API. Restrict the key to `https://gaurangmishra1008.github.io/*` and the YouTube Data API. Without a key it tries public Piped mirrors, which work most of the time but can be down.
- Picking or pasting a YouTube link sends your partner a popup: **"Your partner pasted a link. Want to party together? 🎉"** (Let's party / Not now). If they're already on something, it becomes the watch-theirs-or-keep-mine choice below.

## Picking different things
If one of you picks something while the other is on something else, the other gets a popup: **watch theirs or keep mine?**
- Watch theirs: you both switch (YouTube switches automatically; for files, the matching episode/song is picked if you have it, otherwise you're asked to pick it).
- Keep mine: the one who picked gets the same question back. If they also keep theirs: **"Oops! Different flavours today 🍦🍕"**. Each keeps playing their own thing (sync is paused between you), and either can tap **Watch theirs instead** in the banner anytime.

## Use
1. Open the page on both devices (must be served over https, e.g. GitHub Pages).
2. Phone A: **Create room** → **Share link** (or read out the 6-letter code).
3. Phone B: open the link or type the code → **Join**.
4. Both pick the same video file, tap once, then play.

## Testing
`?test&host&room=ABCDEF` and `?test&room=ABCDEF` in two tabs of the same browser use a local BroadcastChannel instead of WebRTC, to test the sync logic offline.

## Known limits
- Relies on the public PeerJS server for the handshake; for production, run your own (peerjs-server) or a small WebSocket signaling server.
- Some mobile networks block direct connections; that needs a TURN relay (only commands go through it, never the video).
- Format support depends on the browser (MP4/H.264 is safest on iPhone; MKV often won't play on iOS).

## Video formats
MP4 and WebM play directly. **MKV** files (which Safari and iPhone can't open) are repackaged into MP4 on the fly, on the device, by `mkv.js` using [Mediabunny](https://mediabunny.dev) (vendored in `vendor/`, MPL-2.0):
- Video is copied as-is, so there's no quality loss and very little CPU use. H.264, H.265, VP9 and AV1 work if the browser can decode them.
- Audio is copied when the browser supports it (AAC, Dolby AC3/EAC3 on Apple devices, Opus). Otherwise it's converted to AAC where the browser can, or the video plays without sound and the page says so.
- It prepares about 40 s ahead of the playhead and drops what's well behind, so a 2-hour movie doesn't fill memory. Seeking far ahead restarts from the nearest keyframe.
- Needs Media Source Extensions: any desktop browser, or iOS 17.1+ on iPhone.
- Add `?repack` to the URL to force this path for any file (for debugging).

If a file still won't play, convert it once:

    ffmpeg -i movie.mkv -c:v copy -c:a aac movie.mp4
