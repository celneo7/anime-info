# Anime Info

A small static site for browsing anime and manga. It runs entirely in the browser and is hosted on GitHub Pages.

- **Anime tab:** this season's most popular anime
- **Manga tab:** trending manga
- **Search:** find any anime or manga by title
- **Detail:** score, rank, popularity, format, episodes or chapters and volumes, status, dates, studios or authors, genres and tags, synopsis, and a link to AniList
- **Matching:** each anime page lists its source manga, and each manga page lists its anime adaptations, using AniList's own relation data. Related titles (sequels, prequels, spin-offs) are listed below.
- **Theme songs:** anime pages list every opening and ending from [AnimeThemes](https://animethemes.moe) (looked up by AniList ID), with the artist, episode range, a ▶ Play button for the TV-size audio, a link to watch the clip, and an Apple Music search link. Long lists show 12 songs with the rest behind "Show more".
- **Charts tab:** the top 50 songs in the iTunes Store's "Anime" genre, with a country picker (Japan, US, Singapore, Malaysia, Taiwan, Hong Kong, Philippines, Indonesia, Thailand, UK; the choice is remembered), 30-second previews and Apple Music links. This ranks store sales, not streaming.
- **MangaDex:** manga pages have a "Find on MangaDex" button that opens a MangaDex search for the title. MangaDex's API doesn't allow calls from other websites without a proxy server, so the site links to it instead of loading its data.

Anime and manga data comes from the [AniList GraphQL API](https://docs.anilist.co). Theme songs come from the [AnimeThemes GraphQL API](https://api-docs.animethemes.moe), and charts from the iTunes Store RSS feed. All three allow browser requests from any website and need no key. AniList currently allows 30 requests per minute, which is plenty for a few users. If AniList or the chart is down, or the limit is hit, the site shows an error with a "Try again" button. If AnimeThemes is down, only the theme songs section shows a short "unavailable" note. This project is not affiliated with or endorsed by AniList, AnimeThemes or Apple.

## Stack

Plain HTML, vanilla JavaScript (ES modules) and [Pico.css](https://picocss.com) from a CDN. There is no build step, no backend and no API key.

## Run locally

ES modules need to be served over HTTP, so opening the file directly won't work. From this folder:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

1. Push this folder's contents to the root of a GitHub repository.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, then click **Save**.
4. After a minute or so the site is live at `https://<your-username>.github.io/<repo-name>/`.

Links use the URL hash (for example `#/anime/5114`), so they work on GitHub Pages without any server configuration.
