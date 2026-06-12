# Flagella Evolution Database

This is a Next.js static website project for building the Flagella Evolution Database page by page.

## Analytics

Google Analytics is loaded when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set during
the build. GitHub Pages production builds set it to `G-B1CPJ2P2PJ` in
`.github/workflows/nextjs.yml`.

For local testing, run:

```bash
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-B1CPJ2P2PJ npm run build
```

Leave the variable unset for local builds or preview environments where tracking
should be disabled.

## Project structure

- `src/app`: routes and pages (homepage and future pages)
- `src/components`: reusable UI components (navbar, cards, tables, etc.)
- `src/data`: static datasets (JSON/CSV/TS data files)
- `src/lib`: utility/helper functions
- `src/types`: TypeScript type definitions
- `src/styles`: optional extra style files
- `public`: static files served directly (images, icons, downloadable files)
- `scripts`: custom scripts for data preparation or conversion

## How to add folders/files

You can create folders manually in the Explorer panel at any time. Typical additions:

- `src/app/taxonomy/page.tsx` for a Taxonomy page
- `src/components/NavBar.tsx` for reusable navbar code
- `src/data/species.json` for static species data
- `public/images/logo.png` for logos or figures
