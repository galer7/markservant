# Implementation Plan

## Overview

Build `msv` - a CLI tool to manage multiple markserv instances with persistence.

## Tech Stack

- **Runtime**: Node.js
- **Language**: JavaScript (ESM)
- **Dependencies**:
  - `commander` - CLI argument parsing
  - `chalk` - Terminal colors (optional)
  - No other runtime deps needed

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
│   └── index.js
├── specs/                  # Specification docs
├── package.json
├── README.md
└── .gitignore
```

## Implementation Steps

### Phase 1: Project Setup
1. Initialize package.json with ESM (`"type": "module"`)
2. Add bin entry pointing to `bin/msv.js`
3. Create .gitignore
4. Install dev dependencies

### Phase 2: Core Library
1. `src/lib/paths.js` - Path normalization utilities
2. `src/lib/config.js` - Config file CRUD operations
3. `src/lib/ports.js` - Port allocation (random in 9000-9999, check availability)
4. `src/lib/process.js` - Spawn/kill markserv processes
5. `src/lib/launchagent.js` - LaunchAgent plist management

### Phase 3: Commands
1. `msv add` - Add directory, allocate port, start server, open Edge
2. `msv list` - Display all servers with status
3. `msv rm` - Remove directory, stop server
4. `msv open` - Open URL in Edge
5. `msv start` - Start all servers in watch list
6. `msv stop` - Stop all running servers

### Phase 4: CLI Wiring
1. Create `bin/msv.js` with shebang
2. Wire up commander with all commands
3. Add help text and version

### Phase 5: Installation & Testing
1. Test local install with `npm link`
2. Verify commands work
3. Test LaunchAgent persistence (logout/login)
4. Create README with usage instructions

### Phase 6: Publish
1. Create GitHub repo (public)
2. Push code
3. `npm publish` (optional, can just use `npm install -g github:galer7/markservant`)

## Key Implementation Details

### Spawning markserv
```javascript
import { spawn } from 'child_process';

const child = spawn('markserv', [directory, '-p', port], {
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

## Testing Checklist

- [ ] `msv add` creates config, starts server, opens Edge
- [ ] `msv add` in same dir is idempotent (shows existing)
- [ ] `msv list` shows correct running/stopped status
- [ ] `msv rm` stops server and removes from config
- [ ] `msv stop` stops all but keeps config
- [ ] `msv start` restarts all from config
- [ ] `msv open` opens correct URL
- [ ] LaunchAgent installs on first add
- [ ] LaunchAgent removes on last rm
- [ ] Servers start on system login
- [ ] Ports persist across restarts
