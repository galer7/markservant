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
  isServerRunning: vi.fn(() => true),
}));

// Import config after mocking
const { addServer, getAllServers } = await import("../lib/config.js");
const { stopServer, isServerRunning } = await import("../lib/process.js");

// Import the command after all mocks are set up
const { default: stopCommand } = await import("./stop.js");

describe("stop command", () => {
  let testConfigDir;
  let consoleSpy;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testConfigDir = join(
      tmpdir(),
      `markservant-stop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
    globalThis.__TEST_NORMALIZED_PATH__ = "/default/path";

    // Clear all mocks
    vi.clearAllMocks();

    // Reset mock implementations to defaults
    stopServer.mockReturnValue(true);
    isServerRunning.mockReturnValue(true);

    // Mock console.log
    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
    };

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

    // Restore console
    consoleSpy.log.mockRestore();
  });

  describe("empty server list", () => {
    it('shows "No servers to stop" when empty', async () => {
      await stopCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("No servers to stop"));
    });
  });

  describe("stopping running servers", () => {
    it("stops running servers", async () => {
      // Add a server with a PID
      await addServer("/test/directory", 9000);
      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      expect(isServerRunning).toHaveBeenCalledWith(12345);
      expect(stopServer).toHaveBeenCalledWith(12345);
    });

    it("updates PID to null after stopping", async () => {
      // Add a server with a PID
      await addServer("/test/directory", 9000);
      const configPath = join(testConfigDir, "config.json");
      let config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      // Verify PID was set to null
      config = JSON.parse(await (await import("node:fs/promises")).readFile(configPath, "utf-8"));
      expect(config.servers[0].pid).toBeNull();
    });

    it("logs stopped servers with directory and PID", async () => {
      // Add a server with a PID
      await addServer("/test/directory", 9000);
      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Stopped server for"));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("/test/directory"));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("12345"));
    });
  });

  describe("stopServer failure", () => {
    it("handles stopServer failure", async () => {
      stopServer.mockReturnValue(false);

      // Add a server with a PID
      await addServer("/test/directory", 9000);
      const configPath = join(testConfigDir, "config.json");
      let config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Failed to stop server"));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("/test/directory"));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("12345"));

      // PID should NOT be updated to null on failure
      config = JSON.parse(await (await import("node:fs/promises")).readFile(configPath, "utf-8"));
      expect(config.servers[0].pid).toBe(12345);
    });
  });

  describe("no running servers", () => {
    it('shows "No running servers to stop" when none running', async () => {
      isServerRunning.mockReturnValue(false);

      // Add servers with PIDs but mark them as not running
      await addServer("/test/directory", 9000);
      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("No running servers to stop"),
      );
    });
  });

  describe("stale PID cleanup", () => {
    it("cleans up stale PIDs (not running but has PID)", async () => {
      isServerRunning.mockReturnValue(false);

      // Add a server with a stale PID
      await addServer("/test/directory", 9000);
      const configPath = join(testConfigDir, "config.json");
      let config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      // Verify stale PID was cleaned up
      config = JSON.parse(await (await import("node:fs/promises")).readFile(configPath, "utf-8"));
      expect(config.servers[0].pid).toBeNull();

      // stopServer should NOT be called for stale PIDs
      expect(stopServer).not.toHaveBeenCalled();
    });
  });

  describe("servers with null PIDs", () => {
    it("skips servers with null PIDs", async () => {
      // Add a server without a PID (default is null)
      await addServer("/test/directory", 9000);

      await stopCommand();

      expect(isServerRunning).not.toHaveBeenCalled();
      expect(stopServer).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("No running servers to stop"),
      );
    });
  });

  describe("summary count", () => {
    it("shows correct count in summary for single server", async () => {
      // Add a server with a PID
      await addServer("/test/directory", 9000);
      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Stopped 1 server"));
    });

    it("shows correct count in summary for multiple servers", async () => {
      // Add multiple servers with PIDs
      await addServer("/server/one", 9001);
      await addServer("/server/two", 9002);
      await addServer("/server/three", 9003);

      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 11111;
      config.servers[1].pid = 22222;
      config.servers[2].pid = 33333;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Stopped 3 servers"));
    });
  });

  describe("multiple servers", () => {
    it("handles multiple servers with mixed states", async () => {
      // Add multiple servers
      await addServer("/server/running", 9001);
      await addServer("/server/stale", 9002);
      await addServer("/server/no-pid", 9003);

      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 11111; // running
      config.servers[1].pid = 22222; // stale (will be marked not running)
      // servers[2].pid remains null
      await writeFile(configPath, JSON.stringify(config));

      // First server is running, second is not
      isServerRunning.mockImplementation((pid) => pid === 11111);

      await stopCommand();

      // isServerRunning should be called for servers with PIDs
      expect(isServerRunning).toHaveBeenCalledWith(11111);
      expect(isServerRunning).toHaveBeenCalledWith(22222);
      expect(isServerRunning).toHaveBeenCalledTimes(2);

      // stopServer should only be called for the running server
      expect(stopServer).toHaveBeenCalledTimes(1);
      expect(stopServer).toHaveBeenCalledWith(11111);

      // Both PIDs should be cleaned up (one stopped, one stale)
      const updatedConfig = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      expect(updatedConfig.servers[0].pid).toBeNull();
      expect(updatedConfig.servers[1].pid).toBeNull();
      expect(updatedConfig.servers[2].pid).toBeNull();

      // Summary should show 1 stopped (only the running one counts)
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Stopped 1 server"));
    });

    it("stops all running servers", async () => {
      // Add multiple running servers
      await addServer("/server/one", 9001);
      await addServer("/server/two", 9002);

      const configPath = join(testConfigDir, "config.json");
      const config = JSON.parse(
        await (await import("node:fs/promises")).readFile(configPath, "utf-8"),
      );
      config.servers[0].pid = 11111;
      config.servers[1].pid = 22222;
      await writeFile(configPath, JSON.stringify(config));

      await stopCommand();

      expect(stopServer).toHaveBeenCalledWith(11111);
      expect(stopServer).toHaveBeenCalledWith(22222);
      expect(stopServer).toHaveBeenCalledTimes(2);
    });
  });
});
