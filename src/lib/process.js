import { spawn, exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

/**
 * Start a markserv instance for a given directory on a specified port.
 * @param {string} directory - The directory to serve
 * @param {number} port - The port to run markserv on
 * @returns {number} The PID of the spawned process
 */
export function startServer(directory, port) {
  const child = spawn('markserv', [directory, '-p', String(port)], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  return child.pid;
}

/**
 * Stop a markserv process by its PID.
 * @param {number} pid - The process ID to kill
 * @returns {boolean} True if the process was killed, false if it wasn't running
 */
export function stopServer(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch (error) {
    // ESRCH means the process doesn't exist
    if (error.code === 'ESRCH') {
      return false;
    }
    // EPERM means we don't have permission - process exists but we can't kill it
    // For other errors, we treat it as not running
    return false;
  }
}

/**
 * Check if a process is still running.
 * @param {number} pid - The process ID to check
 * @returns {boolean} True if the process is running, false otherwise
 */
export function isServerRunning(pid) {
  try {
    // Signal 0 doesn't actually send a signal, but checks if the process exists
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH means the process doesn't exist
    // EPERM means process exists but we don't have permission (still "running")
    if (error.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

/**
 * Open a URL in Microsoft Edge.
 * @param {string} url - The URL to open
 * @returns {Promise<void>} Resolves when the command completes
 */
export async function openInEdge(url) {
  await exec(`open -a "Microsoft Edge" "${url}"`);
}
