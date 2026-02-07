import { spawn, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { dirname, join } from 'path';

const exec = promisify(execCallback);

/**
 * Resolve the full path to the markserv CLI script.
 * Follows the symlink in node's bin directory to get the actual script path.
 * @returns {string} Full path to the markserv CLI script
 */
function getMarkservPath() {
  return join(dirname(process.execPath), 'markserv');
}

/**
 * Start a markserv instance for a given directory on a specified port.
 * @param {string} directory - The directory to serve
 * @param {number} port - The port to run markserv on
 * @param {Object} [options] - Additional options.
 * @param {boolean} [options.dotfiles] - Whether to show dotfiles in directory listings.
 * @returns {number} The PID of the spawned process
 */
export function startServer(directory, port, options = {}) {
  // Calculate a unique livereload port based on the main port to avoid conflicts
  // when running multiple markserv instances
  const livereloadPort = port + 10000;

  const args = [directory, '-p', String(port), '--livereloadport', String(livereloadPort), '--no-browser'];

  if (options.dotfiles) {
    args.push('--dotfiles', 'allow');
  }

  // Use process.execPath (full path to node) to avoid relying on PATH,
  // which may not include nvm's bin dir (e.g. when run by LaunchAgent).
  const child = spawn(process.execPath, [getMarkservPath(), ...args], {
    cwd: '/',
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
