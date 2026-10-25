// Turns a video file name into something readable:
//   "Breaking.Bad.S01E03.720p.BluRay.x264.mkv" -> { kind:'series', show:'Breaking Bad', season:1, episode:3, key:'S01E03' }
//   "Inception.2010.1080p.WEB-DL.mp4"          -> { kind:'movie', title:'Inception', year:2010 }
(function (root) {
  const JUNK = /\b(2160p|1080p|720p|480p|4k|uhd|hdr10?\+?|dv|hevc|x26[45]|h\.?26[45]|av1|10bit|8bit|web[-. ]?dl|web[-. ]?rip|webrip|web|blu[-. ]?ray|bdrip|brrip|dvdrip|hdrip|hdtv|remux|proper|repack|extended|unrated|imax|aac(?:2\.0)?|ac3|eac3|ddp?\d?(?:\.\d)?|dts(?:-hd)?|atmos|truehd|5\.1|7\.1|2\.0|esub|esubs|subs?|multi|dual[-. ]?audio|hindi|english|nf|amzn|dsnp|hmax|atvp|yts|yify|rarbg|psa|pahe)\b.*$/i;

  function clean(s) {
    return s
      .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')   // [group] {tags}
      .replace(/[._]+/g, ' ')
      .replace(/\s*-\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleCase(s) {
    return s.replace(/\b([a-z])([a-z']*)/g, (m, a, b) => a.toUpperCase() + b);
  }

  const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|wma|alac|aiff?)$/i;
  function isAudio(fileName) { return AUDIO.test(String(fileName || '')); }

  // "03 - Arijit Singh - Tum Hi Ho.mp3" -> { kind:'music', title:'Tum Hi Ho', artist:'Arijit Singh' }
  function parseSong(base) {
    let s = base.replace(/_/g, ' ').replace(/\s*[\[(](official|lyrics?|audio|video|hd|hq|\d{3,4}\s*kbps)[^\])]*[\])]/gi, '');
    s = s.replace(/^\s*(?:cd\s*\d+\s*)?\d{1,3}\s*[-.)_]?\s+/i, '');   // track number
    const parts = s.split(/\s+[-–—]\s+/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) return { kind: 'music', artist: parts[0], title: parts.slice(1).join(' - '), key: null };
    return { kind: 'music', artist: '', title: s.trim() || base, key: null };
  }

  function parseTitle(fileName) {
    if (isAudio(fileName)) return parseSong(String(fileName).replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,4}$/i, ''));
    const base = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,4}$/i, '');
    let name = base.replace(/[._]+/g, ' ');

    // Series: S01E02, s1e2, 1x02, "Season 1 Episode 2"
    const ep = name.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) ||
               name.match(/\b(\d{1,2})x(\d{2,3})\b/i) ||
               name.match(/\bSeason\s*(\d{1,2})\s*Episode\s*(\d{1,3})\b/i);
    if (ep) {
      const season = +ep[1], episode = +ep[2];
      let show = clean(name.slice(0, ep.index).replace(/\(\s*\d{4}\s*\)|\b(19|20)\d{2}\b\s*$/, ''));
      show = show.replace(JUNK, '').trim();
      const after = clean(name.slice(ep.index + ep[0].length)).replace(JUNK, '').replace(/^[-\s]+/, '').trim();
      const key = 'S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0');
      return { kind: 'series', show: titleCase(show) || 'Unknown show', season, episode, key, episodeTitle: after.length > 1 && after.length < 60 && !/^(episode|ep|part)$/i.test(after) ? titleCase(after) : '' };
    }

    // Movie: cut at the year, else at the first quality/junk tag.
    // Use the last year-looking number, so "Blade Runner 2049 2017" keeps 2049 in the title.
    const years = [...name.matchAll(/[\s(\[](19[3-9]\d|20[0-4]\d)(?=[\s)\]]|$)/g)];
    const yr = years.length ? years[years.length - 1] : null;
    let title = yr ? name.slice(0, yr.index) : name;
    title = clean(title).replace(JUNK, '').replace(/[\s(-]+$/, '').trim();
    return { kind: 'movie', title: titleCase(title) || base, year: yr ? +yr[1] : null, key: null };
  }

  function label(t) {
    if (!t) return '';
    if (t.kind === 'music') return t.title + (t.artist ? ` — ${t.artist}` : '');
    if (t.kind === 'series') return `${t.show} · ${t.key}` + (t.episodeTitle ? ` · ${t.episodeTitle}` : '');
    return t.title + (t.year ? ` (${t.year})` : '');
  }

  // Sort episodes by season/episode; anything unparsed goes after, in natural name order.
  function sortEpisodes(files) {
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return files
      .map(f => ({ file: f, t: parseTitle(f.name) }))
      .sort((a, b) => {
        const as = a.t.kind === 'series', bs = b.t.kind === 'series';
        if (as && bs) return a.t.season - b.t.season || a.t.episode - b.t.episode;
        if (as !== bs) return as ? -1 : 1;
        return coll.compare(a.file.name, b.file.name);
      });
  }

  const api = { parseTitle, label, sortEpisodes, isAudio };
  if (typeof module !== 'undefined') module.exports = api; else root.CVPTitles = api;
})(this);
