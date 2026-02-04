# markservant (msv)

CLI tool to manage multiple markserv instances with auto-start persistence.

## Features

- Watch multiple directories with markserv
- Auto-assign ports (no conflicts)
- Auto-start on login (macOS LaunchAgent)
- Open in Microsoft Edge with one command

## Install

```bash
npm install -g markservant
```

## Usage

```bash
# Add current directory to watch list
msv add

# Add specific directory
msv add ~/p/my-project

# List all servers
msv list

# Open a server in Edge
msv open

# Remove from watch list
msv rm

# Stop all servers (keeps config)
msv stop

# Start all servers
msv start
```

## Requirements

- Node.js
- markserv (`npm install -g markserv`)
- macOS

## License

MIT
