// Plays files the browser can't open natively (e.g. MKV in Safari) by repackaging them
// into fragmented MP4 on the fly and feeding them to the <video> via Media Source Extensions.
// Video is copied as-is (no quality loss). Audio is copied when the browser supports it,
// otherwise converted to AAC. Everything happens on this device; nothing is uploaded.
import {
  Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, StreamTarget,
  Conversion, EncodedPacketSink, canEncodeAudio,
} from './vendor/mediabunny.min.mjs';

const AHEAD = 40;   // seconds to prepare ahead of the playhead
const BEHIND = 20;  // seconds to keep behind the playhead

const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (el, ev) => new Promise(r => el.addEventListener(ev, r, { once: true }));

export function isSupported() {
  return !!(window.ManagedMediaSource || window.MediaSource);
}

export async function attach(file, video, { log = () => {}, onStatus = () => {} } = {}) {
  const MS = window.ManagedMediaSource || window.MediaSource;
  if (!MS) throw new Error('This browser has no streaming support (needs iOS 17.1+ or a recent desktop browser).');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const vTrack = await input.getPrimaryVideoTrack();
  const aTrack = await input.getPrimaryAudioTrack();
  if (!vTrack) throw new Error('No video track found in this file.');

  const vCodec = await vTrack.getCodecParameterString();
  if (!vCodec || !MS.isTypeSupported(`video/mp4; codecs="${vCodec}"`)) {
    throw new Error(`This browser can't decode the video inside this file (${vCodec || vTrack.codec}).`);
  }

  let aCodec = null, audioMode = 'none';
  if (aTrack) {
    aCodec = await aTrack.getCodecParameterString();
    if (aCodec && MS.isTypeSupported(`audio/mp4; codecs="${aCodec}"`)) audioMode = 'copy';
    else if (await aTrack.canDecode().catch(() => false) && await canEncodeAudio('aac').catch(() => false)) { audioMode = 'aac'; aCodec = 'mp4a.40.2'; }
    else { audioMode = 'none'; log('audio codec not playable here:', aTrack.codec); }
  }
  const mime = `video/mp4; codecs="${[vCodec, audioMode !== 'none' ? aCodec : null].filter(Boolean).join(',')}"`;
  log('repackaging', file.name, mime, 'audio:', audioMode);

  const duration = await input.computeDuration();
  const keySink = new EncodedPacketSink(vTrack);

  const ms = new MS();
  video.disableRemotePlayback = true; // required for ManagedMediaSource on iOS
  const url = URL.createObjectURL(ms);
  video.src = url;
  await once(ms, 'sourceopen');
  ms.duration = duration;
  const sb = ms.addSourceBuffer(mime);

  let session = 0;       // bumps on every restart; stale writers stop themselves
  let conversion = null;
  let writeEnd = 0;      // media time the current session has appended up to
  let destroyed = false;

  const idle = async () => { while (sb.updating) await once(sb, 'updateend'); };
  // All SourceBuffer operations go through one queue so they never overlap.
  let queue = Promise.resolve();
  const op = fn => { const p = queue.then(async () => { await idle(); return fn(); }); queue = p.catch(() => {}); return p; };
  const doUpdate = fn => op(() => { fn(); return once(sb, 'updateend'); });

  async function append(data, id) {
    // Backpressure: the muxer awaits this write, so holding it here pauses the conversion
    // until the playhead gets closer. Keeps memory small even for a 2-hour movie.
    while (id === session && !destroyed && writeEnd - video.currentTime > AHEAD) await wait(300);
    await trimBehind(false);
    for (;;) {
      try {
        await doUpdate(() => { if (id !== session || destroyed) throw new Error('stale'); sb.appendBuffer(data); });
        return;
      }
      catch (e) {
        if (e.name !== 'QuotaExceededError') throw e;
        if (id !== session) throw new Error('stale');
        await trimBehind(true);
        await wait(500);
      }
    }
  }

  async function trimBehind(force) {
    const cut = video.currentTime - (force ? 5 : BEHIND);
    if (cut <= 0 || !sb.buffered.length || sb.buffered.start(0) >= cut) return;
    try { await doUpdate(() => sb.remove(0, cut)); } catch (_) {} // keeps memory small
  }

  async function startAt(t) {
    const id = ++session;
    if (conversion) { const c = conversion; conversion = null; c.cancel().catch(() => {}); }
    // Start on the keyframe at or before t so the picture decodes immediately.
    const key = await keySink.getKeyPacket(Math.max(0, t)).catch(() => null);
    const start = key ? key.timestamp : 0;
    if (id !== session) return;
    // Reset the buffer: drop the old session's partial fragment and data, then line up timestamps.
    await op(() => { if (ms.readyState === 'open') sb.abort(); }).catch(() => {});
    if (sb.buffered.length) await doUpdate(() => sb.remove(0, Infinity)).catch(() => {});
    await op(() => { sb.timestampOffset = start; });
    if (id !== session) return;
    writeEnd = start;
    onStatus(start > 0 ? 'Loading from ' + Math.round(start) + 's…' : 'Preparing video…');

    const sink = new WritableStream({
      async write(chunk) { await append(chunk.data, id); },
    });
    const output = new Output({
      format: new Mp4OutputFormat({
        fastStart: 'fragmented',
        minimumFragmentDuration: 1,
        onMoof: (_d, _p, ts) => { if (id === session) writeEnd = start + ts; },
      }),
      target: new StreamTarget(sink),
    });
    const conv = await Conversion.init({
      input, output, showWarnings: false,
      trim: { start },
      video: track => (track.id === vTrack.id ? {} : { discard: true }),
      audio: track => {
        if (!aTrack || track.id !== aTrack.id || audioMode === 'none') return { discard: true };
        return audioMode === 'aac' ? { codec: 'aac', bitrate: 160e3 } : {};
      },
    });
    if (id !== session) { conv.cancel().catch(() => {}); return; }
    conversion = conv;
    try {
      await conv.execute();
      if (id === session && ms.readyState === 'open') { await idle(); ms.endOfStream(); }
      onStatus('');
    } catch (e) {
      if (id === session && e.message !== 'stale' && !/cancel/i.test(e.message)) { log('repackage error', e.message); onStatus('Playback error: ' + e.message); }
    }
  }

  function inBuffer(t) {
    for (let i = 0; i < sb.buffered.length; i++) {
      if (t >= sb.buffered.start(i) - 0.1 && t <= sb.buffered.end(i)) return true;
    }
    return false;
  }

  const onSeeking = () => {
    const t = video.currentTime;
    // Seeking inside what's already prepared (and the session is still feeding that stretch): nothing to do.
    if (inBuffer(t) && t <= writeEnd + 1) return;
    startAt(t);
  };
  video.addEventListener('seeking', onSeeking);

  startAt(0);

  return {
    duration,
    audioNote: aTrack && audioMode === 'none' ? `No sound: this browser can't play the audio format in this file (${aTrack.codec}).` : '',
    destroy() {
      destroyed = true; session++;
      video.removeEventListener('seeking', onSeeking);
      if (conversion) conversion.cancel().catch(() => {});
      URL.revokeObjectURL(url);
    },
  };
}
