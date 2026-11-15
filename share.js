// Live tab/screen sharing for sites that only play in their own player.
// One person shares a browser tab (with its sound); everyone else in the room watches it live.
// The sharer opens one WebRTC connection per viewer, so the picture goes device to device.
// The offer/answer messages travel over the app's existing link, addressed with `to`.
(function () {
  const ICE = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    // PeerJS's public relay, used only when two devices can't reach each other directly.
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ];
  const canShare = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  class Share extends EventTarget {
    constructor(send, getPeers) {
      super();
      this.send = send;          // (obj) => void, sends over the app link
      this.getPeers = getPeers;  // () => ids of everyone else in the room
      this.role = null;          // 'sharing' | 'watching' | null
      this.local = null;         // our captured stream (sharing)
      this.pcs = new Map();      // sharing: viewer id -> RTCPeerConnection
      this.pc = null;            // watching: our connection to the sharer
      this.remoteFrom = null;    // watching: the sharer's id
      this.remote = null;        // watching: their stream
      this.remoteAudio = false;
      this.pending = new Map();  // id -> ICE candidates that arrived early
    }
    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    _newPc(id) {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      pc.onicecandidate = e => { if (e.candidate) this.send({ type: 'rtc', c: e.candidate.toJSON(), to: id }); };
      pc.onconnectionstatechange = () => {
        this._emit('state', pc.connectionState);
        if (pc.connectionState === 'failed') this._emit('trouble', "The live picture couldn't get through" + (this.role === 'watching' ? '.' : ' to someone.'));
      };
      return pc;
    }

    async start() {
      if (!canShare()) throw new Error('no-share');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include', preferCurrentTab: false,
      });
      this.stop(false);
      this.local = stream; this.role = 'sharing';
      for (const t of stream.getTracks()) {
        if (t.kind === 'video') t.contentHint = 'motion';
        t.addEventListener('ended', () => { if (this.local === stream) this.stop(); });
      }
      await Promise.all(this.getPeers().map(id => this._offerTo(id)));
      this._emit('change');
      return { audio: stream.getAudioTracks().length > 0 };
    }
    // Someone joined while we're sharing: send them the picture too.
    newcomer() {
      if (this.role !== 'sharing') return;
      for (const id of this.getPeers()) if (!this.pcs.has(id)) this._offerTo(id).catch(() => {});
    }
    async _offerTo(id) {
      const stream = this.local; if (!stream) return;
      const pc = this._newPc(id);
      this.pcs.set(id, pc);
      // Upload is shared between viewers, so each gets a smaller slice in a bigger room.
      const viewers = Math.max(1, this.getPeers().length);
      for (const t of stream.getTracks()) {
        const sender = pc.addTrack(t, stream);
        if (t.kind === 'video') {
          const p = sender.getParameters();
          p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
          p.encodings[0].maxBitrate = Math.max(1_000_000, Math.round(4_000_000 / Math.sqrt(viewers)));
          p.degradationPreference = 'maintain-framerate';
          sender.setParameters(p).catch(() => {});
        }
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send({ type: 'rtc', sdp: pc.localDescription.toJSON(), audio: stream.getAudioTracks().length > 0, to: id });
    }
    // Someone left the room.
    forget(id) {
      const pc = this.pcs.get(id);
      if (pc) { try { pc.close(); } catch (_) {} this.pcs.delete(id); }
      this.pending.delete(id);
      if (this.role === 'watching' && this.remoteFrom === id) this.stop(false);
    }

    // Messages from others: {type:'rtc', sdp?|c?} and {type:'share-end'}
    async handle(m) {
      const id = m.from;
      if (m.type === 'share-end') { if (this.role === 'watching' && this.remoteFrom === id) this.stop(false); return; }
      if (m.sdp && m.sdp.type === 'offer') {
        this.stop(true); // a new share replaces anything going on, including our own
        this.role = 'watching'; this.remoteFrom = id; this.remoteAudio = !!m.audio;
        const pc = this.pc = this._newPc(id);
        pc.ontrack = e => {
          this.remote = e.streams[0] || new MediaStream([e.track]);
          this._emit('stream', this.remote);
        };
        await pc.setRemoteDescription(m.sdp);
        await this._flush(id, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ type: 'rtc', sdp: pc.localDescription.toJSON(), to: id });
        this._emit('change');
      } else if (m.sdp && m.sdp.type === 'answer' && this.role === 'sharing' && this.pcs.has(id)) {
        const pc = this.pcs.get(id);
        await pc.setRemoteDescription(m.sdp);
        await this._flush(id, pc);
      } else if (m.c) {
        const pc = this.role === 'sharing' ? this.pcs.get(id) : this.remoteFrom === id ? this.pc : null;
        if (pc && pc.remoteDescription) await pc.addIceCandidate(m.c).catch(() => {});
        else { if (!this.pending.has(id)) this.pending.set(id, []); this.pending.get(id).push(m.c); }
      }
    }
    async _flush(id, pc) { const c = this.pending.get(id) || []; this.pending.delete(id); for (const x of c) await pc.addIceCandidate(x).catch(() => {}); }

    stop(tell = true) {
      const was = this.role;
      if (this.local) for (const t of this.local.getTracks()) t.stop();
      for (const pc of this.pcs.values()) { try { pc.close(); } catch (_) {} }
      if (this.pc) { try { this.pc.close(); } catch (_) {} }
      this.pcs.clear(); this.pc = null; this.local = null; this.remote = null; this.remoteFrom = null; this.role = null; this.pending.clear();
      if (was === 'sharing' && tell) this.send({ type: 'share-end' });
      if (was) this._emit('change');
    }
  }

  window.CVPShare = { Share, canShare };
})();
