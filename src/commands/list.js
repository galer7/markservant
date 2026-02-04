import chalk from 'chalk';
import { getAllServers } from '../lib/config.js';
import { isServerRunning } from '../lib/process.js';

/**
 * List all watched directories with their status.
 * Displays directory path, port, running status, and URL for each server.
 */
export default async function listCommand() {
  const servers = await getAllServers();

  if (servers.length === 0) {
    console.log('No watched directories');
    return;
  }

  // Calculate column widths for alignment
  const maxDirLength = Math.max(...servers.map((s) => s.directory.length));
  const maxPortLength = Math.max(...servers.map((s) => String(s.port).length), 4);

  // Print header
  console.log(
    chalk.bold('Directory'.padEnd(maxDirLength + 2)) +
      chalk.bold('Port'.padEnd(maxPortLength + 2)) +
      chalk.bold('Status'.padEnd(10)) +
      chalk.bold('URL')
  );

  console.log('-'.repeat(maxDirLength + maxPortLength + 40));

  // Print each server entry
  for (const server of servers) {
    const running = server.pid !== null && isServerRunning(server.pid);
    const status = running ? chalk.green('running') : chalk.red('stopped');
    const url = `http://localhost:${server.port}`;

    console.log(
      chalk.dim(server.directory.padEnd(maxDirLength + 2)) +
        String(server.port).padEnd(maxPortLength + 2) +
        status.padEnd(running ? 17 : 17) +
        url
    );
  }
}
