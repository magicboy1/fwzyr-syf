# Rebranding for a new event

Branding is centralized. A new event is a small, contained change. Recommended
flow: branch off `main` (`git checkout -b event-<name>`), edit the files below,
then `npm run build`.

## 1. Text + logo — `client/src/brand.ts`

Edit the `BRAND` object:

| Field | What it controls |
|-------|------------------|
| `name` | App name (headers, browser tab title) |
| `eventName` | Event name (image alt text / secondary label) |
| `tagline` | Home-page subtitle + meta description |
| `logo` | The logo image — change the `import` at the top of the file to point at a new file in `attached_assets/` |
| `colors.*` | Hex values used by the few canvas/Framer/SVG spots (confetti, timer bar, progress ring). **Must match the HSL variables in step 2.** |

## 2. Colors — `client/src/index.css` (`:root`)

Edit the `--brand-*` variables at the top of `:root`. They are **HSL channels**
(`H S% L%`), not hex. The whole UI (every `text-gold` / `bg-gold` / `border-gold`
class and the gold-shimmer gradient) is driven by these.

```css
--brand-gold: 38 40% 67%;         /* main accent */
--brand-gold-light: 42 58% 78%;
--brand-gold-dark: 38 28% 52%;
--brand-gold-accent: 36 60% 58%;
--brand-bg: 227 20% 14%;          /* page background */
```

Keep `colors.*` in `brand.ts` in sync with these (same colors, hex form). Tip:
pick your hex colors first, convert each to HSL, put HSL here and hex in
`brand.ts`.

> The dark theme tokens (`--background`, `--primary`, etc.) further down `:root`
> were the original palette; `--primary` equals `--brand-gold`. If you change the
> overall theme drastically, update those too.

## 3. Favicon + static HTML — `client/index.html` + `client/public/favicon.png`

- Replace `client/public/favicon.png` with the new icon.
- `index.html` has a static `<title>` and `<meta>` description shown before the
  app loads. The live title is set from `BRAND.name` at runtime, but update the
  static fallback here too for the initial flash and link previews.

## 4. Verify

```bash
npm run build      # must succeed
npm run dev        # eyeball the home / display / player screens
```

That's it — everything else (game logic, scoring, sockets) is brand-agnostic.
