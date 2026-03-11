# Purple Dusk Palette Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the warm-ember color palette with Purple Dusk (near-black purple ground + rich violet accent + cool lavender-white text) and hide the keyboard shortcut bar until hover.

**Architecture:** All changes are confined to `ui/digest.css`. Token values are updated in `:root`; two hardcoded gradient values in `#app-nav` are updated inline; `#bottombar` gets a `max-height` collapse/expand transition driven by `#app-body:hover`.

**Tech Stack:** CSS (oklch color space, custom properties, max-height transition)

---

## Chunk 1: Color token + gradient updates

### Task 1: Update surface tokens

**Files:**
- Modify: `ui/digest.css:7-19`

- [ ] **Step 1: Replace surface tokens**

  Open `ui/digest.css`. Find the `/* Surfaces */` block (lines 7–12) and the `/* Overlay backgrounds (dark navy tints, all same hue family) */` block (lines 14–20). Make these exact replacements:

  ```css
  /* Surfaces */
  --bg-deep:     oklch(8.5% 0.020 285);
  --bg-surface:  oklch(10% 0.035 285 / 0.55);
  --bg-elevated: oklch(100% 0 0 / 0.06);
  --bg-hover:    oklch(100% 0 0 / 0.09);
  --bg-muted:    oklch(100% 0 0 / 0.04);

  /* Overlay backgrounds (cool purple tints, all same hue family) */
  --bg-titlebar:    oklch(4.5% 0.030 285 / 0.97);
  --bg-topbar:      oklch(5.5% 0.032 285 / 0.65);
  --bg-bottombar:   oklch(5.5% 0.032 285 / 0.55);
  --bg-sidebar:     oklch(5.5% 0.032 285 / 0.72);
  --bg-fetch-panel: oklch(5.5% 0.032 285 / 0.60);
  --bg-select:      oklch(13% 0.045 285);
  ```

  `--bg-elevated`, `--bg-hover`, `--bg-muted` are neutral white-alpha — leave them unchanged.

- [ ] **Step 2: Verify visually**

  Run: `python app.py`
  Expected: App background is visibly dark purple-black (not the old warm dark brown).
  Close the app.

### Task 2: Update text tokens

**Files:**
- Modify: `ui/digest.css:22-27`

- [ ] **Step 1: Replace text tokens**

  Find the `/* Text — 4 levels + body (warm cream tint) */` block (lines 22–27). Replace with:

  ```css
  /* Text — 4 levels + body (cool lavender-white) */
  --text-1:    oklch(97% 0.012 285 / 0.93);
  --text-2:    oklch(97% 0.012 285 / 0.60);
  --text-3:    oklch(97% 0.012 285 / 0.38);
  --text-4:    oklch(97% 0.012 285 / 0.18);
  --text-body: oklch(97% 0.012 285 / 0.82);
  ```

- [ ] **Step 2: Verify visually**

  Run: `python app.py`
  Expected: Card text has a cool, slightly lavender-tinted white tone rather than warm cream.
  Close the app.

### Task 3: Update accent tokens

**Files:**
- Modify: `ui/digest.css:29-36`

- [ ] **Step 1: Replace accent tokens**

  Find the `/* Accent — warm ember */` block (lines 29–36). Replace with:

  ```css
  /* Accent — rich violet */
  --accent:            oklch(62% 0.210 285);
  --accent-light:      oklch(74% 0.170 285);
  --accent-surface:    oklch(62% 0.210 285 / 0.14);
  --accent-border:     oklch(62% 0.210 285 / 0.28);
  --accent-glow:       oklch(62% 0.210 285 / 0.18);
  --accent-selection:  oklch(62% 0.210 285 / 0.35);
  --accent-blockquote: oklch(62% 0.210 285 / 0.45);
  ```

- [ ] **Step 2: Verify visually**

  Run: `python app.py`
  Expected: Active nav item, note/todo textareas, and any highlighted text show a saturated violet rather than orange.
  Close the app.

### Task 4: Update blob background tokens

**Files:**
- Modify: `ui/digest.css:72-75`

- [ ] **Step 1: Replace blob tokens**

  Find the `/* Blob backgrounds (warm amber family) */` block (lines 72–75). Replace with:

  ```css
  /* Blob backgrounds (cool purple family) */
  --blob-1: oklch(18% 0.045 285);
  --blob-2: oklch(11% 0.028 285);
  --blob-3: oklch(28% 0.070 285);
  ```

- [ ] **Step 2: Verify visually**

  Run: `python app.py` and navigate to the Home view with pending artifacts.
  Expected: Background blobs are dark purple-tinted shapes, not amber/brown.
  Close the app.

### Task 5: Update hardcoded nav gradient values

**Files:**
- Modify: `ui/digest.css:243`
- Modify: `ui/digest.css:295`

These two lines use hardcoded `oklch` values with hue 278 that bypass the token system. They are inside the `#app-nav` rule block.

- [ ] **Step 1: Update `#app-nav` linear gradient (line ~243)**

  Find this line:
  ```css
  background: linear-gradient(180deg, oklch(7.2% 0.042 278 / 0.95) 0%, oklch(5.9% 0.038 278 / 0.98) 100%);
  ```
  Replace with:
  ```css
  background: linear-gradient(180deg, oklch(7.2% 0.038 285 / 0.95) 0%, oklch(5.9% 0.034 285 / 0.98) 100%);
  ```

- [ ] **Step 2: Update radial gradient (line ~295)**

  Find this line:
  ```css
  background: radial-gradient(ellipse at 50% 0%, oklch(17% 0.06 278 / 0.12) 0%, transparent 70%);
  ```
  Replace with:
  ```css
  background: radial-gradient(ellipse at 50% 0%, oklch(17% 0.06 285 / 0.12) 0%, transparent 70%);
  ```

- [ ] **Step 3: Verify visually**

  Run: `python app.py`
  Expected: The left nav sidebar has a dark purple gradient background, consistent with the rest of the palette.
  Close the app.

- [ ] **Step 4: Commit Chunk 1**

  ```bash
  git add ui/digest.css
  git commit -m "style: apply Purple Dusk palette tokens"
  ```

---

## Chunk 2: Bottombar hover-reveal

### Task 6: Hide `#bottombar` by default, reveal on hover

**Files:**
- Modify: `ui/digest.css:960-969` (`#bottombar` rule block)

The `#bottombar` element is a direct child of `#viewer-app`, which is itself nested inside `#app-body` (`#app-body > #app-main > #view-home > #viewer-container > #viewer-app > #bottombar`). The CSS descendant selector `#app-body:hover #bottombar` is therefore valid — hovering anywhere in the app (card area, sidebar, nav) triggers the reveal.

`max-height` is used instead of `height` because `height: auto` cannot be transitioned in CSS. We set a generous `max-height` cap (40px) that fits one line of keyboard hints at the current font size.

- [ ] **Step 1: Update `#bottombar` rule**

  Find the `#bottombar` block (around line 960):
  ```css
  #bottombar {
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    gap: 20px;
    padding: 6px 16px;
    background: var(--bg-bottombar);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid var(--border);
    user-select: none; -webkit-user-select: none;
  }
  ```

  Replace with:
  ```css
  #bottombar {
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    gap: 20px;
    padding: 0 16px;
    max-height: 0;
    overflow: hidden;
    background: var(--bg-bottombar);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid transparent;
    user-select: none; -webkit-user-select: none;
    transition: max-height 0.18s var(--ease), padding 0.18s var(--ease), border-color 0.18s;
  }
  #app-body:hover #bottombar {
    max-height: 40px;
    padding: 6px 16px;
    border-top-color: var(--border);
  }
  ```

  Note: `padding` is set to `0 16px` (zero vertical) by default so the collapsed bar takes no space, and transitions to `6px 16px` on reveal.

- [ ] **Step 2: Verify hidden state — Home with pending artifacts**

  Run: `python app.py` and navigate to the Home view (requires at least one pending artifact so `#viewer-app` is shown).
  Expected: The keyboard hint bar at the bottom of the viewer is **not visible** at rest.

- [ ] **Step 3: Verify revealed state**

  Move the mouse over the app window (anywhere — card, sidebar, nav).
  Expected: The keyboard hint bar smoothly slides up from the bottom edge, showing `h/l  j/k  c  Ctrl+N  Enter  Ctrl+Z` hints. Also check the blur on the bar still renders (the `backdrop-filter` and `overflow: hidden` combination can sometimes cancel blur in WebView2 — if the blur is gone, remove the `backdrop-filter` line from the `#bottombar` rule).

- [ ] **Step 4: Verify hidden in all other states**

  a. Navigate to the Archive, Sources, and Settings pages.
     Expected: No bottombar visible (it only exists inside `#viewer-app`).

  b. Return to Home view with **no** pending artifacts (empty state).
     Expected: No bottombar visible — `#viewer-app` is hidden via `display:none`, so the `max-height` collapse is moot but the bar must still not appear.

  Close the app.

- [ ] **Step 5: Commit Chunk 2**

  ```bash
  git add ui/digest.css
  git commit -m "style: hide bottombar by default, reveal on hover"
  ```

---

## Done

Both commits produce a fully working build. No Python changes, no DB changes, no API changes.
