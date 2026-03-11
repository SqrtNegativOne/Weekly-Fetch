# Palette Redesign — Purple Dusk
**Date:** 2026-03-12
**Status:** Approved

## Summary

Replace the current warm-ember palette (dark navy + orange accent + cream text) with **Purple Dusk**: a near-black ground with a faint purple undertone, rich saturated violet accent, and cool lavender-white text. Also introduce two hover-reveal UI behaviors: the nav bar and the keyboard shortcut strip.

---

## Color Token Changes (`ui/digest.css`)

### Surfaces

| Token | Old (Ember) | New (Purple Dusk) |
|---|---|---|
| `--bg-deep` | `oklch(9.5% 0.012 55)` | `oklch(8.5% 0.020 285)` |
| `--bg-surface` | `oklch(10% 0.042 272 / 0.55)` | `oklch(10% 0.035 285 / 0.55)` |
| `--bg-titlebar` | `oklch(5.5% 0.038 275 / 0.97)` | `oklch(4.5% 0.030 285 / 0.97)` |
| `--bg-topbar` | `oklch(6.5% 0.039 275 / 0.65)` | `oklch(5.5% 0.032 285 / 0.65)` |
| `--bg-bottombar` | `oklch(6.5% 0.039 275 / 0.55)` | `oklch(5.5% 0.032 285 / 0.55)` |
| `--bg-sidebar` | `oklch(6.5% 0.039 275 / 0.72)` | `oklch(5.5% 0.032 285 / 0.72)` |
| `--bg-fetch-panel` | `oklch(6.5% 0.039 275 / 0.60)` | `oklch(5.5% 0.032 285 / 0.60)` |
| `--bg-select` | `oklch(13.5% 0.049 270)` | `oklch(13% 0.045 285)` |

`--bg-elevated`, `--bg-hover`, `--bg-muted` are neutral white-alpha — unchanged.

### Text

| Token | Old (warm cream) | New (cool lavender-white) |
|---|---|---|
| `--text-1` | `oklch(99% 0.014 88 / 0.92)` | `oklch(97% 0.012 285 / 0.93)` |
| `--text-2` | `oklch(99% 0.014 88 / 0.60)` | `oklch(97% 0.012 285 / 0.60)` |
| `--text-3` | `oklch(99% 0.014 88 / 0.38)` | `oklch(97% 0.012 285 / 0.38)` |
| `--text-4` | `oklch(99% 0.014 88 / 0.18)` | `oklch(97% 0.012 285 / 0.18)` |
| `--text-body` | `oklch(99% 0.014 88 / 0.82)` | `oklch(97% 0.012 285 / 0.82)` |

### Accent

| Token | Old (warm ember) | New (rich violet) |
|---|---|---|
| `--accent` | `oklch(59% 0.145 47)` | `oklch(62% 0.210 285)` |
| `--accent-light` | `oklch(70% 0.124 50)` | `oklch(74% 0.170 285)` |
| `--accent-surface` | `oklch(59% 0.145 47 / 0.14)` | `oklch(62% 0.210 285 / 0.14)` |
| `--accent-border` | `oklch(59% 0.145 47 / 0.28)` | `oklch(62% 0.210 285 / 0.28)` |
| `--accent-glow` | `oklch(59% 0.145 47 / 0.18)` | `oklch(62% 0.210 285 / 0.18)` |
| `--accent-selection` | `oklch(59% 0.145 47 / 0.35)` | `oklch(62% 0.210 285 / 0.35)` |
| `--accent-blockquote` | `oklch(59% 0.145 47 / 0.45)` | `oklch(62% 0.210 285 / 0.45)` |

### Blob backgrounds

| Token | Old | New |
|---|---|---|
| `--blob-1` | `oklch(20% 0.046 50)` | `oklch(18% 0.045 285)` |
| `--blob-2` | `oklch(12% 0.028 50)` | `oklch(11% 0.028 285)` |
| `--blob-3` | `oklch(32% 0.073 45)` | `oklch(28% 0.070 285)` |

### Unchanged tokens

- **Platform colors** (`--reddit`, `--bluesky`, `--tumblr`, `--instagram`, `--mastodon`, `--twitter`) — brand identity, do not change.
- **Platform badge text** variants — unchanged.
- **Status colors** (`--success-*`, `--error-*`, `--warning-*`) — universal semantics, unchanged.
- **Border tokens** (`--border`, `--border-light`, `--border-subtle`) — neutral white-alpha, unchanged.
- **Scrollbar**, **shadow**, **tab**, **radius**, **typography**, **motion** tokens — unchanged.

---

## UI Behavior Changes (`ui/digest.css` only)

### 1. Left nav (`#app-nav`) — already hover-revealing, no change needed

`#app-nav` already collapses to 54px (icons only) and expands to 220px with labels on `:hover`. This is the correct behavior. No change required.

### 2. Keyboard shortcut strip (`#bottombar`) — hide by default, reveal on hover

`#bottombar` already exists inside `#viewer-app` and already contains all shortcut hints. Currently it is always visible. Change it to be hidden by default and revealed when the user hovers over `#app-body`.

```css
/* Hide by default */
#bottombar {
  max-height: 0;
  overflow: hidden;
  padding-top: 0;
  padding-bottom: 0;
  border-top-color: transparent;
  transition: max-height 0.18s var(--ease), padding 0.18s var(--ease), border-color 0.18s;
}

/* Reveal on hover */
#app-body:hover #bottombar {
  max-height: 40px;
  padding-top: 6px;
  padding-bottom: 6px;
  border-top-color: var(--border);
}
```

`max-height` is used instead of `height` because the element's natural height is set by content — transitioning to a fixed `height` would clip or leave gaps if content wraps.

---

## Files to change

| File | Change |
|---|---|
| `ui/digest.css` | Update all color token values listed above |
| `ui/digest.css` | Add `#bottombar` hover-reveal rules |

No HTML changes. No Python, no API changes, no database changes.
