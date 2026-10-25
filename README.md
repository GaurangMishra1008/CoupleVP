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
