import chalk from 'chalk';
import { normalizePath } from '../lib/paths.js';
import { findServer, removeServer, getAllServers } from '../lib/config.js';
import { stopServer } from '../lib/process.js';
import { uninstallLaunchAgent, isLaunchAgentInstalled } from '../lib/launchagent.js';

/**
 * Handles the `msv rm [directory]` command.
 * Removes a directory from the watch list and stops its server if running.
 * @param {string} [directory] - The directory to remove. Defaults to current working directory.
 * @returns {Promise<void>}
 */
export default async function rmCommand(directory) {
  // Normalize the directory path (default to cwd if not provided)
  let normalizedPath;
  try {
    normalizedPath = normalizePath(directory);
  } catch (error) {
    console.error(chalk.red(`Error: Cannot resolve path "${directory || process.cwd()}"`));
    console.error(chalk.red(error.message));
    process.exit(1);
  }

  // Find the server in the watch list
  const server = await findServer(normalizedPath);

  if (!server) {
    console.error(chalk.red(`Error: "${normalizedPath}" is not in the watch list.`));
    process.exit(1);
  }

  // Stop the server if it has a PID
  if (server.pid !== null) {
    const stopped = stopServer(server.pid);
    if (stopped) {
      console.log(chalk.yellow(`Stopped server (PID: ${server.pid})`));
    }
  }

  // Remove server from config
  const removed = await removeServer(normalizedPath);

  if (!removed) {
    console.error(chalk.red('Error: Failed to remove server from config.'));
    process.exit(1);
  }

  // Check if this was the last server and uninstall LaunchAgent if so
  const remainingServers = await getAllServers();

  if (remainingServers.length === 0 && isLaunchAgentInstalled()) {
    uninstallLaunchAgent();
    console.log(chalk.yellow('Uninstalled LaunchAgent (no servers remaining)'));
  }

  // Show success message
  console.log(chalk.green(`Removed "${normalizedPath}" from watch list.`));
}
