# Drone Fly Check — AI Maintenance & Extension Manual

Audience: an AI assistant (or human) maintaining this system in a future
session with no memory of how it was built. Everything needed is in this
file and the repo. Written 2026-07-08.

## 1. System snapshot

- **What it is:** static single-page app, no build step, no backend.
  Live at https://traviswei1325-ops.github.io/drone-fly-check/
  (GitHub Pages, repo `traviswei1325-ops/drone-fly-check`, branch `main`,
  root folder; every push to `main` auto-deploys in ~1 min).
- **Data flow:** user input → `parser.js` (Google Maps URL / decimal / DMS /
  degree-decimal-minutes → lat/lng) → verdict in `index.html`:
  1. **Instant local verdict** from bundled layers (`zones.js`, `airports.js`,
     `parks.js`) via ray-cast point-in-polygon.
  2. **Live official verdict** (replaces the local one): JSONP point-intersect
     query to the CAA drone-map ArcGIS server. This is the same data behind
     https://drone.caa.gov.tw/ — treat it as authoritative.
- **Verdict precedence (local):** CAA 限航區 → airport no-fly polygon →
  national park → airport 200-ft belt (yellow) → outside-Taiwan gray → green.
  **Live:** any 紅區 or park hit → red; else 黃區 → yellow; else 綠區 → green;
  no features → gray (outside Taiwan or no data).

## 2. The official server (the crown jewels)

Base: `https://dronegis.caa.gov.tw/server/rest/services/Hosted/`

| Layer | Content |
|---|---|
| `UAV_fs_ryg/FeatureServer/0` | ~4,400 polygons: 飛航情報限航區 (28), 機場四周禁止施放 (31), 機場200呎以上禁止 (17), 縣市政府限制使用 (~4,300) |
| `Temporary_Area/FeatureServer/19` | Temporary airspace / NOTAM-like zones |
| `National_Park_fs/FeatureServer/0` | Park boundaries (we bundle our own from open data) |

Useful fields: `空域名稱`, `空域類別名稱`, `空域顏色` (紅區/黃區/綠區),
`有效日期起`/`有效日期迄`, `罰則`. Query pattern (also used by the page):

```
{BASE}/UAV_fs_ryg/FeatureServer/0/query?geometry={"x":121.56,"y":25.03,"spatialReference":{"wkid":4326}}
  &geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects
  &outFields=空域名稱,空域類別名稱,空域顏色&returnGeometry=false&f=json
```

**Critical quirk:** the server sends *duplicate* `Access-Control-Allow-Origin`
headers, so browser `fetch()` fails. The page uses **JSONP** (`&callback=cb`,
script-tag injection). If you ever "fix" this to fetch, test in a real
browser first — curl will lie to you because it ignores CORS.

**If the server disappears** (URL 404s, layers renamed): re-discover it the
way it was found the first time:
1. `curl https://drone.caa.gov.tw/Content/inc-home/js/base.js` → find
   `showGISModel()` → iframe URL like
   `dronegis.caa.gov.tw/portal/apps/webappviewer/index.html?id=<APP_ID>`.
2. `curl {portal}/sharing/rest/content/items/<APP_ID>/data?f=json` → `.map.itemId`.
3. `curl {portal}/sharing/rest/content/items/<MAP_ID>/data?f=json` →
   `.operationalLayers[].url` — the new FeatureServer URLs.
4. Update `GIS_BASE` + layer paths in `index.html` and `build-airports.py`.

## 3. Routine maintenance

**Quarterly (or before relying on it for a trip):**

```bash
node test-parser.js                # parser regression: expect "all passed"
python3 build-airports.py          # refresh official airport polygons
git diff --stat                    # commit + push if changed
```

Then smoke-test the LIVE site with these canonical points (paste into the
input box; wait for the live result to replace the local one):

| Input | Expected live verdict |
|---|---|
| `25.0339, 121.5645` (Taipei 101) | 🔴 heliport red + 松山200呎 yellow listed |
| `24.15, 121.49` (Taroko) | 🔴 太魯閣國家公園 |
| `23.9, 121.15` (rural Nantou) | 🟢 green |
| `35.68, 139.77` (Tokyo) | ⚪ outside Taiwan |

If the card shows "Official CAA server unreachable" on all of them, the
server moved → §2 rediscovery.

**Yearly-ish:**
- `zones.js`: re-download the CAA KML and rebuild —
  `curl -L "https://www.caa.gov.tw/FileAtt.ashx?lang=1&id=5617" -o data/caa-rcr-total.kml && python3 build-zones.py`
  (KML was last updated 2018/08/31; check the page
  https://www.caa.gov.tw/Article.aspx?a=1293&lang=1 for newer ids).
- `parks.js`: parks revise boundaries in 通盤檢討 cycles. Needs GIS deps:
  `python3 -m venv .venv && .venv/bin/pip install pyshp pyproj shapely && .venv/bin/python build-parks.py`.
  The script already handles the known source-data landmines (Big5 DBFs,
  missing .prj → TWD97 TM2 fallback / EPSG:3825 for 金門・澎湖, a nested
  .rar needing bsdtar, polyline boundaries needing polygonize). New parks:
  add to `PICKS` in `build-parks.py` (index: `data/parks-index.csv`, refresh
  from data.gov.tw dataset 174421).
- Check whether data.gov.tw suggestion 136966 (machine-readable county
  zones) ever got fulfilled — if yes, the live check gains an offline peer.

**Rules that invalidate logic, not just data:** the 400 ft AGL default, the
200-ft airport belt semantics, and park bans come from 遙控無人機管理規則 and
國家公園法. If those change, update verdict *text* in `index.html`
(`localVerdict` / `renderOfficial`).

## 4. Accuracy claim (what to tell the user)

The live verdict reads the same database as the official CAA map, so it is
exactly as accurate as the government's own map — no public source is
better for Taiwan law. It is NOT better than: (a) the offline fallback,
which misses county zones and temporary airspace (the card says so
loudly); (b) DJI GEO for whether a DJI drone will physically arm — always
a separate check (the page links it per-coordinate).

## 5. Framework: adding a country/region

The Taiwan-specific parts are deliberately thin. To add region X:

**Step 1 — research the data source, in this priority order:**
1. **Live queryable API** (best): government drone maps are very often
   ArcGIS portals — apply the §2 discovery recipe to their map site. Also
   look for OGC WFS. Test CORS from a browser context; remember JSONP as
   fallback on classic ArcGIS servers.
2. **Downloadable GIS files** (good): SHP/KML/GeoJSON on open-data portals →
   write a `build-<region>.py` following `build-parks.py` patterns; bundle
   as a static layer.
3. **PDFs / none** (no-go): don't digitize by hand; ship link-outs to the
   official checker plus the gray "no data" verdict. Never fake a green.

**Step 2 — code changes in `index.html`:**
- Replace `inTaiwanArea()` with a region registry; keep the gray verdict
  for anywhere no region claims:

```js
var REGIONS = [
  { name: "Taiwan", contains: function(lat,lng){...},
    localLayers: [...],            // bundled FeatureCollections + styles
    liveCheck: officialCheckTW,    // or null if none
    links: [{label:"CAA map", url:...}, ...],
    rules: "Keep under 400 ft AGL..." },
  // { name: "Japan", contains: ..., liveCheck: officialCheckJP, ... }
];
```

- `renderVerdict` becomes: find region → region's local layers → region's
  live check → region's links/rules text. The parser, map, and UI need no
  changes (the parser is already worldwide).
- Per-region verdict mapping: define how source categories map to
  red/yellow/green *in that jurisdiction's terms* — don't reuse Taiwan's
  semantics (e.g. Japan's default ceiling is 150 m, not 400 ft; EU has
  Open-category subclasses).

**Step 3 — quality gate before shipping a region** (all must pass):
- ≥4 canonical test points with independently verified expected verdicts
  (one red near the main airport, one known ban area, one clean green, one
  cross-border gray) — add them to §3's table.
- Every verdict card links to that region's official checker.
- Stale-data plan: which build script refreshes it, on what cadence.
- The regional laws quoted in verdict text were checked against a current
  official source, not model memory.

**Candidate first additions:** Japan (国土交通省 DIPS 2.0 / 飛行禁止空域 —
government GIS layers exist), then EU states via their U-space/AMS maps.
DJI GEO stays the universal cross-check link for all regions.

## 6. Repo conventions

- Generated files (`zones.js`, `parks.js`, `airports.js`) are committed —
  the site is static; never hand-edit them, always via build scripts.
- `data/parks/` (downloaded zips) is gitignored cache; `data/*.kml`,
  `data/parks-index.csv` are committed sources.
- Test after any parser change: `node test-parser.js` (add cases for new
  formats). Preview locally: `python3 -m http.server 8642` (geolocation
  needs http, not file://).
- Commit style: what changed + why the data source made it necessary.
