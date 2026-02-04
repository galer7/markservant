import { execSync } from 'node:child_process';
import { loadConfig } from './config.js';

/**
 * Port range for markserv instances.
 */
export const PORT_RANGE = { min: 9000, max: 9999 };

/**
 * Checks if a port is available (not in use by any process).
 * @param {number} port - The port number to check.
 * @returns {boolean} True if the port is free, false if it's in use.
 */
export function isPortFree(port) {
  try {
    execSync(`lsof -i :${port}`, { stdio: 'ignore' });
    // If lsof succeeds, the port is in use
    return false;
  } catch {
    // If lsof fails (exits with error), the port is free
    return true;
  }
}

/**
 * Allocates a random available port in the configured range.
 * Avoids ports already assigned to other servers and ports currently in use.
 * @returns {Promise<number>} An available port number.
 * @throws {Error} If no available port can be found after 100 attempts.
 */
export async function allocatePort() {
  const config = await loadConfig();
  const assignedPorts = new Set(config.servers.map((server) => server.port));

  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port =
      Math.floor(Math.random() * (PORT_RANGE.max - PORT_RANGE.min + 1)) +
      PORT_RANGE.min;

    // Skip if already assigned to another server
    if (assignedPorts.has(port)) {
      continue;
    }

    // Check if the port is actually free on the system
    if (isPortFree(port)) {
      return port;
    }
  }

  throw new Error(
    `Failed to allocate an available port after ${maxAttempts} attempts. ` +
      `All ports in range ${PORT_RANGE.min}-${PORT_RANGE.max} may be in use.`
  );
}
