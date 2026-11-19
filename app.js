// Anime Info — a static site that reads anime and manga from the AniList GraphQL API.
// Routes (URL hash):
//   #/ or #/anime                -> this season's anime
//   #/manga                      -> trending manga
//   #/search/<anime|manga>/<q>   -> search results
//   #/anime/<id>, #/manga/<id>   -> detail page (AniList ID), with matched anime/manga;
//                                   anime pages also load theme songs from AnimeThemes
//   #/ost/<country>              -> OST page: top anime songs from the iTunes Store chart
//   #/search/ost/<q>             -> theme song search by title or artist (AnimeThemes)

const API = "https://graphql.anilist.co";
const THEMES_API = "https://graphql.animethemes.moe/";
const CHART_COUNTRIES = { jp: "Japan", us: "United States", sg: "Singapore", my: "Malaysia", tw: "Taiwan", hk: "Hong Kong", ph: "Philippines", id: "Indonesia", th: "Thailand", gb: "United Kingdom" };

// One shared audio player for theme songs and chart previews.
const player = new Audio();
let playingButton = null;

function stopPlayer() {
  player.pause();
  if (playingButton) playingButton.textContent = "▶ Play";
  playingButton = null;
}

player.addEventListener("ended", stopPlayer);

// Any element with data-audio="<url>" becomes a play/pause button.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-audio]");
  if (!btn) return;
  if (playingButton === btn) {
    stopPlayer();
    return;
  }
  stopPlayer();
  player.src = btn.dataset.audio;
  player.play().catch(() => {
    btn.textContent = "Can't play";
    playingButton = null;
  });
  btn.textContent = "⏸ Pause";
  playingButton = btn;
});
const app = document.getElementById("app");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchType = document.getElementById("search-type");
const navLinks = document.querySelectorAll("[data-nav]");

let currentRoute = 0; // used to ignore responses from routes the user already left

// ---------- helpers ----------

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function query(gql, variables = {}) {
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: gql, variables }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Data is unavailable right now. Try again later.");
  }
  if (res.status === 429) throw new Error("Too many requests. Wait a minute and try again.");
  const json = await res.json().catch(() => null);
  if (res.status === 404 || json?.errors?.some((e) => e.status === 404)) throw new Error("That title couldn't be found.");
  if (!res.ok || !json?.data) throw new Error(`Data is unavailable right now (error ${res.status}).`);
  return json.data;
}

function currentSeason(date = new Date()) {
  const seasons = ["WINTER", "WINTER", "WINTER", "SPRING", "SPRING", "SPRING", "SUMMER", "SUMMER", "SUMMER", "FALL", "FALL", "FALL"];
  return { season: seasons[date.getMonth()], year: date.getFullYear() };
}

function pretty(enumValue) {
  if (!enumValue) return "";
  const special = { TV: "TV", TV_SHORT: "TV Short", OVA: "OVA", ONA: "ONA", ONE_SHOT: "One-shot", SPIN_OFF: "Spin-off" };
  if (special[enumValue]) return special[enumValue];
  return enumValue.toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

function formatDate(d) {
  if (!d?.year) return "";
  if (!d.month) return String(d.year);
  return new Date(d.year, d.month - 1, d.day || 1).toLocaleDateString("en", {
    year: "numeric",
    month: "short",
    ...(d.day ? { day: "numeric" } : {}),
  });
}

function cleanDescription(text) {
  return (text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function displayTitle(m) {
  return m.title.english || m.title.romaji;
}

function setActiveNav(type) {
  navLinks.forEach((a) => {
    if (a.dataset.nav === type) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (type === "anime" || type === "manga" || type === "ost") searchType.value = type;
}

// ---------- GraphQL ----------

const CARD_FIELDS = `
  id
  type
  title { romaji english }
  coverImage { large }
  format
  averageScore
  startDate { year }
`;

const LIST_QUERY = `
  query ($type: MediaType, $season: MediaSeason, $year: Int, $search: String, $sort: [MediaSort]) {
    Page(perPage: 24) {
      media(type: $type, season: $season, seasonYear: $year, search: $search, isAdult: false, sort: $sort) { ${CARD_FIELDS} }
    }
  }`;

const DETAIL_QUERY = `
  query ($id: Int, $type: MediaType) {
    Media(id: $id, type: $type) {
      id
      type
      siteUrl
      title { romaji english native }
      coverImage { extraLarge large }
      format
      episodes
      duration
      chapters
      volumes
      status
      startDate { year month day }
      endDate { year month day }
      averageScore
      popularity
      rankings { rank type allTime }
      studios(isMain: true) { nodes { name } }
      staff(perPage: 8, sort: [RELEVANCE]) { edges { role node { name { full } } } }
      genres
      tags { name rank isMediaSpoiler }
      description(asHtml: false)
      relations { edges { relationType(version: 2) node { ${CARD_FIELDS} isAdult } } }
    }
  }`;

// ---------- views ----------

function showLoading(label = "Loading…") {
  app.innerHTML = `<div class="center"><span aria-busy="true">${esc(label)}</span></div>`;
}

function showError(message) {
  app.innerHTML = `
    <article class="center">
      <p>${esc(message)}</p>
      <button id="retry">Try again</button>
    </article>`;
  document.getElementById("retry").addEventListener("click", route);
}

function cardsHTML(list, labelFor) {
  if (!list.length) return `<p class="center">Nothing found.</p>`;
  return `<div class="grid-cards">${list
    .map((m) => {
      const meta = [pretty(m.format), m.averageScore ? `★ ${m.averageScore}%` : null, m.startDate?.year]
        .filter(Boolean)
        .join(" · ");
      const label = labelFor ? labelFor(m) : "";
      return `
        <a class="card-link" href="#/${m.type.toLowerCase()}/${m.id}">
          <article class="card">
            <img src="${esc(m.coverImage?.large)}" alt="" loading="lazy">
            <div class="card-body">
              ${label ? `<div class="card-label">${esc(label)}</div>` : ""}
              <div class="card-title">${esc(displayTitle(m))}</div>
              <div class="card-meta">${esc(meta)}</div>
            </div>
          </article>
        </a>`;
    })
    .join("")}</div>`;
}

async function homeView(token, type) {
  setActiveNav(type);
  searchInput.value = "";
  let heading, vars;
  if (type === "anime") {
    const { season, year } = currentSeason();
    heading = `${pretty(season)} ${year} anime`;
    vars = { type: "ANIME", season, year, sort: ["POPULARITY_DESC"] };
  } else {
    heading = "Trending manga";
    vars = { type: "MANGA", sort: ["TRENDING_DESC"] };
  }
  showLoading(`Loading ${heading.toLowerCase()}…`);
  const data = await query(LIST_QUERY, vars);
  if (token !== currentRoute) return;
  app.innerHTML = `<h2>${esc(heading)}</h2>${cardsHTML(data.Page.media)}`;
}

async function searchView(token, type, text) {
  setActiveNav(type);
  searchInput.value = text;
  showLoading(`Searching ${type} for “${text}”…`);
  const data = await query(LIST_QUERY, { type: type.toUpperCase(), search: text, sort: ["SEARCH_MATCH"] });
  if (token !== currentRoute) return;
  app.innerHTML = `<h2>${type === "anime" ? "Anime" : "Manga"} results for “${esc(text)}”</h2>${cardsHTML(data.Page.media)}`;
}

// ---------- theme songs (AnimeThemes) ----------

const SONG_FIELDS = `title { romaji native } performances { as artist { name { main } } }`;
const ENTRY_FIELDS = `animethemeentries { episodes nsfw videos { nodes { link audio { link } } } }`;
const ANIME_LINK_FIELDS = `anime { title { romaji english } resources(site: ANILIST) { nodes { externalId } } images(facet: SMALL_COVER) { nodes { link } } }`;

const THEMES_QUERY = `
  query ($id: [Int!]) {
    findAnimeByExternalSite(site: ANILIST, id: $id) {
      animethemes { type sequence song { ${SONG_FIELDS} } ${ENTRY_FIELDS} }
    }
  }`;

const OST_SEARCH_QUERY = `
  query ($q: String!) {
    search(search: $q, first: 20) {
      animethemes { type sequence song { ${SONG_FIELDS} } ${ANIME_LINK_FIELDS} ${ENTRY_FIELDS} }
      artists {
        name { main }
        performances { song { ${SONG_FIELDS} animethemes { type sequence ${ANIME_LINK_FIELDS} ${ENTRY_FIELDS} } } }
      }
    }
  }`;

async function themesRequest(gql, variables) {
  const res = await fetch(THEMES_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: gql, variables }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (!res.ok || !json.data) throw new Error("AnimeThemes unavailable");
  return json.data;
}

// AnimeThemes can list the same song more than once (e.g. dub versions). Keep the entry with artists.
function uniqueThemes(themes) {
  const unique = new Map();
  for (const t of themes) {
    const animeKey = t.anime?.title?.romaji || "";
    const key = `${animeKey}|${t.type}${t.sequence || 0}|${(t.song?.title?.romaji || t.song?.title?.native || "").toLowerCase()}`;
    const prev = unique.get(key);
    if (!prev || (!prev.song?.performances?.length && t.song?.performances?.length)) unique.set(key, t);
  }
  return [...unique.values()];
}

async function fetchThemes(anilistId) {
  const data = await themesRequest(THEMES_QUERY, { id: [anilistId] });
  return data.findAnimeByExternalSite?.[0]?.animethemes || [];
}

function themeRowHTML(t, showAnime = false) {
  const title = t.song?.title?.romaji || t.song?.title?.native || "Untitled";
  const native = t.song?.title?.native && t.song.title.native !== title ? t.song.title.native : "";
  const artists = (t.song?.performances || [])
    .map((p) => p.artist?.name?.main + (p.as ? ` (as ${p.as})` : ""))
    .filter(Boolean)
    .join(", ");
  const entry = (t.animethemeentries || []).find((e) => !e.nsfw) || t.animethemeentries?.[0];
  const video = entry?.videos?.nodes?.[0];
  const label = `${t.type}${t.sequence ? t.sequence : ""}`;
  const appleSearch = `https://music.apple.com/search?term=${encodeURIComponent(`${title} ${artists}`)}`;

  let animeLine = "";
  let cover = "";
  if (showAnime && t.anime) {
    const animeTitle = t.anime.title?.english || t.anime.title?.romaji || "";
    const anilistId = t.anime.resources?.nodes?.[0]?.externalId;
    animeLine = anilistId
      ? `<div class="song-anime"><a href="#/anime/${esc(anilistId)}">${esc(animeTitle)}</a></div>`
      : `<div class="song-anime">${esc(animeTitle)}</div>`;
    const img = t.anime.images?.nodes?.[0]?.link;
    cover = img ? `<img class="chart-art" src="${esc(img)}" alt="" loading="lazy">` : `<span class="chart-art"></span>`;
  }

  return `
    <li class="song">
      ${cover}
      <span class="song-badge">${esc(label)}</span>
      <div class="song-info">
        <div class="song-title">${esc(title)}${native ? ` <span class="muted">${esc(native)}</span>` : ""}</div>
        <div class="song-meta">${esc([artists, entry?.episodes ? `eps ${entry.episodes}` : ""].filter(Boolean).join(" · "))}</div>
        ${animeLine}
      </div>
      <div class="song-actions">
        ${video?.audio?.link ? `<button class="outline small" data-audio="${esc(video.audio.link)}">▶ Play</button>` : ""}
        ${video?.link && !entry?.nsfw ? `<a class="small" href="${esc(video.link)}" target="_blank" rel="noopener">Watch</a>` : ""}
        <a class="small" href="${esc(appleSearch)}" target="_blank" rel="noopener">Apple Music</a>
      </div>
    </li>`;
}

async function loadThemes(token, anilistId) {
  const box = document.getElementById("themes");
  if (!box) return;
  box.innerHTML = `<h3>Theme songs</h3><p class="muted" aria-busy="true">Loading theme songs…</p>`;
  let themes;
  try {
    themes = await fetchThemes(anilistId);
  } catch {
    if (token === currentRoute) box.innerHTML = `<h3>Theme songs</h3><p class="muted">Theme songs are unavailable right now.</p>`;
    return;
  }
  if (token !== currentRoute) return;
  if (!themes.length) {
    box.innerHTML = `<h3>Theme songs</h3><p class="muted">No theme songs listed for this anime.</p>`;
    return;
  }
  const order = { OP: 0, ED: 1 };
  const list = uniqueThemes(themes).sort(
    (a, b) => (order[a.type] ?? 2) - (order[b.type] ?? 2) || (a.sequence || 0) - (b.sequence || 0)
  );
  const SHOWN = 12;
  const first = list.slice(0, SHOWN).map(themeRowHTML).join("");
  const rest = list.slice(SHOWN).map(themeRowHTML).join("");
  box.innerHTML = `<h3>Theme songs <small class="muted">(${list.length})</small></h3>
    <ul class="songs">${first}</ul>
    ${rest ? `<details><summary>Show ${list.length - SHOWN} more</summary><ul class="songs">${rest}</ul></details>` : ""}
    <p class="muted small-print">Songs and clips from <a href="https://animethemes.moe" target="_blank" rel="noopener">AnimeThemes</a>.</p>`;
}

// ---------- OST search (AnimeThemes: by song title or artist) ----------

async function ostSearchView(token, text) {
  setActiveNav("ost");
  searchInput.value = text;
  showLoading(`Searching songs for “${text}”…`);
  let data;
  try {
    data = await themesRequest(OST_SEARCH_QUERY, { q: text });
  } catch {
    throw new Error("Song search is unavailable right now. Try again later.");
  }
  if (token !== currentRoute) return;

  const songs = uniqueThemes(data.search.animethemes || []);

  // Artists whose name contains the search text: list every theme they performed.
  const needle = text.toLowerCase();
  const artists = (data.search.artists || [])
    .filter((a) => a.name?.main?.toLowerCase().includes(needle))
    .slice(0, 2)
    .map((a) => ({
      name: a.name.main,
      themes: uniqueThemes(
        (a.performances || []).flatMap((p) =>
          (p.song?.animethemes || []).map((t) => ({ ...t, song: p.song }))
        )
      ),
    }))
    .filter((a) => a.themes.length);

  let html = `<h2>Songs for “${esc(text)}”</h2>`;
  if (!songs.length && !artists.length) {
    html += `<p class="center">No songs found. Try a song title or an artist name.</p>`;
  }
  for (const a of artists) {
    html += `<section class="ost-section"><h3>By ${esc(a.name)} <small class="muted">(${a.themes.length})</small></h3>
      <ul class="songs">${a.themes.map((t) => themeRowHTML(t, true)).join("")}</ul></section>`;
  }
  if (songs.length) {
    html += `<section class="ost-section"><h3>${artists.length ? "Song title matches" : "Songs"}</h3>
      <ul class="songs">${songs.map((t) => themeRowHTML(t, true)).join("")}</ul></section>`;
  }
  html += `<p class="muted small-print">Songs and clips from <a href="https://animethemes.moe" target="_blank" rel="noopener">AnimeThemes</a>.</p>`;
  app.innerHTML = html;
}

// ---------- OST page: top anime songs chart (iTunes Store "Anime" genre) ----------

function chartCountry() {
  try {
    const saved = localStorage.getItem("chartCountry");
    if (saved && CHART_COUNTRIES[saved]) return saved;
  } catch {}
  return "jp";
}

async function ostView(token, country) {
  setActiveNav("ost");
  searchInput.value = "";
  if (!CHART_COUNTRIES[country]) country = chartCountry();
  try {
    localStorage.setItem("chartCountry", country);
  } catch {}

  const picker = `
    <h2>Anime OST</h2>
    <p class="muted">Search above with <strong>OST</strong> selected to find any opening or ending by song title or artist.</p>
    <div class="chart-head">
      <h3>Top anime songs</h3>
      <select id="chart-country" aria-label="Country">
        ${Object.entries(CHART_COUNTRIES).map(([code, name]) => `<option value="${code}" ${code === country ? "selected" : ""}>${esc(name)}</option>`).join("")}
      </select>
    </div>`;
  app.innerHTML = `${picker}<div class="center"><span aria-busy="true">Loading chart…</span></div>`;
  document.getElementById("chart-country").addEventListener("change", (e) => {
    location.hash = `#/ost/${e.target.value}`;
  });

  let res;
  try {
    res = await fetch(`https://itunes.apple.com/${country}/rss/topsongs/limit=50/genre=29/json`, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("The chart is unavailable right now. Try again later.");
  }
  if (!res.ok) throw new Error(`The chart is unavailable right now (error ${res.status}).`);
  const feed = (await res.json()).feed;
  if (token !== currentRoute) return;

  let entries = feed.entry || [];
  if (!Array.isArray(entries)) entries = [entries];
  const rows = entries.map((e, i) => {
    const links = Array.isArray(e.link) ? e.link : [e.link];
    const page = links.find((l) => l.attributes?.rel === "alternate")?.attributes?.href;
    const preview = links.find((l) => l.attributes?.rel === "enclosure")?.attributes?.href;
    const images = e["im:image"] || [];
    const art = images[images.length - 1]?.label;
    const album = e["im:collection"]?.["im:name"]?.label;
    return `
      <li class="song chart-row">
        <span class="chart-rank">${i + 1}</span>
        ${art ? `<img class="chart-art" src="${esc(art)}" alt="" loading="lazy">` : ""}
        <div class="song-info">
          <div class="song-title">${esc(e["im:name"]?.label)}</div>
          <div class="song-meta">${esc([e["im:artist"]?.label, album].filter(Boolean).join(" · "))}</div>
        </div>
        <div class="song-actions">
          ${preview ? `<button class="outline small" data-audio="${esc(preview)}">▶ Play</button>` : ""}
          ${page ? `<a class="small" href="${esc(page)}" target="_blank" rel="noopener">Apple Music</a>` : ""}
        </div>
      </li>`;
  });

  app.innerHTML = `${picker}
    <p class="muted">Best-selling songs in the iTunes Store's Anime genre in ${esc(CHART_COUNTRIES[country])}, updated by Apple. Previews are 30 seconds.</p>
    ${rows.length ? `<ol class="songs chart">${rows.join("")}</ol>` : `<p class="center">No chart data for this country.</p>`}`;
  document.getElementById("chart-country").addEventListener("change", (e) => {
    location.hash = `#/ost/${e.target.value}`;
  });
}

// Relation types that link an anime to its manga (and back) come first.
const RELATION_ORDER = ["SOURCE", "ADAPTATION", "PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "ALTERNATIVE_VERSION", "SUMMARY", "COMPILATION", "OTHER"];

function relationsHTML(m) {
  const edges = (m.relations?.edges || []).filter(
    (e) => !e.node.isAdult && e.relationType !== "CHARACTER" && (e.node.type === "ANIME" || e.node.type === "MANGA")
  );
  const rank = (e) => {
    const i = RELATION_ORDER.indexOf(e.relationType);
    return i === -1 ? RELATION_ORDER.length : i;
  };
  edges.sort((a, b) => rank(a) - rank(b));

  const otherType = m.type === "ANIME" ? "MANGA" : "ANIME";
  const matched = edges.filter((e) => e.node.type === otherType);
  const related = edges.filter((e) => e.node.type !== otherType);
  const label = (node) => {
    const e = edges.find((x) => x.node === node);
    return pretty(e.relationType);
  };

  const matchedTitle = m.type === "ANIME" ? "Manga" : "Anime";
  let html = `<section class="related"><h3>${matchedTitle}</h3>`;
  html += matched.length
    ? cardsHTML(matched.map((e) => e.node), label)
    : `<p class="muted">No linked ${matchedTitle.toLowerCase()} found on AniList.</p>`;
  html += `</section>`;
  if (related.length) {
    html += `<section class="related"><h3>Related ${m.type === "ANIME" ? "anime" : "manga"}</h3>${cardsHTML(related.map((e) => e.node), label)}</section>`;
  }
  return html;
}

async function detailView(token, type, id) {
  setActiveNav(type);
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) throw new Error("That title couldn't be found.");
  showLoading();
  const { Media: m } = await query(DETAIL_QUERY, { id: numericId, type: type.toUpperCase() });
  if (token !== currentRoute) return;

  const isAnime = m.type === "ANIME";
  const altTitles = [m.title.english && m.title.romaji !== m.title.english ? m.title.romaji : null, m.title.native]
    .filter(Boolean)
    .join(" · ");

  const rated = m.rankings?.find((r) => r.type === "RATED" && r.allTime);
  const start = formatDate(m.startDate);
  const end = formatDate(m.endDate);
  const dates = start && end && start !== end ? `${start} to ${end}` : start;
  const authors = (m.staff?.edges || [])
    .filter((e) => /story|art|original creator/i.test(e.role))
    .map((e) => `${e.node.name.full} (${e.role.replace(/\s*\(.*\)/, "")})`)
    .slice(0, 3)
    .join(", ");

  const facts = [
    ["Score", m.averageScore ? `★ ${m.averageScore}%` : "N/A"],
    ["Rank", rated ? `#${rated.rank} highest rated` : null],
    ["Popularity", m.popularity ? `${m.popularity.toLocaleString()} users` : null],
    ["Format", pretty(m.format)],
    ...(isAnime
      ? [
          ["Episodes", m.episodes ? `${m.episodes}${m.duration ? ` × ${m.duration} min` : ""}` : "Unknown"],
          ["Status", pretty(m.status)],
          ["Aired", dates],
          ["Studios", m.studios?.nodes?.map((s) => s.name).join(", ")],
        ]
      : [
          ["Chapters", m.chapters ?? (m.status === "RELEASING" ? "Ongoing" : "Unknown")],
          ["Volumes", m.volumes],
          ["Status", pretty(m.status)],
          ["Published", dates],
          ["Authors", authors],
        ]),
  ].filter(([, v]) => v);

  const topTags = (m.tags || [])
    .filter((t) => !t.isMediaSpoiler && t.rank >= 60)
    .slice(0, 5)
    .map((t) => t.name);
  const tags = [...(m.genres || []), ...topTags];
  const cover = m.coverImage?.extraLarge || m.coverImage?.large;
  const mangadexUrl = `https://mangadex.org/search?q=${encodeURIComponent(m.title.romaji || displayTitle(m))}`;

  document.title = `${displayTitle(m)} · Anime Info`;
  app.innerHTML = `
    <p><a href="javascript:history.back()">← Back</a></p>
    <section class="detail">
      <img src="${esc(cover)}" alt="Cover for ${esc(displayTitle(m))}">
      <div>
        <h2>${esc(displayTitle(m))}</h2>
        ${altTitles ? `<p class="alt-titles">${esc(altTitles)}</p>` : ""}
        <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <h3>Synopsis</h3>
        <p class="synopsis">${esc(cleanDescription(m.description) || "No synopsis available.")}</p>
        <div class="actions">
          <a href="${esc(m.siteUrl)}" target="_blank" rel="noopener" role="button" class="outline">View on AniList</a>
          ${isAnime ? "" : `<a href="${esc(mangadexUrl)}" target="_blank" rel="noopener" role="button" class="outline secondary">Find on MangaDex</a>`}
        </div>
        ${isAnime ? `<section id="themes" class="themes"></section>` : ""}
      </div>
    </section>
    ${relationsHTML(m)}`;
  if (isAnime) loadThemes(token, m.id);
}

// ---------- router ----------

async function route() {
  const token = ++currentRoute;
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const [section] = parts;
  document.title = "Anime Info";
  window.scrollTo(0, 0);
  stopPlayer();

  try {
    if (section === "ost" || section === "charts") {
      await ostView(token, parts[1] || chartCountry());
    } else if ((section === "anime" || section === "manga") && parts[1]) {
      await detailView(token, section, decodeURIComponent(parts[1]));
    } else if (section === "search") {
      // #/search/<type>/<q>; older links used #/search/<q> for anime
      const hasType = ["anime", "manga", "ost"].includes(parts[1]);
      const type = hasType ? parts[1] : "anime";
      const text = decodeURIComponent(parts.slice(hasType ? 2 : 1).join("/")).trim();
      if (type === "ost") {
        if (text) await ostSearchView(token, text);
        else await ostView(token, chartCountry());
      } else if (text) await searchView(token, type, text);
      else await homeView(token, type);
    } else {
      await homeView(token, section === "manga" ? "manga" : "anime");
    }
  } catch (err) {
    if (token !== currentRoute) return;
    showError(err.message || "Data is unavailable right now. Try again later.");
  }
}

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) location.hash = `#/search/${searchType.value}/${encodeURIComponent(q)}`;
});

window.addEventListener("hashchange", route);
route();
