# /public

Static assets served at the site root.

## Expected files (placeholders)

- `og.png` — 1200×630 Open Graph / Twitter card image. Referenced by
  `src/app/layout.tsx` and by the social-card tags. Drop the real PNG here
  when the brand image is ready; the metadata block already points at it.
- `favicon.ico` — browser tab icon. Optional; if absent, Next.js falls back
  to its default favicon.

These files are intentionally not committed as binaries. Add them when the
final assets exist.
