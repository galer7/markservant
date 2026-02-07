# CLI Interface Specification

## Command: `msv`

Global CLI tool for managing markserv instances across directories.

## Commands

### `msv add [directory]`
- Adds a directory to the watch list and starts a markserv instance
- If no directory specified, uses current working directory
- Auto-assigns an available port (range: 9000-9999, avoiding common ports)
- Opens the server URL in Microsoft Edge automatically
- Saves to persistent config

### `msv rm [directory]`
- Removes a directory from the watch list
- Stops the associated markserv process
- If no directory specified, uses current working directory

### `msv list`
- Shows all watched directories with their:
  - Directory path
  - Assigned port
  - Running status (alive/dead)
  - URL

### `msv open [directory]`
- Opens the markserv URL for a directory in Microsoft Edge
- If no directory specified, uses current working directory

### `msv stop`
- Stops all running markserv instances
- Does NOT remove from watch list (they restart on login)

### `msv start`
- Starts all servers in watch list that aren't running
- Useful after `msv stop` or manual kills

## Flags

- `--help, -h` - Show help
- `--version, -v` - Show version
