# Storage Specification

## Config Location

`~/.config/markservant/config.json`

## Schema

```json
{
  "servers": [
    {
      "directory": "/Users/galer7/p/octatech.xyz",
      "port": 9001,
      "pid": 12345,
      "addedAt": "2025-02-04T10:00:00Z"
    },
    {
      "directory": "/Users/galer7/d",
      "port": 9002,
      "pid": 12346,
      "addedAt": "2025-02-04T10:05:00Z"
    }
  ]
}
```

## Fields

### Server Entry
- `directory` (string): Absolute path to the watched directory
- `port` (number): Assigned port number
- `pid` (number | null): Process ID when running, null when stopped
- `addedAt` (string): ISO timestamp when added

## File Operations

- Create config directory if not exists
- Use atomic writes (write to temp, then rename)
- Handle concurrent access gracefully (file locking)

## Directory Normalization

- Always store absolute paths
- Resolve symlinks
- Remove trailing slashes
- Use this normalized form for lookups
