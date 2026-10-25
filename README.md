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
Safari (Mac and iPhone) cannot play MKV. If your file is MKV, make an MP4 copy once. Most MKVs already contain H.264 video, so this takes seconds and keeps full quality:

    ffmpeg -i movie.mkv -c:v copy -c:a aac movie.mp4

(Or use HandBrake with the "Fast 1080p30" preset.) Chrome on a computer or Android can often play MKV directly.
