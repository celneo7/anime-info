# Anime Info

A small static site for browsing anime information. It runs entirely in the browser and is hosted on GitHub Pages.

- **Home:** this season's anime
- **Search:** find any anime by title
- **Detail:** score, rank, episodes, status, air dates, studios, genres, synopsis, opening/ending theme songs, and a link to MyAnimeList

Data comes from [Jikan](https://jikan.moe), an **unofficial** MyAnimeList API. Jikan allows about 3 requests per second and 60 per minute, and it is sometimes slow or down. When that happens the site shows an error with a "Try again" button. This project is not affiliated with or endorsed by MyAnimeList.

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
