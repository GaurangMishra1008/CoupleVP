// Live tab/screen sharing between the two devices, for sites that only play in their own player.
// One partner shares a browser tab (with its sound); the other watches it live. The video goes
// device to device over WebRTC. The offer/answer messages travel over the app's existing link.
(function () {
  const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    // PeerJS's public relay, used only when the two devices can't reach each other directly.
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ];
  const canShare = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  class Share extends EventTarget {
    constructor(send) {
      super();
      this.send = send;      // (obj) => void, sends over the app link
      this.pc = null;
      this.role = null;      // 'sharing' | 'watching' | null
      this.local = null;     // our captured stream
      this.remote = null;    // the partner's stream
      this.pending = [];     // ICE candidates that arrived before the offer/answer
    }
    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    _newPc() {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      pc.onicecandidate = e => { if (e.candidate) this.send({ type: 'rtc', c: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        this._emit('state', pc.connectionState);
        if (pc.connectionState === 'failed') this._emit('trouble', "The live picture couldn't get through between your devices.");
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
      const pc = this.pc = this._newPc();
      for (const t of stream.getTracks()) {
        if (t.kind === 'video') t.contentHint = 'motion';
        const sender = pc.addTrack(t, stream);
        if (t.kind === 'video') {
          const p = sender.getParameters();
          p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
          p.encodings[0].maxBitrate = 4_000_000;
          p.degradationPreference = 'maintain-framerate';
          sender.setParameters(p).catch(() => {});
        }
        t.addEventListener('ended', () => { if (this.local === stream) this.stop(); });
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send({ type: 'rtc', sdp: pc.localDescription.toJSON(), audio: stream.getAudioTracks().length > 0 });
      this._emit('change');
      return { audio: stream.getAudioTracks().length > 0 };
    }

    // Messages from the partner: {type:'rtc', sdp?|c?} and {type:'share-end'}
    async handle(m) {
      if (m.type === 'share-end') { if (this.role === 'watching') this.stop(false); return; }
      if (m.sdp && m.sdp.type === 'offer') {
        this.stop(false); // a new share from them replaces anything going on
        this.role = 'watching'; this.remoteAudio = !!m.audio;
        const pc = this.pc = this._newPc();
        pc.ontrack = e => {
          this.remote = e.streams[0] || new MediaStream([e.track]);
          this._emit('stream', this.remote);
        };
        await pc.setRemoteDescription(m.sdp);
        await this._flush();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ type: 'rtc', sdp: pc.localDescription.toJSON() });
        this._emit('change');
      } else if (m.sdp && m.sdp.type === 'answer' && this.pc && this.role === 'sharing') {
        await this.pc.setRemoteDescription(m.sdp);
        await this._flush();
      } else if (m.c) {
        if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(m.c).catch(() => {});
        else this.pending.push(m.c);
      }
    }
    async _flush() { const c = this.pending; this.pending = []; for (const x of c) await this.pc.addIceCandidate(x).catch(() => {}); }

    stop(tell = true) {
      const was = this.role;
      if (this.local) for (const t of this.local.getTracks()) t.stop();
      if (this.pc) { try { this.pc.close(); } catch (_) {} }
      this.pc = null; this.local = null; this.remote = null; this.role = null; this.pending = [];
      if (was === 'sharing' && tell) this.send({ type: 'share-end' });
      if (was) this._emit('change');
    }
  }

  window.CVPShare = { Share, canShare };
})();
