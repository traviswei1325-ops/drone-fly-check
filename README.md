# Drone Fly Check 🛸

Can-I-fly-here checker for drones in Taiwan. Paste a Google Maps link, GPS
coordinates (decimal / DMS / degree-minutes), or tap the map — get a clean
lat/lng plus a 🔴/🟡/🟢 verdict against CAA restricted airspace and airport
proximity, with one-click confirmation links to the official CAA drone map
and DJI GEO zone query.

**Pure static site** — no build step, no backend. Open `index.html` via any
web server (geolocation requires http/https, not `file://`).

## Files

| File | Purpose |
|---|---|
| `index.html` | The app: input, Leaflet map, verdict card |
| `parser.js` | Coordinate parser (Maps URLs, decimal, DMS, DDM) |
| `zones.js` | Generated CAA zone data — do not edit by hand |
| `parks.js` | Generated national-park boundaries — do not edit by hand |
| `build-zones.py` | Regenerates `zones.js` from the CAA KML (stdlib only) |
| `build-parks.py` | Regenerates `parks.js` from 國家公園署 open data (needs pyshp/pyproj/shapely, see its docstring) |
| `data/caa-rcr-total.kml` | Source: CAA「(總)限航區範圍」(Article a=1293) |
| `data/parks-index.csv` | Source index: data.gov.tw dataset 174421 |
| `test-parser.js` | Parser tests: `node test-parser.js` |

## Updating zone data

Re-download the KML if the CAA publishes a new version, then:

```
curl -L "https://www.caa.gov.tw/FileAtt.ashx?lang=1&id=5617" -o data/caa-rcr-total.kml
python3 build-zones.py
```

## Deploying to GitHub Pages

1. Create a **public** repo, push these files to `main`.
2. Repo → Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Site appears at `https://<user>.github.io/<repo>/`.

## Limitations — read before relying on it

- Airport circles (5 km red / 10 km yellow) are **approximations**; the law
  defines a specific polygon per airport.
- **Not** included: county/city announced zones (published only as PDFs),
  temporary NOTAMs.
- CAA source KML last updated 2018/08/31. Park boundaries are the latest
  通盤檢討 layers published per park (vintages vary).
- Outside Taiwan the tool gives no verdict (neutral gray), by design.
- Always confirm on the official map: https://drone.caa.gov.tw/
