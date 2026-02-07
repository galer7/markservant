# Dotfiles Support Specification

## Overview

Add the ability to show dot files (hidden files) in markserv directory listings, controlled by a CLI flag.

## Problem Statement

Currently, when browsing a directory served by markserv, files and folders starting with `.` are hidden from the directory listing:

```
my-project/
  .gitignore      <-- NOT visible in listing
  .env            <-- NOT visible in listing
  README.md       <-- visible
  src/            <-- visible
```

Users cannot see or navigate to dotfiles through the web interface, even though direct URL access works (e.g., `http://localhost:9000/.gitignore`).

## Architecture Context

```
┌─────────────────┐     spawns      ┌─────────────┐
│  markservant    │ ───────────────▶│  markserv   │
│  (process mgr)  │                 │  (renderer) │
└─────────────────┘                 └─────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ dirToHtml() │
                                    │  filters .* │
                                    └─────────────┘
```

**Key insight**: The filtering happens in markserv's `lib/server.js` in the `dirToHtml()` function (lines 228-231):

```javascript
urls.forEach(subPath => {
    if (subPath.charAt(0) === '.') {
        return  // <-- Skips dotfiles
    }
```

## Solution: Add --dotfiles CLI Flag to markserv

Fork markserv and add a `--dotfiles` CLI option that controls whether dotfiles appear in directory listings.

### Why Fork?

1. **No existing option** - markserv has no configuration for this behavior
2. **Hardcoded filtering** - The dotfile exclusion is baked into the source
3. **Consistent with mermaid approach** - We already plan to fork for Mermaid support

## Functional Requirements

### FR-1: New --dotfiles CLI Flag

- Add `--dotfiles <mode>` option to markserv CLI
- Modes:
  - `ignore` (default) - Hide dotfiles from listings (current behavior)
  - `allow` - Show dotfiles in listings

### FR-2: Directory Listings Respect Flag

- When `--dotfiles allow`, files starting with `.` appear in directory listings
- When `--dotfiles ignore`, current behavior is preserved

### FR-3: Direct Access Unaffected

- Direct URL access to dotfiles continues to work regardless of flag
- This already works via `send(req, filePath, {dotfiles: 'allow'})`

## Non-Functional Requirements

### NFR-1: Backward Compatibility

- Default behavior (`ignore`) matches current markserv behavior
- Existing users see no change unless they opt in

### NFR-2: Security Consideration

- Showing dotfiles is opt-in to avoid accidentally exposing `.env`, `.git`, etc.

## Technical Approach

1. Fork `markserv` (or extend existing mermaid fork)
2. Add `--dotfiles` CLI option in `bin/markserv.js`
3. Pass flag through to `dirToHtml()` function
4. Conditionally skip the `charAt(0) === '.'` check
5. Update markservant to pass `--dotfiles allow` when spawning

## Acceptance Criteria

- [ ] `markserv --dotfiles allow .` shows dotfiles in directory listing
- [ ] `markserv --dotfiles ignore .` hides dotfiles (default)
- [ ] `markserv .` (no flag) hides dotfiles (backward compatible)
- [ ] Direct URL access to dotfiles works in all modes
- [ ] markservant can pass through the `--dotfiles` flag

## Out of Scope

- Glob patterns for selective dotfile display (e.g., show `.md` but hide `.env`)
- Per-directory configuration
- `.msvignore` or similar exclusion files
