import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store original functions before mocking
const originalGetConfigDir = vi.fn();
const originalGetConfigPath = vi.fn();
const originalNormalizePath = vi.fn();

// Mock the paths module to use temp directories
vi.mock("./paths.js", async () => {
  return {
    getConfigDir: () => globalThis.__TEST_CONFIG_DIR__,
    getConfigPath: () => join(globalThis.__TEST_CONFIG_DIR__, "config.json"),
    normalizePath: (dir) => dir || "/normalized/path",
  };
});

// Import after mocking
const {
  loadConfig,
  saveConfig,
  findServer,
  findServerForPath,
  addServer,
  removeServer,
  updateServerPid,
  getAllServers,
  clearAllServers,
} = await import("./config.js");

describe("config.js", () => {
  let testConfigDir;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testConfigDir = join(
      tmpdir(),
      `markservant-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
  });

  afterEach(async () => {
    // Clean up the temp directory after each test
    if (existsSync(testConfigDir)) {
      await rm(testConfigDir, { recursive: true, force: true });
    }
    delete globalThis.__TEST_CONFIG_DIR__;
  });

  describe("loadConfig", () => {
    it("returns empty { servers: [] } when config file does not exist", async () => {
      const config = await loadConfig();

      expect(config).toEqual({ servers: [] });
    });

    it("creates config directory if it does not exist", async () => {
      expect(existsSync(testConfigDir)).toBe(false);

      await loadConfig();

      expect(existsSync(testConfigDir)).toBe(true);
    });

    it("parses and returns existing config", async () => {
      // Create config directory and file
      await mkdir(testConfigDir, { recursive: true });
      const configPath = join(testConfigDir, "config.json");
      const existingConfig = {
        servers: [
          {
            directory: "/some/path",
            port: 8080,
            pid: 12345,
            addedAt: "2024-01-15T10:00:00.000Z",
          },
        ],
      };
      const { writeFile } = await import("node:fs/promises");
      await writeFile(configPath, JSON.stringify(existingConfig), "utf-8");

      const config = await loadConfig();

      expect(config).toEqual(existingConfig);
    });

    it("returns empty servers array if config has no servers property", async () => {
      await mkdir(testConfigDir, { recursive: true });
      const configPath = join(testConfigDir, "config.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(configPath, JSON.stringify({ someOtherKey: "value" }), "utf-8");

      const config = await loadConfig();

      expect(config.servers).toEqual([]);
    });

    it("returns empty config for malformed JSON", async () => {
      await mkdir(testConfigDir, { recursive: true });
      const configPath = join(testConfigDir, "config.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(configPath, "{ invalid json", "utf-8");

      const config = await loadConfig();

      expect(config).toEqual({ servers: [] });
    });
  });

  describe("saveConfig", () => {
    it("creates config directory if it does not exist", async () => {
      expect(existsSync(testConfigDir)).toBe(false);

      await saveConfig({ servers: [] });

      expect(existsSync(testConfigDir)).toBe(true);
    });

    it("writes config to disk", async () => {
      const configToSave = {
        servers: [
          {
            directory: "/test/path",
            port: 3000,
            pid: null,
            addedAt: "2024-01-15T10:00:00.000Z",
          },
        ],
      };

      await saveConfig(configToSave);

      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");
      const savedConfig = JSON.parse(content);
      expect(savedConfig).toEqual(configToSave);
    });

    it("pretty-prints JSON with 2-space indentation", async () => {
      const configToSave = {
        servers: [
          { directory: "/test", port: 8080, pid: null, addedAt: "2024-01-15T10:00:00.000Z" },
        ],
      };

      await saveConfig(configToSave);

      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");

      // Check for pretty printing (should have newlines and indentation)
      expect(content).toContain("\n");
      expect(content).toContain("  "); // 2-space indentation

      // Should end with newline
      expect(content.endsWith("\n")).toBe(true);

      // Verify the expected format
      const expectedContent = `${JSON.stringify(configToSave, null, 2)}\n`;
      expect(content).toBe(expectedContent);
    });

    it("writes atomically (no temp files left behind)", async () => {
      await saveConfig({ servers: [] });

      const { readdir } = await import("node:fs/promises");
      const files = await readdir(testConfigDir);

      // Should only have config.json, no temp files
      expect(files).toEqual(["config.json"]);
    });

    it("handles concurrent saves correctly", async () => {
      // Perform multiple concurrent saves
      const saves = [
        saveConfig({
          servers: [
            { directory: "/path1", port: 3001, pid: null, addedAt: "2024-01-01T00:00:00.000Z" },
          ],
        }),
        saveConfig({
          servers: [
            { directory: "/path2", port: 3002, pid: null, addedAt: "2024-01-02T00:00:00.000Z" },
          ],
        }),
        saveConfig({
          servers: [
            { directory: "/path3", port: 3003, pid: null, addedAt: "2024-01-03T00:00:00.000Z" },
          ],
        }),
      ];

      await Promise.all(saves);

      // Config should be valid (one of the saves should have won)
      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");
      const savedConfig = JSON.parse(content);

      expect(savedConfig.servers).toBeDefined();
      expect(Array.isArray(savedConfig.servers)).toBe(true);
    });
  });

  describe("findServer", () => {
    it("returns server when found", async () => {
      // Set up a config with a server
      await mkdir(testConfigDir, { recursive: true });
      const configPath = join(testConfigDir, "config.json");
      const serverEntry = {
        directory: "/test/directory",
        port: 8080,
        pid: 12345,
        addedAt: "2024-01-15T10:00:00.000Z",
      };
      const { writeFile } = await import("node:fs/promises");
      await writeFile(configPath, JSON.stringify({ servers: [serverEntry] }), "utf-8");

      // The mock normalizes to the directory passed in
      const result = await findServer("/test/directory");

      expect(result).toEqual(serverEntry);
    });

    it("returns null when not found", async () => {
      await mkdir(testConfigDir, { recursive: true });
      const configPath = join(testConfigDir, "config.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        configPath,
        JSON.stringify({
          servers: [
            {
              directory: "/other/path",
              port: 3000,
              pid: null,
              addedAt: "2024-01-15T10:00:00.000Z",
            },
          ],
        }),
        "utf-8",
      );

      const result = await findServer("/non/existent/path");

      expect(result).toBeNull();
    });

    it("returns null when config is empty", async () => {
      const result = await findServer("/any/path");

      expect(result).toBeNull();
    });

    it("uses normalized paths for comparison", async () => {
      await mkdir(testConfigDir, { recursive: true });
      const configPath = join(testConfigDir, "config.json");
      // The mock normalizePath returns the path as-is
      const serverEntry = {
        directory: "/test/path",
        port: 8080,
        pid: null,
        addedAt: "2024-01-15T10:00:00.000Z",
      };
      const { writeFile } = await import("node:fs/promises");
      await writeFile(configPath, JSON.stringify({ servers: [serverEntry] }), "utf-8");

      // Our mock just returns the input, so this tests that normalizePath is called
      const result = await findServer("/test/path");

      expect(result).toEqual(serverEntry);
    });
  });

  describe("addServer", () => {
    it("adds new server with correct fields", async () => {
      const result = await addServer("/new/server/path", 4000);

      expect(result).toMatchObject({
        directory: "/new/server/path",
        port: 4000,
        pid: null,
      });
      expect(result.addedAt).toBeDefined();
    });

    it("sets addedAt timestamp in ISO format", async () => {
      const beforeTime = new Date().toISOString();

      const result = await addServer("/test/path", 5000);

      const afterTime = new Date().toISOString();

      // Verify it's a valid ISO string
      expect(() => new Date(result.addedAt)).not.toThrow();
      expect(result.addedAt >= beforeTime).toBe(true);
      expect(result.addedAt <= afterTime).toBe(true);
    });

    it("sets pid to null initially", async () => {
      const result = await addServer("/test/path", 3000);

      expect(result.pid).toBeNull();
    });

    it("persists server to config file", async () => {
      await addServer("/persisted/path", 6000);

      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");
      const savedConfig = JSON.parse(content);

      expect(savedConfig.servers).toHaveLength(1);
      expect(savedConfig.servers[0].directory).toBe("/persisted/path");
      expect(savedConfig.servers[0].port).toBe(6000);
    });

    it("appends to existing servers", async () => {
      // Add first server
      await addServer("/first/path", 3001);

      // Add second server
      await addServer("/second/path", 3002);

      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");
      const savedConfig = JSON.parse(content);

      expect(savedConfig.servers).toHaveLength(2);
      expect(savedConfig.servers[0].directory).toBe("/first/path");
      expect(savedConfig.servers[1].directory).toBe("/second/path");
    });

    it("stores dotfiles option when provided", async () => {
      const result = await addServer("/test/path", 3000, { dotfiles: true });

      expect(result.dotfiles).toBe(true);

      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");
      const savedConfig = JSON.parse(content);

      expect(savedConfig.servers[0].dotfiles).toBe(true);
    });

    it("does not include dotfiles when option is false", async () => {
      const result = await addServer("/test/path", 3000, { dotfiles: false });

      expect(result.dotfiles).toBeUndefined();

      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");
      const savedConfig = JSON.parse(content);

      expect(savedConfig.servers[0].dotfiles).toBeUndefined();
    });

    it("does not include dotfiles when option not provided", async () => {
      const result = await addServer("/test/path", 3000);

      expect(result.dotfiles).toBeUndefined();

      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");
      const savedConfig = JSON.parse(content);

      expect(savedConfig.servers[0].dotfiles).toBeUndefined();
    });
  });

  describe("removeServer", () => {
    it("returns true and removes server when found", async () => {
      // Add a server first
      await addServer("/to/remove", 7000);

      // Verify it exists
      let config = await loadConfig();
      expect(config.servers).toHaveLength(1);

      // Remove it
      const result = await removeServer("/to/remove");

      expect(result).toBe(true);

      // Verify it's gone
      config = await loadConfig();
      expect(config.servers).toHaveLength(0);
    });

    it("returns false when server not found", async () => {
      const result = await removeServer("/non/existent/path");

      expect(result).toBe(false);
    });

    it("preserves other servers when removing one", async () => {
      // Add multiple servers
      await addServer("/keep/this", 3001);
      await addServer("/remove/this", 3002);
      await addServer("/also/keep", 3003);

      // Remove the middle one
      const result = await removeServer("/remove/this");

      expect(result).toBe(true);

      const config = await loadConfig();
      expect(config.servers).toHaveLength(2);
      expect(config.servers.map((s) => s.directory)).toEqual(["/keep/this", "/also/keep"]);
    });

    it("returns false for empty config", async () => {
      const result = await removeServer("/any/path");

      expect(result).toBe(false);
    });
  });

  describe("updateServerPid", () => {
    it("updates pid for existing server", async () => {
      // Add a server
      await addServer("/server/path", 8000);

      // Update its PID
      const result = await updateServerPid("/server/path", 54321);

      expect(result).toBe(true);

      // Verify the PID was updated
      const config = await loadConfig();
      expect(config.servers[0].pid).toBe(54321);
    });

    it("can set pid to null", async () => {
      // Add a server
      await addServer("/server/path", 8000);

      // Set a PID first
      await updateServerPid("/server/path", 12345);

      // Then set it back to null
      const result = await updateServerPid("/server/path", null);

      expect(result).toBe(true);

      const config = await loadConfig();
      expect(config.servers[0].pid).toBeNull();
    });

    it("returns false for non-existent server", async () => {
      const result = await updateServerPid("/non/existent", 99999);

      expect(result).toBe(false);
    });

    it("preserves other server fields when updating pid", async () => {
      const serverData = await addServer("/server/path", 8000);
      const originalAddedAt = serverData.addedAt;

      await updateServerPid("/server/path", 11111);

      const config = await loadConfig();
      const server = config.servers[0];

      expect(server.directory).toBe("/server/path");
      expect(server.port).toBe(8000);
      expect(server.addedAt).toBe(originalAddedAt);
      expect(server.pid).toBe(11111);
    });

    it("only updates the targeted server", async () => {
      // Add multiple servers
      await addServer("/server/one", 3001);
      await addServer("/server/two", 3002);

      // Update only the second one
      await updateServerPid("/server/two", 22222);

      const config = await loadConfig();
      expect(config.servers[0].pid).toBeNull();
      expect(config.servers[1].pid).toBe(22222);
    });
  });

  describe("getAllServers", () => {
    it("returns all server entries", async () => {
      // Add multiple servers
      await addServer("/server/one", 3001);
      await addServer("/server/two", 3002);
      await addServer("/server/three", 3003);

      const servers = await getAllServers();

      expect(servers).toHaveLength(3);
      expect(servers[0].directory).toBe("/server/one");
      expect(servers[1].directory).toBe("/server/two");
      expect(servers[2].directory).toBe("/server/three");
    });

    it("returns empty array when no servers exist", async () => {
      const servers = await getAllServers();

      expect(servers).toEqual([]);
    });

    it("returns servers with all their properties", async () => {
      await addServer("/complete/server", 9000);
      await updateServerPid("/complete/server", 12345);

      const servers = await getAllServers();

      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        directory: "/complete/server",
        port: 9000,
        pid: 12345,
      });
      expect(servers[0].addedAt).toBeDefined();
    });
  });

  describe("findServerForPath", () => {
    it("returns match when path equals server root", async () => {
      await addServer("/projects/repo", 9000);

      const result = await findServerForPath("/projects/repo");

      expect(result).not.toBeNull();
      expect(result.server.directory).toBe("/projects/repo");
      expect(result.subpath).toBe("");
    });

    it("returns match with subpath for nested file", async () => {
      await addServer("/projects/repo", 9000);

      const result = await findServerForPath("/projects/repo/docs/guide.md");

      expect(result).not.toBeNull();
      expect(result.server.directory).toBe("/projects/repo");
      expect(result.subpath).toBe("docs/guide.md");
    });

    it("returns match with subpath for nested directory", async () => {
      await addServer("/projects/repo", 9000);

      const result = await findServerForPath("/projects/repo/docs/subfolder");

      expect(result).not.toBeNull();
      expect(result.subpath).toBe("docs/subfolder");
    });

    it("returns null when path is not under any server", async () => {
      await addServer("/projects/repo", 9000);

      const result = await findServerForPath("/other/path");

      expect(result).toBeNull();
    });

    it("picks deepest match for nested servers", async () => {
      await addServer("/projects/repo", 9000);
      await addServer("/projects/repo/docs", 9001);

      const result = await findServerForPath("/projects/repo/docs/guide.md");

      expect(result.server.directory).toBe("/projects/repo/docs");
      expect(result.server.port).toBe(9001);
      expect(result.subpath).toBe("guide.md");
    });

    it("does not match partial directory names", async () => {
      await addServer("/projects/repo", 9000);

      const result = await findServerForPath("/projects/repo-other/file.md");

      expect(result).toBeNull();
    });

    it("returns null when no servers configured", async () => {
      const result = await findServerForPath("/any/path");

      expect(result).toBeNull();
    });
  });

  describe("clearAllServers", () => {
    it("removes all servers from config", async () => {
      // Add multiple servers
      await addServer("/server/one", 3001);
      await addServer("/server/two", 3002);
      await addServer("/server/three", 3003);

      // Verify they exist
      let servers = await getAllServers();
      expect(servers).toHaveLength(3);

      // Clear all
      await clearAllServers();

      // Verify all are gone
      servers = await getAllServers();
      expect(servers).toHaveLength(0);
    });

    it("works when no servers exist", async () => {
      // Should not throw even if there are no servers
      await clearAllServers();

      const servers = await getAllServers();
      expect(servers).toHaveLength(0);
    });

    it("persists the cleared state to disk", async () => {
      // Add a server first
      await addServer("/server/path", 9000);

      // Clear all
      await clearAllServers();

      // Reload config to verify persistence
      const config = await loadConfig();
      expect(config.servers).toHaveLength(0);
    });
  });
});
