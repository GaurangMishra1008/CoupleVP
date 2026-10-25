// Wraps the YouTube IFrame player so it looks like a <video> element to the sync code:
// currentTime, paused, duration, play(), pause(), and play/pause/seeked/waiting/playing/ended events.
(function () {
  let apiReady = null;
  function loadApi() {
    if (apiReady) return apiReady;
    apiReady = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { apiReady = null; reject(new Error("Couldn't load YouTube. Check your connection.")); };
      document.head.appendChild(s);
    });
    return apiReady;
  }

  // Accepts youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /embed/ID, /live/ID, or a bare 11-char ID.
  function parseId(text) {
    const s = String(text || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    try {
      const u = new URL(s.startsWith('http') ? s : 'https://' + s);
      if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12) || null;
      if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
        if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
        const m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{11})/);
        if (m) return m[2];
      }
    } catch (_) {}
    return null;
  }

  class YTMedia extends EventTarget {
    constructor(container) {
      super();
      this.container = container;
      this.player = null;
      this.id = null;
      this.state = -1;          // YT.PlayerState
      this.ready = false;
      this.dataset = { name: '', size: 0 };
      this.coarseRate = true;   // YouTube only allows a few fixed speeds, so no fine speed nudging
      this._lastT = 0; this._lastAt = 0; this._seekGuardUntil = 0;
      setInterval(() => this._watchSeeks(), 250);
    }
    get src() { return this.id ? 'yt:' + this.id : ''; }
    get readyState() { return this.ready && this.id ? 4 : 0; }
    get paused() { return !(this.state === 1 || this.state === 3); }
    get duration() { return this.player && this.ready ? this.player.getDuration() || 0 : 0; }
    get currentTime() { return this.player && this.ready ? this.player.getCurrentTime() || 0 : 0; }
    set currentTime(t) {
      if (!this.player || !this.ready) return;
      this._seekGuardUntil = performance.now() + 800;
      this.player.seekTo(Math.max(0, t), true);
      this._lastT = t; this._lastAt = performance.now();
    }
    get playbackRate() { return 1; }
    set playbackRate(_) {}
    get title() { try { return this.player.getVideoData().title || ''; } catch (_) { return ''; } }

    async load(id) {
      const YT = await loadApi();
      this.id = id;
      this.dataset.name = 'yt:' + id;
      this.dataset.title = '';
      if (!this.player) {
        await new Promise(resolve => {
          this.player = new YT.Player(this.container, {
            videoId: id,
            playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
            events: {
              onReady: () => { this.ready = true; resolve(); },
              onStateChange: e => this._onState(e.data),
              onError: e => this._emit('error', { code: e.data }),
            },
          });
        });
      } else {
        this.state = -1;
        this.player.cueVideoById(id);
      }
      // Title arrives a moment after the video is cued.
      let tries = 0;
      const waitMeta = () => {
        if (this.duration > 0 || ++tries > 40) { this.dataset.title = this.title; this._emit('loadedmetadata'); }
        else setTimeout(waitMeta, 150);
      };
      waitMeta();
    }

    play() { if (this.player && this.ready) this.player.playVideo(); return Promise.resolve(); }
    pause() { if (this.player && this.ready) this.player.pauseVideo(); }
    stop() { if (this.player && this.ready) this.player.stopVideo(); this.state = 5; }

    _emit(type, detail) { const e = new Event(type); if (detail) e.detail = detail; this.dispatchEvent(e); }
    _onState(s) {
      const wasPaused = this.paused;
      this.state = s;
      this._lastT = this.currentTime; this._lastAt = performance.now();
      if (wasPaused && !this.paused) this._emit('play');
      if (!wasPaused && this.paused) this._emit('pause');
      if (s === 1) this._emit('playing');
      else if (s === 3) this._emit('waiting');
      else if (s === 0) this._emit('ended');
      if (s === 1 && !this.dataset.title) this.dataset.title = this.title;
    }
    // YouTube has no "seeked" event: notice jumps in the playhead that normal playback can't explain.
    _watchSeeks() {
      if (!this.player || !this.ready || !this.id) return;
      const nowT = performance.now(), t = this.currentTime;
      const expected = this._lastT + (this.state === 1 ? (nowT - this._lastAt) / 1000 : 0);
      if (nowT > this._seekGuardUntil && this._lastAt && Math.abs(t - expected) > 1.2) this._emit('seeked');
      this._lastT = t; this._lastAt = nowT;
    }
  }

  window.CVPYouTube = { YTMedia, parseId };
})();
