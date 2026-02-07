import { existsSync } from "node:fs";
import { rm as fsRm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock paths module to use temp directories
vi.mock("../lib/paths.js", async () => {
  return {
    normalizePath: (dir) => dir || globalThis.__TEST_NORMALIZED_PATH__,
    getConfigDir: () => globalThis.__TEST_CONFIG_DIR__,
    getConfigPath: () => join(globalThis.__TEST_CONFIG_DIR__, "config.json"),
  };
});

// Mock process module
vi.mock("../lib/process.js", () => ({
  stopServer: vi.fn(() => true),
}));

// Mock launchagent module
vi.mock("../lib/launchagent.js", () => ({
  isLaunchAgentInstalled: vi.fn(() => false),
  uninstallLaunchAgent: vi.fn(),
}));

// Import config after mocking
const { addServer, getAllServers, clearAllServers } = await import("../lib/config.js");
const { stopServer } = await import("../lib/process.js");
const { isLaunchAgentInstalled, uninstallLaunchAgent } = await import("../lib/launchagent.js");

// Import the command after all mocks are set up
const { default: rmCommand } = await import("./rm.js");

describe("rm command", () => {
  let testConfigDir;
  let consoleSpy;
  let processExitSpy;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testConfigDir = join(
      tmpdir(),
      `markservant-rm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
    globalThis.__TEST_NORMALIZED_PATH__ = "/default/path";

    // Clear all mocks
    vi.clearAllMocks();

    // Mock console.log and console.error
    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    // Mock process.exit
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    // Ensure config directory exists
    await mkdir(testConfigDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up the temp directory after each test
    if (existsSync(testConfigDir)) {
      await fsRm(testConfigDir, { recursive: true, force: true });
    }
    delete globalThis.__TEST_CONFIG_DIR__;
    delete globalThis.__TEST_NORMALIZED_PATH__;

    // Restore console and process.exit
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("single server removal", () => {
    it("removes server from watch list", async () => {
      // Add a server first
      await addServer("/test/directory", 9000);

      // Verify it exists
      let servers = await getAllServers();
      expect(servers).toHaveLength(1);

      // Remove it
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";
      await rmCommand("/test/directory", {});

      // Verify it's gone
      servers = await getAllServers();
      expect(servers).toHaveLength(0);
    });

    it("stops the server if it has a PID", async () => {
      // Add a server with a PID
      await addServer("/test/directory", 9000);
      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";
      await rmCommand("/test/directory", {});

      expect(stopServer).toHaveBeenCalledWith(12345);
    });

    it("does not try to stop server if PID is null", async () => {
      // Add a server without a PID
      await addServer("/test/directory", 9000);

      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";
      await rmCommand("/test/directory", {});

      expect(stopServer).not.toHaveBeenCalled();
    });

    it("shows success message", async () => {
      await addServer("/test/directory", 9000);

      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";
      await rmCommand("/test/directory", {});

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Removed"));
    });

    it("exits with error if server not found", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/non/existent";

      await expect(rmCommand("/non/existent", {})).rejects.toThrow("process.exit called");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it("uninstalls LaunchAgent when removing the last server", async () => {
      // Set up mock to return true for LaunchAgent installed
      isLaunchAgentInstalled.mockReturnValue(true);

      // Add a single server
      await addServer("/only/server", 9000);

      globalThis.__TEST_NORMALIZED_PATH__ = "/only/server";
      await rmCommand("/only/server", {});

      expect(uninstallLaunchAgent).toHaveBeenCalled();
    });

    it("does not uninstall LaunchAgent when other servers remain", async () => {
      // Set up mock to return true for LaunchAgent installed
      isLaunchAgentInstalled.mockReturnValue(true);

      // Add multiple servers
      await addServer("/first/server", 9001);
      await addServer("/second/server", 9002);

      // Remove only one
      globalThis.__TEST_NORMALIZED_PATH__ = "/first/server";
      await rmCommand("/first/server", {});

      expect(uninstallLaunchAgent).not.toHaveBeenCalled();
    });
  });

  describe("--all flag", () => {
    it("removes all servers from watch list", async () => {
      // Add multiple servers
      await addServer("/server/one", 9001);
      await addServer("/server/two", 9002);
      await addServer("/server/three", 9003);

      // Verify they exist
      let servers = await getAllServers();
      expect(servers).toHaveLength(3);

      // Remove all
      await rmCommand(undefined, { all: true });

      // Verify all are gone
      servers = await getAllServers();
      expect(servers).toHaveLength(0);
    });

    it("stops all running servers", async () => {
      // Add servers with PIDs
      await addServer("/server/one", 9001);
      await addServer("/server/two", 9002);

      // Update config to add PIDs
      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 11111;
      config.servers[1].pid = 22222;
      await writeFile(configPath, JSON.stringify(config));

      await rmCommand(undefined, { all: true });

      expect(stopServer).toHaveBeenCalledWith(11111);
      expect(stopServer).toHaveBeenCalledWith(22222);
      expect(stopServer).toHaveBeenCalledTimes(2);
    });

    it("uninstalls LaunchAgent", async () => {
      isLaunchAgentInstalled.mockReturnValue(true);

      // Add a server
      await addServer("/server/path", 9000);

      await rmCommand(undefined, { all: true });

      expect(uninstallLaunchAgent).toHaveBeenCalled();
    });

    it("shows success message with server count", async () => {
      await addServer("/server/one", 9001);
      await addServer("/server/two", 9002);

      await rmCommand(undefined, { all: true });

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("2"));
    });

    it("shows message when no servers exist", async () => {
      await rmCommand(undefined, { all: true });

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("No servers"));
    });

    it("handles servers with null PIDs", async () => {
      // Add servers - one with PID, one without
      await addServer("/server/one", 9001);
      await addServer("/server/two", 9002);

      // Update only first server to have a PID
      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 11111;
      // servers[1].pid remains null
      await writeFile(configPath, JSON.stringify(config));

      await rmCommand(undefined, { all: true });

      // Only the server with a PID should have stopServer called
      expect(stopServer).toHaveBeenCalledTimes(1);
      expect(stopServer).toHaveBeenCalledWith(11111);
    });
  });
});
