# kong-gateway-changelog

RSS feed of Kong Gateway changelog entries, built from the upstream
[Kong/developer.konghq.com](https://github.com/Kong/developer.konghq.com) changelog data.

Migrated off Val.town. A daily GitHub Actions workflow (`.github/workflows/update-feed.yml`)
regenerates `dist/feed.xml` and publishes it via GitHub Pages.

- Feed: see the Pages URL once published (Settings → Pages), path `/feed.xml`.
- Regenerate locally: `node generate-feed.mjs` (writes `dist/feed.xml`, `dist/index.html`).
