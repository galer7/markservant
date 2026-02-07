import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { getConfigDir, getConfigPath, normalizePath } from "./paths.js";

/**
 * @typedef {Object} ServerEntry
 * @property {string} directory - Absolute normalized path to the markdown directory
 * @property {number} port - Port the server is running on
 * @property {number|null} pid - Process ID of the server, or null if not running
 * @property {string} addedAt - ISO timestamp when the server was added
 * @property {boolean} [dotfiles] - Whether to show dotfiles in directory listings
 */

/**
 * @typedef {Object} Config
 * @property {ServerEntry[]} servers - Array of server entries
 */

/**
 * Lock state for file operations.
 * Uses a simple in-memory lock to prevent concurrent writes.
 */
let lockPromise = Promise.resolve();

/**
 * Acquires a lock for file operations.
 * @returns {Promise<() => void>} A function to release the lock.
 */
function acquireLock() {
  let release;
  const newLockPromise = new Promise((resolve) => {
    release = resolve;
  });
  const waitPromise = lockPromise;
  lockPromise = newLockPromise;
  return waitPromise.then(() => release);
}

/**
 * Ensures the config directory exists.
 * @returns {Promise<void>}
 */
async function ensureConfigDir() {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
}

/**
 * Loads the config from disk.
 * Creates the config directory if it doesn't exist.
 * Returns an empty config with empty servers array if the file doesn't exist.
 * @returns {Promise<Config>} The loaded config object.
 */
export async function loadConfig() {
  await ensureConfigDir();

  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return { servers: [] };
  }

  try {
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content);

    // Ensure servers array exists
    if (!Array.isArray(config.servers)) {
      config.servers = [];
    }

    return config;
  } catch (error) {
    // If JSON parsing fails or file is corrupted, return empty config
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return { servers: [] };
    }
    throw error;
  }
}

/**
 * Saves the config to disk using atomic write.
 * Creates the config directory if it doesn't exist.
 * Writes to a temp file first, then renames to ensure atomicity.
 * @param {Config} config - The config object to save.
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  const release = await acquireLock();

  try {
    await ensureConfigDir();

    const configPath = getConfigPath();
    const configDir = getConfigDir();

    // Generate a unique temp file name
    const tempFileName = `.config.${randomBytes(8).toString("hex")}.tmp`;
    const tempPath = join(configDir, tempFileName);

    // Write to temp file with pretty formatting
    const content = `${JSON.stringify(config, null, 2)}\n`;
    await writeFile(tempPath, content, "utf-8");

    // Atomic rename
    try {
      await rename(tempPath, configPath);
    } catch (renameError) {
      // Clean up temp file if rename fails
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw renameError;
    }
  } finally {
    release();
  }
}

/**
 * Finds a server entry by its normalized directory path.
 * @param {string} directory - The directory path to search for.
 * @returns {Promise<ServerEntry|null>} The server entry or null if not found.
 */
export async function findServer(directory) {
  const config = await loadConfig();
  const normalizedDir = normalizePath(directory);

  const server = config.servers.find((s) => s.directory === normalizedDir);
  return server || null;
}

/**
 * Finds the server whose root directory contains the given path.
 * If multiple servers match (nested roots), returns the deepest (most specific) match.
 * @param {string} targetPath - Absolute normalized path to a file or directory.
 * @returns {Promise<{server: ServerEntry, subpath: string}|null>} The matching server and relative subpath, or null.
 */
export async function findServerForPath(targetPath) {
  const config = await loadConfig();

  let bestMatch = null;
  let bestMatchLength = 0;

  for (const server of config.servers) {
    if (targetPath === server.directory) {
      if (server.directory.length > bestMatchLength) {
        bestMatch = { server, subpath: "" };
        bestMatchLength = server.directory.length;
      }
      continue;
    }

    if (targetPath.startsWith(server.directory + sep)) {
      if (server.directory.length > bestMatchLength) {
        const subpath = targetPath.slice(server.directory.length + 1);
        bestMatch = { server, subpath };
        bestMatchLength = server.directory.length;
      }
    }
  }

  return bestMatch;
}

/**
 * Adds a new server entry to the config.
 * Uses normalized path and sets addedAt to current ISO timestamp.
 * PID starts as null.
 * @param {string} directory - The directory path for the server.
 * @param {number} port - The port number for the server.
 * @param {Object} [options] - Additional server options.
 * @param {boolean} [options.dotfiles] - Whether to show dotfiles in directory listings.
 * @returns {Promise<ServerEntry>} The newly created server entry.
 */
export async function addServer(directory, port, options = {}) {
  const release = await acquireLock();

  try {
    const config = await loadConfig();
    const normalizedDir = normalizePath(directory);

    const newServer = {
      directory: normalizedDir,
      port,
      pid: null,
      addedAt: new Date().toISOString(),
    };

    if (options.dotfiles) {
      newServer.dotfiles = true;
    }

    config.servers.push(newServer);

    // Release lock before saving since saveConfig acquires its own lock
    release();

    await saveConfig(config);
    return newServer;
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Removes a server entry from the config by directory path.
 * @param {string} directory - The directory path of the server to remove.
 * @returns {Promise<boolean>} True if the server was removed, false if not found.
 */
export async function removeServer(directory) {
  const release = await acquireLock();

  try {
    const config = await loadConfig();
    const normalizedDir = normalizePath(directory);

    const initialLength = config.servers.length;
    config.servers = config.servers.filter((s) => s.directory !== normalizedDir);

    if (config.servers.length === initialLength) {
      release();
      return false;
    }

    // Release lock before saving since saveConfig acquires its own lock
    release();

    await saveConfig(config);
    return true;
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Updates the PID for a server entry.
 * @param {string} directory - The directory path of the server to update.
 * @param {number|null} pid - The new PID value, or null if the server is not running.
 * @returns {Promise<boolean>} True if the server was found and updated, false otherwise.
 */
export async function updateServerPid(directory, pid) {
  const release = await acquireLock();

  try {
    const config = await loadConfig();
    const normalizedDir = normalizePath(directory);

    const server = config.servers.find((s) => s.directory === normalizedDir);

    if (!server) {
      release();
      return false;
    }

    server.pid = pid;

    // Release lock before saving since saveConfig acquires its own lock
    release();

    await saveConfig(config);
    return true;
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Gets all server entries from the config.
 * @returns {Promise<ServerEntry[]>} Array of all server entries.
 */
export async function getAllServers() {
  const config = await loadConfig();
  return config.servers;
}

/**
 * Removes all server entries from the config.
 * @returns {Promise<void>}
 */
export async function clearAllServers() {
  await saveConfig({ servers: [] });
}
