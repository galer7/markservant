# Implementation Plan

## Overview

Build `msv` - a CLI tool to manage multiple markserv instances with persistence.

## Tech Stack

- **Runtime**: Node.js
- **Language**: JavaScript (ESM)
- **Dependencies**:
  - `commander` - CLI argument parsing
  - `chalk` - Terminal colors
- **Dev Dependencies**:
  - `vitest` - Testing framework

## Project Structure

```
markservant/
├── bin/
│   └── msv.js          # CLI entry point (shebang)
├── src/
│   ├── commands/
│   │   ├── add.js
│   │   ├── rm.js
│   │   ├── list.js
│   │   ├── open.js
│   │   ├── start.js
│   │   └── stop.js
│   ├── lib/
│   │   ├── config.js       # Read/write config.json
│   │   ├── ports.js        # Port allocation logic
│   │   ├── process.js      # Start/stop markserv processes
│   │   ├── launchagent.js  # Install/remove LaunchAgent
│   │   └── paths.js        # Path normalization
├── specs/                  # Specification docs
├── package.json
├── README.md
└── .gitignore
```

## Implementation Status

### Phase 1: Project Setup ✅ COMPLETED
- [x] Initialize package.json with ESM (`"type": "module"`)
- [x] Add bin entry pointing to `bin/msv.js`
- [x] Create .gitignore
- [x] Install dev dependencies

### Phase 2: Core Library ✅ COMPLETED
- [x] `src/lib/paths.js` - Path normalization utilities
- [x] `src/lib/config.js` - Config file CRUD operations
- [x] `src/lib/ports.js` - Port allocation (random in 9000-9999, check availability)
- [x] `src/lib/process.js` - Spawn/kill markserv processes
- [x] `src/lib/launchagent.js` - LaunchAgent plist management

### Phase 3: Commands ✅ COMPLETED
- [x] `msv add` - Add directory, allocate port, start server, open Edge
- [x] `msv list` - Display all servers with status
- [x] `msv rm` - Remove directory, stop server
- [x] `msv rm --all` - Remove all servers from watch list
- [x] `msv open` - Open URL in Edge
- [x] `msv start` - Start all servers in watch list
- [x] `msv stop` - Stop all running servers

### Phase 4: CLI Wiring ✅ COMPLETED
- [x] Create `bin/msv.js` with shebang
- [x] Wire up commander with all commands
- [x] Add help text and version

### Phase 5: Testing ✅ COMPLETED
- [x] Unit tests for paths.js (20 tests)
- [x] Unit tests for config.js (34 tests)
- [x] Unit tests for ports.js (9 tests)
- [x] Unit tests for process.js (18 tests)
- [x] Unit tests for rm command (13 tests)
- [x] All 94 tests passing

### Phase 6: Installation & Manual Testing ✅ COMPLETED
- [x] Test local install with `npm link`
- [x] Verify commands work end-to-end
- [x] Test LaunchAgent persistence (logout/login)

**Bug Fixes During Testing:**
- Fixed `allocatePort()` to be async (was calling async `loadConfig()` synchronously)
- Fixed `startServer()` to set `cwd: '/'` to prevent markserv from interpreting absolute paths as relative

### Phase 7: Publish
- [ ] Push code to GitHub
- [ ] `npm publish` (optional, can just use `npm install -g github:galer7/markservant`)

## Key Implementation Details

### Spawning markserv
```javascript
import { spawn } from 'child_process';

const child = spawn('markserv', [directory, '-p', port], {
  cwd: '/',           // Ensures absolute paths are not treated as relative
  detached: true,
  stdio: 'ignore'
});
child.unref();
```

### Checking port availability
```javascript
import { execSync } from 'child_process';

function isPortFree(port) {
  try {
    execSync(`lsof -i :${port}`, { stdio: 'ignore' });
    return false; // port in use
  } catch {
    return true; // port free
  }
}
```

### Opening in Edge
```javascript
import { exec } from 'child_process';

exec(`open -a "Microsoft Edge" http://localhost:${port}`);
```

## Testing Checklist ✅ VERIFIED

- [x] `msv add` creates config, starts server, opens Edge
- [x] `msv add` in same dir is idempotent (shows existing)
- [x] `msv list` shows correct running/stopped status
- [x] `msv rm` stops server and removes from config
- [x] `msv rm --all` removes all servers and uninstalls LaunchAgent
- [x] `msv stop` stops all but keeps config
- [x] `msv start` restarts all from config
- [x] `msv open` opens correct URL
- [x] LaunchAgent installs on first add
- [x] LaunchAgent removes on last rm
- [x] Ports persist across restarts
- [ ] Servers start on system login (requires logout/login to verify)
