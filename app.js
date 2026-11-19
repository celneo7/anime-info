// Anime Info — a static site that reads from the AniList GraphQL API.
// Routes (URL hash):
//   #/                 -> this season's anime
//   #/search/<query>   -> search results
//   #/anime/<id>       -> anime detail (AniList ID)

const API = "https://graphql.anilist.co";
const app = document.getElementById("app");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");

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
    throw new Error("Anime data is unavailable right now. Try again later.");
  }
  if (res.status === 429) throw new Error("Too many requests. Wait a minute and try again.");
  const json = await res.json().catch(() => null);
  if (res.status === 404 || json?.errors?.some((e) => e.status === 404)) throw new Error("That anime couldn't be found.");
  if (!res.ok || !json?.data) throw new Error(`Anime data is unavailable right now (error ${res.status}).`);
  return json.data;
}

function currentSeason(date = new Date()) {
  const seasons = ["WINTER", "WINTER", "WINTER", "SPRING", "SPRING", "SPRING", "SUMMER", "SUMMER", "SUMMER", "FALL", "FALL", "FALL"];
  return { season: seasons[date.getMonth()], year: date.getFullYear() };
}

function pretty(enumValue) {
  if (!enumValue) return "";
  const special = { TV: "TV", TV_SHORT: "TV Short", OVA: "OVA", ONA: "ONA" };
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

function displayTitle(a) {
  return a.title.english || a.title.romaji;
}

// ---------- GraphQL ----------

const CARD_FIELDS = `
  id
  title { romaji english }
  coverImage { large }
  format
  averageScore
  seasonYear
`;

const SEASON_QUERY = `
  query ($season: MediaSeason, $year: Int) {
    Page(perPage: 24) {
      media(season: $season, seasonYear: $year, type: ANIME, isAdult: false, sort: POPULARITY_DESC) { ${CARD_FIELDS} }
    }
  }`;

const SEARCH_QUERY = `
  query ($search: String) {
    Page(perPage: 24) {
      media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { ${CARD_FIELDS} }
    }
  }`;

const DETAIL_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      siteUrl
      title { romaji english native }
      coverImage { extraLarge large }
      format
      episodes
      duration
      status
      startDate { year month day }
      endDate { year month day }
      averageScore
      popularity
      rankings { rank type allTime }
      studios(isMain: true) { nodes { name } }
      genres
      tags { name rank isMediaSpoiler }
      description(asHtml: false)
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

function cardsHTML(list) {
  if (!list.length) return `<p class="center">No anime found.</p>`;
  return `<div class="grid-cards">${list
    .map((a) => {
      const meta = [pretty(a.format), a.averageScore ? `★ ${a.averageScore}%` : null, a.seasonYear]
        .filter(Boolean)
        .join(" · ");
      return `
        <a class="card-link" href="#/anime/${a.id}">
          <article class="card">
            <img src="${esc(a.coverImage?.large)}" alt="" loading="lazy">
            <div class="card-body">
              <div class="card-title">${esc(displayTitle(a))}</div>
              <div class="card-meta">${esc(meta)}</div>
            </div>
          </article>
        </a>`;
    })
    .join("")}</div>`;
}

async function seasonView(token) {
  const { season, year } = currentSeason();
  showLoading("Loading this season's anime…");
  const data = await query(SEASON_QUERY, { season, year });
  if (token !== currentRoute) return;
  app.innerHTML = `<h2>${esc(pretty(season))} ${year} anime</h2>${cardsHTML(data.Page.media)}`;
}

async function searchView(token, text) {
  searchInput.value = text;
  showLoading(`Searching for “${text}”…`);
  const data = await query(SEARCH_QUERY, { search: text });
  if (token !== currentRoute) return;
  app.innerHTML = `<h2>Results for “${esc(text)}”</h2>${cardsHTML(data.Page.media)}`;
}

async function detailView(token, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) throw new Error("That anime couldn't be found.");
  showLoading();
  const { Media: a } = await query(DETAIL_QUERY, { id: numericId });
  if (token !== currentRoute) return;

  const altTitles = [a.title.english && a.title.romaji !== a.title.english ? a.title.romaji : null, a.title.native]
    .filter(Boolean)
    .join(" · ");

  const rated = a.rankings?.find((r) => r.type === "RATED" && r.allTime);
  const start = formatDate(a.startDate);
  const end = formatDate(a.endDate);
  const aired = start && end && start !== end ? `${start} to ${end}` : start;

  const facts = [
    ["Score", a.averageScore ? `★ ${a.averageScore}%` : "N/A"],
    ["Rank", rated ? `#${rated.rank} highest rated` : null],
    ["Popularity", a.popularity ? `${a.popularity.toLocaleString()} users` : null],
    ["Format", pretty(a.format)],
    ["Episodes", a.episodes ? `${a.episodes}${a.duration ? ` × ${a.duration} min` : ""}` : "Unknown"],
    ["Status", pretty(a.status)],
    ["Aired", aired],
    ["Studios", a.studios?.nodes?.map((s) => s.name).join(", ")],
  ].filter(([, v]) => v);

  const topTags = (a.tags || [])
    .filter((t) => !t.isMediaSpoiler && t.rank >= 60)
    .slice(0, 5)
    .map((t) => t.name);
  const tags = [...(a.genres || []), ...topTags];
  const cover = a.coverImage?.extraLarge || a.coverImage?.large;

  document.title = `${displayTitle(a)} · Anime Info`;
  app.innerHTML = `
    <p><a href="javascript:history.back()">← Back</a></p>
    <section class="detail">
      <img src="${esc(cover)}" alt="Cover for ${esc(displayTitle(a))}">
      <div>
        <h2>${esc(displayTitle(a))}</h2>
        ${altTitles ? `<p class="alt-titles">${esc(altTitles)}</p>` : ""}
        <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <h3>Synopsis</h3>
        <p class="synopsis">${esc(cleanDescription(a.description) || "No synopsis available.")}</p>
        <p><a href="${esc(a.siteUrl)}" target="_blank" rel="noopener" role="button" class="outline">View on AniList</a></p>
      </div>
    </section>`;
}

// ---------- router ----------

async function route() {
  const token = ++currentRoute;
  const hash = location.hash.replace(/^#\/?/, "");
  const [section, ...rest] = hash.split("/");
  const param = decodeURIComponent(rest.join("/"));
  document.title = "Anime Info";
  window.scrollTo(0, 0);

  try {
    if (section === "anime" && param) await detailView(token, param);
    else if (section === "search" && param) await searchView(token, param);
    else {
      searchInput.value = "";
      await seasonView(token);
    }
  } catch (err) {
    if (token !== currentRoute) return;
    showError(err.message || "Anime data is unavailable right now. Try again later.");
  }
}

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
});

window.addEventListener("hashchange", route);
route();
