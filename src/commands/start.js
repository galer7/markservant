import chalk from 'chalk';
import { getAllServers, updateServerPid } from '../lib/config.js';
import { startServer, isServerRunning } from '../lib/process.js';

/**
 * Start all configured servers.
 * Skips servers that are already running and starts those that are not.
 * Updates PIDs in config for newly started servers.
 * @returns {Promise<void>}
 */
export default async function startCommand() {
  const servers = await getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('No servers to start.'));
    return;
  }

  let startedCount = 0;
  let alreadyRunningCount = 0;
  let failedCount = 0;

  for (const server of servers) {
    const { directory, port, pid } = server;

    // Check if server is already running
    if (pid !== null && isServerRunning(pid)) {
      console.log(
        chalk.blue(`[${directory}]`) +
          chalk.gray(` Already running on port ${port} (PID: ${pid})`)
      );
      alreadyRunningCount++;
      continue;
    }

    // Start the server
    try {
      const newPid = startServer(directory, port);
      await updateServerPid(directory, newPid);

      const url = `http://localhost:${port}`;
      console.log(
        chalk.blue(`[${directory}]`) +
          chalk.green(` Started on ${url}`) +
          chalk.gray(` (PID: ${newPid})`)
      );
      startedCount++;
    } catch (error) {
      console.log(
        chalk.blue(`[${directory}]`) +
          chalk.red(` Failed to start: ${error.message}`)
      );
      failedCount++;
    }
  }

  // Show summary
  console.log('');
  const summaryParts = [];

  if (startedCount > 0) {
    summaryParts.push(chalk.green(`${startedCount} started`));
  }
  if (alreadyRunningCount > 0) {
    summaryParts.push(chalk.blue(`${alreadyRunningCount} already running`));
  }
  if (failedCount > 0) {
    summaryParts.push(chalk.red(`${failedCount} failed`));
  }

  console.log(chalk.bold('Summary: ') + summaryParts.join(', '));
}
