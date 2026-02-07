import chalk from "chalk";
import { findServer } from "../lib/config.js";
import { normalizePath } from "../lib/paths.js";
import { openInEdge } from "../lib/process.js";

/**
 * Open the markserv URL for a directory in Microsoft Edge.
 * @param {string} [directory] - The directory to open. Defaults to current working directory.
 * @returns {Promise<void>}
 */
export default async function openCommand(directory) {
  try {
    // Normalize the directory path (defaults to cwd if not provided)
    const normalizedPath = normalizePath(directory);

    // Find the server in the watch list
    const server = await findServer(normalizedPath);

    if (!server) {
      console.error(
        chalk.red("Error:"),
        `Directory not in watch list: ${chalk.cyan(normalizedPath)}`,
      );
      console.error(
        chalk.yellow("Tip:"),
        `Run ${chalk.cyan("msv add")} first to add this directory.`,
      );
      process.exitCode = 1;
      return;
    }

    // Open the URL in Microsoft Edge
    const url = `http://localhost:${server.port}`;
    await openInEdge(url);

    console.log(chalk.green("Opened"), chalk.cyan(url), "in Microsoft Edge");
  } catch (error) {
    // Handle path resolution errors (e.g., directory doesn't exist)
    if (error.code === "ENOENT") {
      console.error(
        chalk.red("Error:"),
        `Directory does not exist: ${chalk.cyan(directory || process.cwd())}`,
      );
      process.exitCode = 1;
      return;
    }

    // Re-throw unexpected errors
    throw error;
  }
}
