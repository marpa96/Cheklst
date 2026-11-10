# Cheklst

General-purpose checklists (travel, hiking, the car, home), forked from FliteChek and reshaped for everyday use. FliteChek in `~/Desktop/Flight/FliteChek` is unchanged.

## What's different from FliteChek

- **Your own categories:** create, rename, reorder, give each an emoji, and delete them (from Home → Edit). Categories that come from GitHub folders take their name from the folder.
- **Create checklists in the app** with **＋ New**. The visual editor has items (with nesting), headings, notes and calculations; there's also a Markdown mode. Edits keep a revision history.
- **Online-first, with offline per checklist.** The app shell is cached after the first visit. Checklists you create in the app always live on the device. GitHub checklists are stored on the device only when their **Save offline** toggle is on; otherwise they need internet to open. A checklist you've started keeps its copy until you close it.
- **Calculations** replace the fuel calculator. They're described below.
- Removed: flight filters (aircraft, VFR/IFR, tail number, airfield), the emergency mode, the timed auto-scroll, the night-red theme (replaced by Light/Dark/Match device), and the Mac-hosted HTTPS server with its certificates.

## Calculations

Add a calculation row in the editor, or put a `calc` block in Markdown:

````md
```calc
title Trip fuel cost
input distance = 300 | Distance (mi)
input mpg = 30 | Fuel economy (mpg)
let gallons = distance / mpg
show cost = round(gallons * 3.5, 2) | Fuel cost ($)
```

- [ ] Budget ${{cost}} for fuel
````

- `input`: a number you fill in while using the checklist.
- `let`: a hidden working value.
- `show`: a result displayed on the card.

Formulas support `+ - * / ^ %`, parentheses, comparisons, `min max round(x, digits) floor ceil abs sqrt pow if(test, a, b)`, and `pi`. Writing `{{name}}` anywhere shows a value. Formulas go through a small arithmetic evaluator; nothing is passed to `eval()`. Running real code is planned for later as a separate block type (see `web/calc.js`).

## Checklist library on GitHub

Library checklists live in the sibling folder **`../Cheklst-Checklists`**. Each Markdown file goes in a category folder. Pushing to `main` runs **Publish Cheklst library**, which builds `library.json` onto the `cheklst-library` branch. The app syncs on launch and from Home → Sync with GitHub. The default library is `marpa96/Cheklst-Checklists`; change it in Settings.

The app reads the library without a token, so **the checklist repository must be public**.

## Running it

- Mac preview: double-click **Start Cheklst.command**, then open http://localhost:8090/. You can also run `npm start`.
- iPhone: host the app on GitHub Pages. Push this folder to a GitHub repo named `Cheklst`, set Settings → Pages → Source to "GitHub Actions", then open `https://<you>.github.io/Cheklst/` in Safari and choose Share → Add to Home Screen. The included workflow runs the tests and deploys `web/`. No Mac server or certificates are needed. On the free plan, Pages requires a public repository.

## Development

- `npm test` runs the unit tests: core, calculations, editor, library and the checklist build.
- `npm run library` rebuilds `web/library.json`, the starter library the app shows until it reaches GitHub, from `../Cheklst-Checklists`.
- `npm run icons` redraws the PNG icons (needs Pillow).
- When you change app files, bump `CACHE` in `web/sw.js` and `BUILD` in `web/app.js`.

| File | Purpose |
|---|---|
| `web/core.js` | Markdown parsing, runs, device checklists, categories, validation |
| `web/calc.js` | Calculation blocks and the safe formula evaluator |
| `web/editor.js` | Visual editor rows ↔ Markdown |
| `web/library.js` | GitHub library download, validation, merge and offline toggle |
| `web/app.js` | UI |
| `web/sw.js` | Network-first offline cache for the app shell |
