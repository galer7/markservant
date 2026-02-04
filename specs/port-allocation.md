# Port Allocation Specification

## Strategy

Auto-assign ports from a safe range, avoiding conflicts.

## Port Range

- **Range**: 9000-9999
- **Reason**: Above common development ports (3000, 5000, 8000, 8080, 8642)

## Allocation Algorithm

1. Load existing port assignments from config
2. Find a random available port in range that is:
   - Not already assigned to another watched directory
   - Not currently in use by any process (check with `lsof`)
3. Persist the port assignment with the directory

## Port Persistence

- Once a port is assigned to a directory, it stays assigned
- This ensures bookmarks/shortcuts remain valid
- Port only gets reassigned if explicitly removed and re-added

## Conflict Resolution

- On startup, if assigned port is in use by non-markserv process:
  - Log warning
  - Attempt to assign new port
  - Update config
