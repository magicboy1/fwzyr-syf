// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH FOR BRANDING.
// To rebrand for a new event, change the values here (+ the logo file imported
// below, + the color variables in client/src/index.css :root, + the <title>/
// meta in client/index.html + the favicon). See REBRAND.md.
// ---------------------------------------------------------------------------
import logo from "@assets/aljeel-logo-white.svg";

export const BRAND = {
  /** App name shown in headers and the browser title. */
  name: "aljeel",
  /** Event name (used as image alt text / secondary label). */
  eventName: "Aljeel Core Values Launch",
  /** Tagline / description shown on the home page and meta tags. */
  tagline: "Core Values Launch — Empowering Healthcare",
  /** Logo image (swap the import above to change it). */
  logo,

  // Hex colors for the few places that need a concrete value (Framer Motion
  // animations and inline styles). These MUST match the HSL `--brand-*`
  // variables in client/src/index.css :root. Tailwind classes use those vars
  // via the `gold` / `gold-light` / etc. theme colors instead of these.
  // aljeel palette: Denim #006EB3, Pimento coral #DE5E4C.
  colors: {
    gold: "#1593E6",       // primary accent (screen-bright Denim)
    goldLight: "#5DB0EE",  // light blue tint
    goldDark: "#005A93",   // deep Denim
    goldAccent: "#DE5E4C", // Pimento coral
    bg: "#13182A",         // deep navy
  },
} as const;
