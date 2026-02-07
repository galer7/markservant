import { relative } from "node:path";
import chalk from "chalk";
import { addServer, findServerForPath, getAllServers, updateServerPid } from "../lib/config.js";
import { installLaunchAgent, isLaunchAgentInstalled } from "../lib/launchagent.js";
import { normalizePath, resolveServerRoot } from "../lib/paths.js";
import { allocatePort } from "../lib/ports.js";
import { openInEdge, startServer } from "../lib/process.js";

/**
 * Open the markserv URL for a path in Microsoft Edge.
 * Accepts any file or directory path under a served project.
 * Auto-adds the server root if not already configured.
 * @param {string} [targetPath] - The file or directory to open. Defaults to cwd.
 * @returns {Promise<void>}
 */
export default async function openCommand(targetPath) {
  try {
    const normalizedPath = normalizePath(targetPath);

    // Try to find a configured server containing this path
    const match = await findServerForPath(normalizedPath);

    if (match) {
      const urlPath = match.subpath
        ? `/${match.subpath.split("/").map(encodeURIComponent).join("/")}`
        : "";
      const url = `http://localhost:${match.server.port}${urlPath}`;
      await openInEdge(url);
      console.log(chalk.green("Opened"), chalk.cyan(url), "in Microsoft Edge");
      return;
    }

    // No server found - auto-add one
    const serverRoot = resolveServerRoot(normalizedPath);
    console.log(chalk.yellow("Auto-adding"), chalk.cyan(serverRoot), "to watch list...");

    const port = await allocatePort();
    await addServer(serverRoot, port);
    const pid = startServer(serverRoot, port);
    await updateServerPid(serverRoot, pid);

    // Install LaunchAgent if this is the first server
    const allServers = await getAllServers();
    if (allServers.length === 1 && !isLaunchAgentInstalled()) {
      try {
        installLaunchAgent();
        console.log(chalk.green("Installed LaunchAgent for auto-start on login."));
      } catch {
        // Non-fatal - server is running regardless
      }
    }

    const subpath = relative(serverRoot, normalizedPath);
    const urlPath = subpath ? `/${subpath.split("/").map(encodeURIComponent).join("/")}` : "";
    const url = `http://localhost:${port}${urlPath}`;
    await openInEdge(url);

    console.log(chalk.green("Added and opened"), chalk.cyan(url), "in Microsoft Edge");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(
        chalk.red("Error:"),
        `Path does not exist: ${chalk.cyan(targetPath || process.cwd())}`,
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
