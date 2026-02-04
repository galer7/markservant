# Installation Specification

## Requirements

- Node.js (for running the CLI)
- markserv (npm package, global install)
- macOS (for LaunchAgent support)

## Installation Method

npm global install for system-wide access.

## Install Command

```bash
npm install -g markservant
```

## Binary Location

After global install, `msv` available at:
- `/usr/local/bin/msv` (Intel Mac)
- `/opt/homebrew/bin/msv` (Apple Silicon with Homebrew Node)
- Or wherever npm global bin is configured

## package.json bin entry

```json
{
  "bin": {
    "msv": "./bin/msv.js"
  }
}
```

## Post-Install

1. Run `msv add` in first directory to:
   - Create config directory
   - Install LaunchAgent
   - Start first server

## Uninstall

```bash
msv stop           # Stop all servers
msv rm --all       # Remove all from watch list (removes LaunchAgent)
npm uninstall -g markservant
```
