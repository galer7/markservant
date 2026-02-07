import { execSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

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
 * Resolves the appropriate server root directory for a given path.
 * Uses git root if the path is inside a git repository, otherwise
 * uses the directory itself (or parent directory for file paths).
 * @param {string} normalizedPath - Absolute normalized path to a file or directory.
 * @returns {string} The resolved server root directory.
 */
export function resolveServerRoot(normalizedPath) {
  const startDir = statSync(normalizedPath).isDirectory()
    ? normalizedPath
    : dirname(normalizedPath);

  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    return normalizePath(gitRoot);
  } catch {
    return startDir;
  }
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
