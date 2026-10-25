// Finds YouTube videos to play: trending videos, trending music, and search.
// Uses the official YouTube Data API when a key is set (config.js or the key box in the app).
// Without a key (the normal case) it asks free public mirrors (Piped and Invidious), which work most of the time but not always.
(function () {
  const PIPED = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee'];

  function apiKey() {
    const cfg = (window.CVP_CONFIG && window.CVP_CONFIG.youtubeApiKey) || '';
    let local = '';
    try { local = localStorage.getItem('cvp-yt-key') || ''; } catch (_) {}
    return (local || cfg).trim();
  }
  function setApiKey(k) { try { if (k) localStorage.setItem('cvp-yt-key', k.trim()); else localStorage.removeItem('cvp-yt-key'); } catch (_) {} }

  function region() {
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (const l of langs) { const m = String(l).match(/-([A-Za-z]{2})$/); if (m) return m[1].toUpperCase(); }
    return 'US';
  }

  async function getJson(url, ms = 6000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      const body = await r.json().catch(() => null);
      if (!r.ok) { const e = new Error((body && body.error && body.error.message) || 'HTTP ' + r.status); e.status = r.status; throw e; }
      return body;
    } finally { clearTimeout(t); }
  }

  // ISO 8601 "PT4M13S" -> 253
  function isoSecs(d) { const m = String(d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; }

  async function viaApi(kind, q, key) {
    const base = 'https://www.googleapis.com/youtube/v3/';
    const music = kind === 'music';
    if (q) {
      const data = await getJson(`${base}search?part=snippet&type=video&maxResults=24&safeSearch=moderate&regionCode=${region()}${music ? '&videoCategoryId=10' : ''}&q=${encodeURIComponent(q)}&key=${key}`);
      return (data.items || []).map(it => ({ id: it.id.videoId, title: it.snippet.title, channel: it.snippet.channelTitle, thumb: (it.snippet.thumbnails.medium || it.snippet.thumbnails.default || {}).url, secs: 0 }));
    }
    const data = await getJson(`${base}videos?part=snippet,contentDetails&chart=mostPopular&maxResults=24&regionCode=${region()}${music ? '&videoCategoryId=10' : ''}&key=${key}`);
    return (data.items || []).map(it => ({ id: it.id, title: it.snippet.title, channel: it.snippet.channelTitle, thumb: (it.snippet.thumbnails.medium || it.snippet.thumbnails.default || {}).url, secs: isoSecs(it.contentDetails && it.contentDetails.duration) }));
  }

  async function viaPiped(kind, q) {
    const music = kind === 'music';
    let lastErr = null;
    for (const inst of PIPED) {
      try {
        let items;
        if (!q && !music) items = await getJson(`${inst}/trending?region=${region()}`);
        else {
          const query = q || `top songs ${new Date().getFullYear()}`;
          const data = await getJson(`${inst}/search?q=${encodeURIComponent(query)}&filter=${music ? 'music_songs' : 'videos'}`);
          items = data.items || [];
        }
        const out = items.filter(it => it.url && /watch\?v=/.test(it.url)).map(it => ({
          id: it.url.split('v=')[1].slice(0, 11), title: it.title, channel: it.uploaderName || '', thumb: it.thumbnail, secs: it.duration > 0 ? it.duration : 0,
        }));
        if (out.length) return out;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No results');
  }

  const INVIDIOUS = ['https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be', 'https://invidious.f5.si'];
  async function viaInvidious(kind, q) {
    const music = kind === 'music';
    let lastErr = null;
    for (const inst of INVIDIOUS) {
      try {
        const url = q
          ? `${inst}/api/v1/search?type=video&q=${encodeURIComponent(q + (music ? ' song' : ''))}`
          : `${inst}/api/v1/trending?region=${region()}${music ? '&type=music' : ''}`;
        const items = await getJson(url);
        const out = (items || []).filter(it => it.videoId).map(it => {
          const th = (it.videoThumbnails || []).find(t => t.quality === 'medium') || (it.videoThumbnails || [])[0];
          return { id: it.videoId, title: it.title, channel: it.author || '', thumb: th && th.url && th.url.startsWith('http') ? th.url : '', secs: it.lengthSeconds || 0 };
        });
        if (out.length) return out;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No results');
  }

  // kind: 'videos' | 'music'; q: optional search text
  async function list(kind, q) {
    const key = apiKey();
    if (key) return { items: await viaApi(kind, q, key), source: 'api' };
    // No key: race the free mirrors and take whichever answers first.
    try { return await Promise.any([
      viaPiped(kind, q).then(items => ({ items, source: 'piped' })),
      viaInvidious(kind, q).then(items => ({ items, source: 'invidious' })),
    ]); }
    catch (e) { const err = new Error('needs-key'); err.cause = e; throw err; }
  }

  window.CVPBrowse = { list, apiKey, setApiKey, region };
})();
