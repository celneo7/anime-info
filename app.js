// Anime Info — a static site that reads from the Jikan API (unofficial MyAnimeList API).
// Routes (URL hash):
//   #/                 -> this season's anime
//   #/search/<query>   -> search results
//   #/anime/<id>       -> anime detail

const API = "https://api.jikan.moe/v4";
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

async function getJSON(path) {
  let res;
  try {
    res = await fetch(API + path, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("MyAnimeList data is unavailable right now. Try again later.");
  }
  if (res.status === 429) throw new Error("Too many requests to MyAnimeList data. Wait a moment and try again.");
  if (res.status === 404) throw new Error("That anime couldn't be found.");
  if (!res.ok) throw new Error(`MyAnimeList data is unavailable right now (error ${res.status}).`);
  return res.json();
}

function uniqueById(list) {
  const seen = new Set();
  return list.filter((a) => (seen.has(a.mal_id) ? false : seen.add(a.mal_id)));
}

function poster(anime) {
  return anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || "";
}

function displayTitle(anime) {
  return anime.title_english || anime.title;
}

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
      const meta = [a.type, a.score ? `★ ${a.score}` : null, a.year].filter(Boolean).join(" · ");
      return `
        <a class="card-link" href="#/anime/${a.mal_id}">
          <article class="card">
            <img src="${esc(poster(a))}" alt="" loading="lazy">
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
  showLoading("Loading this season's anime…");
  const { data } = await getJSON("/seasons/now?sfw=true&limit=24");
  if (token !== currentRoute) return;
  const list = uniqueById(data);
  const label = list[0]?.season && list[0]?.year
    ? `${list[0].season[0].toUpperCase()}${list[0].season.slice(1)} ${list[0].year}`
    : "This season";
  app.innerHTML = `<h2>${esc(label)} anime</h2>${cardsHTML(list)}`;
}

async function searchView(token, query) {
  searchInput.value = query;
  showLoading(`Searching for “${query}”…`);
  const { data } = await getJSON(`/anime?sfw=true&limit=24&order_by=members&sort=desc&q=${encodeURIComponent(query)}`);
  if (token !== currentRoute) return;
  app.innerHTML = `<h2>Results for “${esc(query)}”</h2>${cardsHTML(uniqueById(data))}`;
}

function themeList(title, items) {
  if (!items?.length) return "";
  return `<h4>${title}</h4><ol>${items.map((t) => `<li>${esc(t.replace(/^\d+:\s*/, ""))}</li>`).join("")}</ol>`;
}

async function detailView(token, id) {
  showLoading();
  const { data: a } = await getJSON(`/anime/${encodeURIComponent(id)}/full`);
  if (token !== currentRoute) return;

  const altTitles = [a.title_english && a.title !== a.title_english ? a.title : null, a.title_japanese]
    .filter(Boolean)
    .join(" · ");

  const facts = [
    ["Score", a.score ? `★ ${a.score}${a.scored_by ? ` (${a.scored_by.toLocaleString()} votes)` : ""}` : "N/A"],
    ["Rank", a.rank ? `#${a.rank}` : "N/A"],
    ["Type", a.type],
    ["Episodes", a.episodes ?? "Unknown"],
    ["Status", a.status],
    ["Aired", a.aired?.string],
    ["Studios", a.studios?.map((s) => s.name).join(", ")],
  ].filter(([, v]) => v);

  const tags = [...(a.genres || []), ...(a.themes || []), ...(a.demographics || [])];
  const themesHTML = themeList("Openings", a.theme?.openings) + themeList("Endings", a.theme?.endings);

  document.title = `${displayTitle(a)} · Anime Info`;
  app.innerHTML = `
    <p><a href="javascript:history.back()">← Back</a></p>
    <section class="detail">
      <img src="${esc(poster(a))}" alt="Poster for ${esc(displayTitle(a))}">
      <div>
        <h2>${esc(displayTitle(a))}</h2>
        ${altTitles ? `<p class="alt-titles">${esc(altTitles)}</p>` : ""}
        <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t.name)}</span>`).join("")}</div>` : ""}
        <h3>Synopsis</h3>
        <p class="synopsis">${esc(a.synopsis || "No synopsis available.")}</p>
        ${themesHTML ? `<section class="themes"><h3>Theme songs</h3>${themesHTML}</section>` : ""}
        <p><a href="${esc(a.url)}" target="_blank" rel="noopener" role="button" class="outline">View on MyAnimeList</a></p>
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
    const message = err instanceof TypeError
      ? "MyAnimeList data is unavailable right now. Try again later."
      : err.message;
    showError(message);
  }
}

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
});

window.addEventListener("hashchange", route);
route();
