import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { getLaunchAgentPath } from './paths.js';

/**
 * Generates the plist XML content for the LaunchAgent.
 * @returns {string} The plist XML content.
 */
function generatePlistContent() {
  // Get the current msv binary path dynamically
  const msvPath = process.argv[1];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.markservant</string>
    <key>ProgramArguments</key>
    <array>
        <string>${msvPath}</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
`;
}

/**
 * Install the LaunchAgent for auto-starting servers on login.
 * Creates ~/Library/LaunchAgents directory if it doesn't exist,
 * writes the plist file, and loads it with launchctl.
 * @returns {boolean} True on success.
 * @throws {Error} If installation fails.
 */
export function installLaunchAgent() {
  const plistPath = getLaunchAgentPath();
  const launchAgentsDir = dirname(plistPath);

  // Create ~/Library/LaunchAgents directory if it doesn't exist
  if (!existsSync(launchAgentsDir)) {
    mkdirSync(launchAgentsDir, { recursive: true });
  }

  // Generate and write the plist file
  const plistContent = generatePlistContent();
  writeFileSync(plistPath, plistContent, 'utf8');

  // Load the LaunchAgent with launchctl
  try {
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
  } catch (error) {
    // If loading fails, clean up the plist file
    if (existsSync(plistPath)) {
      unlinkSync(plistPath);
    }
    throw new Error(`Failed to load LaunchAgent: ${error.message}`);
  }

  return true;
}

/**
 * Uninstall the LaunchAgent.
 * Unloads with launchctl and deletes the plist file.
 * @returns {boolean} True on success, false if not installed.
 */
export function uninstallLaunchAgent() {
  const plistPath = getLaunchAgentPath();

  // Check if the LaunchAgent is installed
  if (!existsSync(plistPath)) {
    return false;
  }

  // Unload the LaunchAgent with launchctl
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
  } catch (error) {
    // Continue with deletion even if unload fails
    // (the agent might not be loaded but the file exists)
  }

  // Delete the plist file
  unlinkSync(plistPath);

  return true;
}

/**
 * Check if the LaunchAgent is installed.
 * @returns {boolean} True if the plist file exists.
 */
export function isLaunchAgentInstalled() {
  const plistPath = getLaunchAgentPath();
  return existsSync(plistPath);
}
