# Dotfiles Support Implementation Plan

## Status: Complete

All phases implemented and tested.

## Overview

Add a `--dotfiles` CLI flag to markserv to optionally show hidden files in directory listings, then update markservant to support this option.

## Prerequisites

- Node.js 18+
- npm
- markserv source code understanding
- Existing markserv fork (if created for mermaid support)

## Implementation Phases

### Phase 1: Fork and Prepare markserv

**Status**: Complete

**Goal**: Create a local fork of markserv we can modify.

#### Tasks

1. [x] Clone markserv repository (or use existing fork)
   ```bash
   git clone https://github.com/galer7/markserv.git ~/p/markserv-fork
   cd ~/p/markserv-fork
   ```

2. [x] Verify local markserv runs
   ```bash
   npm install
   npm link  # Makes it available as 'markserv' globally
   markserv --help
   ```

3. [x] Identify files to modify:
   - **CLI**: `lib/cli-defs.js` - Add `--dotfiles` option
   - **Help**: `lib/cli-help.txt` - Document the option
   - **Server**: `lib/server.js` - Modify `dirToHtml()` function

---

### Phase 2: Add --dotfiles CLI Option

**Status**: Complete

**Goal**: Add the CLI flag and wire it through to the server.

#### Tasks

1. [x] Open `lib/cli-defs.js` and add the option:
   ```javascript
   dotfiles: {
     alias: 'd',
     default: 'ignore'
   }
   ```

2. [x] Update `lib/cli-help.txt` to document the flag:
   ```
   --dotfiles, -d  Show dotfiles in directory listings [allow/ignore] (ignore)
   ```

3. [x] Verify the flag is parsed correctly:
   ```bash
   markserv --help  # Shows --dotfiles option
   ```

---

### Phase 3: Modify Directory Listing Logic

**Status**: Complete

**Goal**: Make `dirToHtml()` respect the `--dotfiles` flag.

#### Implementation

Modified `dirToHtml()` in `lib/server.js`:
- Added `flags` parameter with default value `{}`
- Changed dotfile check to be conditional: `if (flags.dotfiles !== 'allow' && subPath.charAt(0) === '.')`
- Updated call site to pass flags: `dirToHtml(filePath, flags)`

#### Tasks

1. [x] Locate `dirToHtml()` function in `lib/server.js` (around line 214)

2. [x] Add `flags` parameter to `dirToHtml()` function

3. [x] Modify the dotfile check to be conditional:
   ```javascript
   if (flags.dotfiles !== 'allow' && subPath.charAt(0) === '.') {
       return
   }
   ```

4. [x] Update caller to pass flags parameter

---

### Phase 4: Test Dotfiles Behavior

**Status**: Complete

**Goal**: Verify all scenarios work correctly.

#### Test Cases

1. [x] **Default behavior (no flag)**
   - Dotfiles hidden (backward compatible)

2. [x] **Explicit ignore**
   ```bash
   markserv --dotfiles ignore ~/test-dir
   ```
   - Dotfiles hidden

3. [x] **Allow dotfiles**
   ```bash
   markserv --dotfiles allow ~/test-dir
   ```
   - Dotfiles visible in listing

---

### Phase 5: Update markservant

**Status**: Complete

**Goal**: Add `--dotfiles` support to markservant CLI and pass it to markserv.

#### Tasks

1. [x] Add option to `msv add` command (`bin/msv.js`):
   ```javascript
   .option('--dotfiles', 'Show dotfiles in directory listings')
   ```

2. [x] Update `addCommand` to accept options (`src/commands/add.js`):
   ```javascript
   export default async function addCommand(directory, options = {})
   ```

3. [x] Store dotfiles preference in config (`src/lib/config.js`):
   - Updated `ServerEntry` typedef to include `dotfiles` property
   - Modified `addServer()` to accept options and store dotfiles

4. [x] Update `startServer()` in `src/lib/process.js`:
   ```javascript
   export function startServer(directory, port, options = {}) {
     const args = [...];
     if (options.dotfiles) {
       args.push('--dotfiles', 'allow');
     }
     // ...
   }
   ```

5. [x] Update callers of `startServer()`:
   - `src/commands/add.js` - passes `{ dotfiles: options.dotfiles }`
   - `src/commands/start.js` - passes `{ dotfiles: server.dotfiles }`

6. [x] Add tests for new functionality:
   - `src/commands/add.test.js` - 3 new tests for dotfiles option
   - `src/commands/start.test.js` - 3 new tests for dotfiles from config
   - `src/lib/process.test.js` - 3 new tests for dotfiles flag in spawn args
   - `src/lib/config.test.js` - 3 new tests for storing dotfiles option

---

### Phase 6: Integration with markserv Fork

**Status**: Complete

**Goal**: Make markservant use the forked markserv.

The existing fork at `galer7/markserv` now includes both Mermaid and dotfiles support.

#### Changes pushed to fork:
- Commit: `b6d4051` - Add --dotfiles option to show hidden files in directory listings

---

### Phase 7: Documentation

**Status**: Pending (optional)

**Goal**: Update README and docs.

#### Tasks

1. [ ] Update markservant README:
   - Document `--dotfiles` flag on `msv add`
   - Add usage examples

2. [ ] Update markserv fork README:
   - Document `--dotfiles` CLI option
   - Note this is a fork with additional features

---

## File Changes Summary

### markserv-fork (galer7/markserv)

| File | Change |
|------|--------|
| `lib/cli-defs.js` | Added `dotfiles` option with alias 'd' and default 'ignore' |
| `lib/cli-help.txt` | Added documentation for --dotfiles flag |
| `lib/server.js` | Modified `dirToHtml()` to accept flags and respect dotfiles setting |

### markservant (this repo)

| File | Change |
|------|--------|
| `bin/msv.js` | Added `--dotfiles` option to `add` command |
| `src/commands/add.js` | Accept options parameter, pass to addServer and startServer |
| `src/commands/start.js` | Pass dotfiles option from config to startServer |
| `src/lib/config.js` | Updated typedef, addServer accepts options |
| `src/lib/process.js` | startServer accepts options, adds --dotfiles flag when enabled |
| `src/commands/add.test.js` | Added 3 tests for dotfiles option |
| `src/commands/start.test.js` | Added 3 tests for dotfiles from config |
| `src/lib/process.test.js` | Added 3 tests for dotfiles flag + fixed existing tests |
| `src/lib/config.test.js` | Added 3 tests for storing dotfiles |

---

## Success Criteria

- [x] `markserv --dotfiles allow` shows dotfiles in browser
- [x] `msv add --dotfiles ~/project` enables dotfiles for that server
- [x] Default behavior unchanged (dotfiles hidden)
- [x] Existing markservant functionality works
- [x] All tests pass (213 tests)
- [ ] Documentation updated (optional)
