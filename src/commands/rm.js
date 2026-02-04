import chalk from 'chalk';
import { normalizePath } from '../lib/paths.js';
import { findServer, removeServer, getAllServers, clearAllServers } from '../lib/config.js';
import { stopServer } from '../lib/process.js';
import { uninstallLaunchAgent, isLaunchAgentInstalled } from '../lib/launchagent.js';

/**
 * Removes all servers from the watch list and stops them.
 * Used by `msv rm --all`.
 * @returns {Promise<void>}
 */
async function removeAllServers() {
  const servers = await getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('No servers in watch list.'));
    return;
  }

  // Stop all running servers
  let stoppedCount = 0;
  for (const server of servers) {
    if (server.pid !== null) {
      const stopped = stopServer(server.pid);
      if (stopped) {
        stoppedCount++;
      }
    }
  }

  if (stoppedCount > 0) {
    console.log(chalk.yellow(`Stopped ${stoppedCount} server(s)`));
  }

  // Clear all servers from config
  await clearAllServers();

  // Uninstall LaunchAgent
  if (isLaunchAgentInstalled()) {
    uninstallLaunchAgent();
    console.log(chalk.yellow('Uninstalled LaunchAgent'));
  }

  console.log(chalk.green(`Removed ${servers.length} server(s) from watch list.`));
}

/**
 * Handles the `msv rm [directory]` command.
 * Removes a directory from the watch list and stops its server if running.
 * @param {string} [directory] - The directory to remove. Defaults to current working directory.
 * @param {object} options - Command options.
 * @param {boolean} [options.all] - If true, remove all servers.
 * @returns {Promise<void>}
 */
export default async function rmCommand(directory, options = {}) {
  // Handle --all flag
  if (options.all) {
    await removeAllServers();
    return;
  }

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
