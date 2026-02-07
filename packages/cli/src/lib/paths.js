import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Normalizes a directory path to an absolute path with symlinks resolved.
 * @param {string} [directory] - The directory path to normalize. Defaults to process.cwd().
 * @returns {string} The normalized absolute path.
 * @throws {Error} If the path cannot be resolved (e.g., does not exist).
 */
export function normalizePath(directory) {
  // Use current working directory if no directory provided
  const targetPath = directory || process.cwd();

  // Resolve to absolute path
  const absolutePath = resolve(targetPath);

  // Resolve symlinks to get the real path
  const realPath = realpathSync(absolutePath);

  // Remove trailing slashes (but keep root '/')
  const normalizedPath = realPath.replace(/\/+$/, "") || "/";

  return normalizedPath;
}

/**
 * Returns the config directory path (~/.config/markservant).
 * @returns {string} The config directory path.
 */
export function getConfigDir() {
  return resolve(homedir(), ".config", "markservant");
}

/**
 * Returns the config file path (~/.config/markservant/config.json).
 * @returns {string} The config file path.
 */
export function getConfigPath() {
  return resolve(getConfigDir(), "config.json");
}

/**
 * Returns the LaunchAgent plist path (~/Library/LaunchAgents/com.markservant.plist).
 * @returns {string} The LaunchAgent plist path.
 */
export function getLaunchAgentPath() {
  return resolve(homedir(), "Library", "LaunchAgents", "com.markservant.plist");
}
