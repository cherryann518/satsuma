# Satsuma

Photos, peeled by color. Pick a color and see which of your photos have it.

It runs entirely in the browser. Photos are read on your device and stay there.

## What it does

- **Search by color.** Tap a color, or two, and photos re-rank by how much of that color they have and how close it is.
- **See why.** Open a photo and the matching pixels stay in color while the rest drops to a 1-bit dither. Tolerance sliders update it live.
- **Pick from a photo.** Tap anywhere on a photo to search for that exact color.
- **Build sets.** Select photos, save matches as an album, export a zip or a single image.
- **Albums**, each with a stripe showing its overall colors. Light and dark looks.

## How matching works

1. **Import.** Each photo is scaled down to 900px (photo page and export), 256px (grid) and 128px (analysis). Capture time and GPS position are read from JPEG EXIF when present.
2. **Histogram.** The 128px pixels are converted to OKLab and bucketed by lightness, chroma and hue. Each bucket keeps its pixel count and mean color. This happens once per photo, so a search is a lookup.
3. **Match.** A bucket matches when it falls inside the tolerance box around the target color: hue, lightness and chroma each have their own tolerance. Near-grey pixels have no usable hue and never match a chromatic color.
4. **Per-color defaults.** Color names cover different ranges. Blue runs from navy to pale sky, while dark orange stops being orange and becomes brown, so each built-in color has its own tolerances.
5. **Coverage** is the share of the photo that matches: accent (1 to 3%), noticeable (3 to 10%), significant (10 to 30%), dominant (30%+).
6. **Score** = sqrt(min(1, coverage / 30%)) x closeness. Past "dominant", only closeness separates photos.
7. **Two colors.** A photo needs both. Its coverage is the smaller of the two.
8. **Lighting balance.** The brightest near-white pixels estimate a warm color cast, which is cancelled before matching, so a white plate under yellow light still counts as white. Cool casts are left alone so a pale sky is never treated as white.

## Limits

- Storage is IndexedDB in one browser on one device. No sync, no backup, and a browser can clear it.
- A web page only sees the photos you pick. It cannot read a whole camera roll.
- Originals are not kept, so exports are 900px copies.
- HEIC photos only work where the browser can decode them.
- Place names need `cities.json` (see `tools/build-cities.py`). Without it, locations show as coordinates.

## Credits

- Idea, design and direction: Cherryann Yang. Built with Claude.
- Fonts: Bitter and Source Sans 3 (SIL Open Font License), loaded from Google Fonts.
- Sample photos: see `samples/CREDITS.md`.
- City data: GeoNames, CC BY 4.0.

## License

MIT. See `LICENSE`.
