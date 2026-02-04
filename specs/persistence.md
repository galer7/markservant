# Persistence Specification

## Auto-Start on Login

Use macOS LaunchAgent to start all watched servers on login.

## LaunchAgent

**Path**: `~/Library/LaunchAgents/com.markservant.plist`

**Behavior**:
- Runs `msv start` on user login
- Single plist manages all servers (via the watch list)
- Auto-installed when first directory is added
- Auto-removed when last directory is removed

## LaunchAgent Contents

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.markservant</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/msv</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

## Process Management

- Store PIDs in config to track running processes
- On `msv start`, check if PID is still alive before spawning
- On `msv list`, verify PIDs are still markserv processes
