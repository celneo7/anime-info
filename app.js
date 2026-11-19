// Anime Info — a static site that reads anime and manga from the AniList GraphQL API.
// Routes (URL hash):
//   #/ or #/anime                -> this season's anime
//   #/manga                      -> trending manga
//   #/search/<anime|manga>/<q>   -> search results
//   #/anime/<id>, #/manga/<id>   -> detail page (AniList ID), with matched anime/manga

const API = "https://graphql.anilist.co";
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
  searchType.value = type;
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
      </div>
    </section>
    ${relationsHTML(m)}`;
}

// ---------- router ----------

async function route() {
  const token = ++currentRoute;
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const [section] = parts;
  document.title = "Anime Info";
  window.scrollTo(0, 0);

  try {
    if ((section === "anime" || section === "manga") && parts[1]) {
      await detailView(token, section, decodeURIComponent(parts[1]));
    } else if (section === "search") {
      // #/search/<type>/<q>; older links used #/search/<q> for anime
      const hasType = parts[1] === "anime" || parts[1] === "manga";
      const type = hasType ? parts[1] : "anime";
      const text = decodeURIComponent(parts.slice(hasType ? 2 : 1).join("/")).trim();
      if (text) await searchView(token, type, text);
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
