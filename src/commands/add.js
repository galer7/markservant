import chalk from 'chalk';
import { normalizePath } from '../lib/paths.js';
import { findServer, addServer, updateServerPid, getAllServers } from '../lib/config.js';
import { allocatePort } from '../lib/ports.js';
import { startServer, openInEdge } from '../lib/process.js';
import { installLaunchAgent, isLaunchAgentInstalled } from '../lib/launchagent.js';

/**
 * Add a directory to the watch list and start markserv.
 * @param {string} [directory] - The directory to add. Defaults to current working directory.
 * @param {Object} [options] - Command options from Commander.
 * @param {boolean} [options.noDotfiles] - Whether to hide dotfiles in directory listings.
 */
export default async function addCommand(directory, options = {}) {
  // Dotfiles are shown by default, use --no-dotfiles to hide them
  const showDotfiles = !options.noDotfiles;
  try {
    // Step 1: Normalize the directory path (default to cwd if not provided)
    let normalizedPath;
    try {
      normalizedPath = normalizePath(directory);
    } catch (error) {
      console.error(chalk.red(`Error: Cannot resolve path "${directory || '.'}"`));
      console.error(chalk.red(`  ${error.message}`));
      process.exit(1);
    }

    // Step 2: Check if directory is already in the watch list
    const existingServer = await findServer(normalizedPath);

    if (existingServer) {
      const url = `http://localhost:${existingServer.port}`;
      console.log(chalk.yellow(`Directory already being served: ${normalizedPath}`));
      console.log(chalk.cyan(`Opening ${url} in Microsoft Edge...`));

      try {
        await openInEdge(url);
      } catch (error) {
        console.error(chalk.red(`Failed to open browser: ${error.message}`));
      }

      return;
    }

    // Step 3: Allocate a new port
    let port;
    try {
      port = await allocatePort();
    } catch (error) {
      console.error(chalk.red(`Error allocating port: ${error.message}`));
      process.exit(1);
    }

    // Step 4: Add server to config
    try {
      await addServer(normalizedPath, port, { dotfiles: showDotfiles });
    } catch (error) {
      console.error(chalk.red(`Error adding server to config: ${error.message}`));
      process.exit(1);
    }

    // Step 5: Start the markserv process
    let pid;
    try {
      pid = startServer(normalizedPath, port, { dotfiles: showDotfiles });
    } catch (error) {
      console.error(chalk.red(`Error starting markserv: ${error.message}`));
      process.exit(1);
    }

    // Step 6: Update config with PID
    try {
      await updateServerPid(normalizedPath, pid);
    } catch (error) {
      console.error(chalk.yellow(`Warning: Failed to update PID in config: ${error.message}`));
      // Continue despite this error - the server is running
    }

    // Step 7: If this is the first server, install LaunchAgent
    const allServers = await getAllServers();
    if (allServers.length === 1 && !isLaunchAgentInstalled()) {
      try {
        installLaunchAgent();
        console.log(chalk.green('Installed LaunchAgent for auto-start on login.'));
      } catch (error) {
        console.error(chalk.yellow(`Warning: Failed to install LaunchAgent: ${error.message}`));
        // Continue despite this error - the server is still running
      }
    }

    // Step 8: Open the URL in Microsoft Edge
    const url = `http://localhost:${port}`;
    try {
      await openInEdge(url);
    } catch (error) {
      console.error(chalk.yellow(`Warning: Failed to open browser: ${error.message}`));
      // Continue despite this error - show success message anyway
    }

    // Step 9: Show success message with URL
    console.log(chalk.green(`Successfully added and started markserv for:`));
    console.log(chalk.white(`  Directory: ${normalizedPath}`));
    console.log(chalk.white(`  URL: ${chalk.cyan(url)}`));
    console.log(chalk.white(`  PID: ${pid}`));
  } catch (error) {
    console.error(chalk.red(`Unexpected error: ${error.message}`));
    process.exit(1);
  }
}
