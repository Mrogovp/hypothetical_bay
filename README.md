# Hypothetical Bay

A single-page web app that displays the *Hypothetical Bay* training chart and
lets you click points to read off real lat/lon coordinates and measure bearings
and distances between them.

## Use

- **Click** the chart to drop a coordinate mark labelled `DD°MM.MM' S/E`.
- Each **pair of clicks** defines one measurement: the first drops an anchor
  and rubber-bands a dashed preview line to the cursor; the second locks it
  as a solid segment, with true bearing (looking back from the second point
  to the first) and great-circle distance in nautical miles. Subsequent
  clicks start a fresh pair, so prior measurements persist on the chart.
- **Drag** to pan, **scroll** (or pinch) to zoom — both desktop mouse and
  mobile touch are supported.
- **Undo / Clear / Fit** in the toolbar.

## Running locally

It's a static site, but the browser needs an HTTP origin (not `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Hosting

Pure static — `index.html`, `app.js`, `styles.css`, `map.png` and nothing
else at runtime. Drop the repo on GitHub Pages, Cloudflare Pages, Netlify,
S3+CloudFront, etc., with no build step.

## How the calibration works

`map.png` is a 300 DPI render of an A4 chart. The pixel→lat/lon transform is a
linear fit to the chart's labelled major tick marks (latitudes 23°50'S–24°10'S
on the left edge, longitudes 161°55'E–162°05'E on the top edge), expressed in
PDF-point units so the constants are independent of the image's render
resolution. Distance uses the haversine formula on Earth's mean radius
(3440.065 NM).
