# World Right Now

Today's world news, explained: where each story is happening, how we got here, and what the key terms mean.
A static site with no backend, no trackers and no outside requests.

- `index.html`, `assets/` – the site.
- `data/latest.json` – today's stories. `data/terms.json` – key terms. `data/threads.json` – timelines of ongoing stories. `data/archive/` – past days.
- `scripts/validate.mjs` – checks the data before publishing.
- `scripts/digest.mjs` – writes the morning email digest.
- `scripts/build-map.mjs` – rebuilds `assets/map.js` from Natural Earth outlines (only needed once).
- `UPDATE.md` – the daily update steps.

## Preview locally

```
npm install
npm run serve
```

Then open http://localhost:4173.

## Credits

Typeface: Schibsted Grotesk, SIL Open Font License 1.1 (`assets/fonts/OFL.txt`). Map: Natural Earth, public domain.
News reporting belongs to its publishers and is linked, not copied.
