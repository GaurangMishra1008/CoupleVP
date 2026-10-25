// "Links" tab: play a pasted link from other sites, in sync.
//  - Direct media links (.mp4 .webm .mov .mp3 …) play in a normal <video>.
//  - Stream links (.m3u8 / HLS) play natively on Safari, or through hls.js elsewhere.
//  - Vimeo links play in Vimeo's player, wrapped to look like a <video> for the sync code.
//  - Netflix, Prime, Disney+, Hotstar etc. use DRM and block other sites: those can't work.
(function () {
  const DRM = /(^|\.)(netflix|primevideo|amazon|disneyplus|hotstar|jiocinema|jiohotstar|hulu|max|hbomax|sonyliv|zee5|apple|tv\.apple|peacocktv|paramountplus|crunchyroll|spotify)\./i;

  // Returns { kind: 'vimeo'|'hls'|'file'|'youtube'|'drm'|'page', id?, url, title }
  function classify(raw) {
    const text = String(raw || '').trim();
    const m = text.match(/https?:\/\/\S+/);
    const urlStr = m ? m[0] : text;
    let u;
    try { u = new URL(urlStr.startsWith('http') ? urlStr : 'https://' + urlStr); } catch (_) { return null; }
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.toLowerCase();
    const url = u.href;
    if (window.CVPYouTube && CVPYouTube.parseId(url)) return { kind: 'youtube', id: CVPYouTube.parseId(url), url };
    const vm = host.match(/(^|\.)vimeo\.com$/) && u.pathname.match(/\/(?:video\/)?(\d{6,})(?:\/([0-9a-f]{6,}))?/);
    if (vm) return { kind: 'vimeo', id: vm[1], hash: vm[2] || u.searchParams.get('h') || '', url, title: 'Vimeo video' };
    if (DRM.test(host + '.')) return { kind: 'drm', url, title: host };
    const name = decodeURIComponent(path.split('/').pop() || host);
    if (/\.m3u8$/.test(path) || /m3u8/.test(u.search)) return { kind: 'hls', url, title: name.replace(/\.m3u8$/i, '') || host };
    if (/\.(mp4|m4v|webm|mov|ogv|mkv|mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(path)) return { kind: 'file', url, title: name };
    return { kind: 'page', url, title: host };
  }

  let hlsLoad = null;
  function loadHlsJs() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsLoad) hlsLoad = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/hls.min.js';
      s.onload = () => res(window.Hls); s.onerror = () => { hlsLoad = null; rej(new Error("Couldn't load the stream player.")); };
      document.head.appendChild(s);
    });
    return hlsLoad;
  }

  // Attach a URL to a <video>. Returns a cleanup function.
  async function attachUrl(videoEl, info) {
    if (info.kind === 'hls' && !videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      const Hls = await loadHlsJs();
      if (!Hls.isSupported()) throw new Error("This browser can't play stream links.");
      const hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) videoEl.dispatchEvent(new CustomEvent('streamerror', { detail: d.details })); });
      hls.loadSource(info.url);
      hls.attachMedia(videoEl);
      return () => hls.destroy();
    }
    videoEl.src = info.url;
    return () => { videoEl.removeAttribute('src'); videoEl.load(); };
  }

  let vimeoLoad = null;
  function loadVimeo() {
    if (window.Vimeo && window.Vimeo.Player) return Promise.resolve(window.Vimeo);
    if (!vimeoLoad) vimeoLoad = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/vimeo-player.min.js';
      s.onload = () => res(window.Vimeo); s.onerror = () => { vimeoLoad = null; rej(new Error("Couldn't load Vimeo.")); };
      document.head.appendChild(s);
    });
    return vimeoLoad;
  }

  // Vimeo's player answers asynchronously, so keep a local copy of time/paused for the sync code.
  class VimeoMedia extends EventTarget {
    constructor(container) {
      super();
      this.container = container;
      this.player = null; this.id = null; this.ready = false;
      this._paused = true; this._t = 0; this._at = 0; this._dur = 0;
      this.dataset = { name: '', title: '' };
      this.coarseRate = true;
    }
    get src() { return this.id ? 'vimeo:' + this.id : ''; }
    get readyState() { return this.ready ? 4 : 0; }
    get paused() { return this._paused; }
    get duration() { return this._dur; }
    get currentTime() { return this._paused ? this._t : this._t + (performance.now() - this._at) / 1000; }
    set currentTime(t) { this._t = t; this._at = performance.now(); if (this.player) this.player.setCurrentTime(Math.max(0, t)).catch(() => {}); }
    get playbackRate() { return 1; }
    set playbackRate(_) {}
    async load(info) {
      const Vimeo = await loadVimeo();
      if (this.player) { try { await this.player.destroy(); } catch (_) {} this.container.innerHTML = ''; }
      this.id = info.id; this.ready = false; this._paused = true; this._t = 0;
      this.dataset.name = 'vimeo:' + info.id + (info.hash ? '/' + info.hash : '');
      this.dataset.title = '';
      const opts = info.hash ? { url: `https://vimeo.com/${info.id}/${info.hash}` } : { id: +info.id };
      this.player = new Vimeo.Player(this.container, { ...opts, responsive: true, playsinline: true });
      const p = this.player;
      const tick = d => { this._t = d.seconds; this._at = performance.now(); if (d.duration) this._dur = d.duration; };
      p.on('timeupdate', tick);
      p.on('play', d => { tick(d); const was = this._paused; this._paused = false; if (was) this._emit('play'); this._emit('playing'); });
      p.on('pause', d => { tick(d); const was = this._paused; this._paused = true; if (!was) this._emit('pause'); });
      p.on('seeked', d => { tick(d); this._emit('seeked'); });
      p.on('bufferstart', () => this._emit('waiting'));
      p.on('bufferend', () => this._emit('playing'));
      p.on('ended', d => { tick(d); this._paused = true; this._emit('pause'); this._emit('ended'); });
      p.on('error', e => this._emit('error', { message: e && e.message }));
      await p.ready();
      this._dur = await p.getDuration().catch(() => 0);
      this.dataset.title = await p.getVideoTitle().catch(() => '') || 'Vimeo video';
      this.ready = true;
      this._emit('loadedmetadata');
    }
    play() { this._paused = false; this._at = performance.now(); return this.player ? this.player.play().catch(e => { this._paused = true; throw e; }) : Promise.resolve(); }
    pause() { this._t = this.currentTime; this._paused = true; if (this.player) this.player.pause().catch(() => {}); }
    _emit(type, detail) { const e = new Event(type); if (detail) e.detail = detail; this.dispatchEvent(e); }
  }

  window.CVPWeb = { classify, attachUrl, VimeoMedia };
})();
