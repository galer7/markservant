import chalk from "chalk";
import { getAllServers, updateServerPid } from "../lib/config.js";
import { isServerRunning, stopServer } from "../lib/process.js";

/**
 * Stop all running markserv servers.
 * This does NOT remove servers from the watch list, just stops their processes.
 * @returns {Promise<void>}
 */
export default async function stopCommand() {
  const servers = await getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow("No servers to stop"));
    return;
  }

  let stoppedCount = 0;

  for (const server of servers) {
    if (server.pid === null) {
      continue;
    }

    const running = isServerRunning(server.pid);

    if (running) {
      const stopped = stopServer(server.pid);

      if (stopped) {
        await updateServerPid(server.directory, null);
        console.log(
          chalk.green(`Stopped server for ${chalk.bold(server.directory)} (PID: ${server.pid})`),
        );
        stoppedCount++;
      } else {
        console.log(
          chalk.red(
            `Failed to stop server for ${chalk.bold(server.directory)} (PID: ${server.pid})`,
          ),
        );
      }
    } else {
      // Process is not running but PID was recorded, clean up the stale PID
      await updateServerPid(server.directory, null);
    }
  }

  if (stoppedCount === 0) {
    console.log(chalk.yellow("No running servers to stop"));
  } else {
    console.log(chalk.green(`\nStopped ${stoppedCount} server${stoppedCount === 1 ? "" : "s"}`));
  }
}
