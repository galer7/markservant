import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm as fsRm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock paths module to use temp directories
vi.mock('../lib/paths.js', async () => {
  return {
    normalizePath: (dir) => dir || globalThis.__TEST_NORMALIZED_PATH__,
    getConfigDir: () => globalThis.__TEST_CONFIG_DIR__,
    getConfigPath: () => join(globalThis.__TEST_CONFIG_DIR__, 'config.json'),
  };
});

// Mock process module
vi.mock('../lib/process.js', () => ({
  startServer: vi.fn((directory, port) => 12345),
  isServerRunning: vi.fn(() => false),
}));

// Import config after mocking
const { addServer, getAllServers, updateServerPid } = await import('../lib/config.js');
const { startServer, isServerRunning } = await import('../lib/process.js');

// Import the command after all mocks are set up
const { default: startCommand } = await import('./start.js');

describe('start command', () => {
  let testConfigDir;
  let consoleSpy;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testConfigDir = join(tmpdir(), `markservant-start-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
    globalThis.__TEST_NORMALIZED_PATH__ = '/default/path';

    // Clear all mocks
    vi.clearAllMocks();

    // Reset mock implementations to defaults
    startServer.mockImplementation((directory, port) => 12345);
    isServerRunning.mockImplementation(() => false);

    // Mock console.log
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
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

  describe('no servers', () => {
    it('shows "No servers to start" when empty', async () => {
      await startCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('No servers to start')
      );
    });

    it('does not call startServer when no servers exist', async () => {
      await startCommand();

      expect(startServer).not.toHaveBeenCalled();
    });
  });

  describe('starting stopped servers', () => {
    it('starts servers that are not running', async () => {
      await addServer('/test/directory', 9000);

      await startCommand();

      expect(startServer).toHaveBeenCalledWith('/test/directory', 9000);
    });

    it('starts servers with null PIDs', async () => {
      await addServer('/test/directory', 9000);
      // PID is null by default

      await startCommand();

      expect(startServer).toHaveBeenCalledWith('/test/directory', 9000);
    });

    it('updates PID after starting', async () => {
      await addServer('/test/directory', 9000);
      startServer.mockReturnValue(54321);

      await startCommand();

      const servers = await getAllServers();
      expect(servers[0].pid).toBe(54321);
    });

    it('logs started servers with URL and PID', async () => {
      await addServer('/test/directory', 9000);
      startServer.mockReturnValue(54321);

      await startCommand();

      // Check for directory
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('/test/directory')
      );
      // Check for Started message
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Started')
      );
      // Check for URL
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:9000')
      );
      // Check for PID
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('54321')
      );
    });
  });

  describe('already running servers', () => {
    it('skips servers that are already running', async () => {
      await addServer('/test/directory', 9000);

      // Update config to have a PID
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 11111;
      await writeFile(configPath, JSON.stringify(config));

      // Mock isServerRunning to return true
      isServerRunning.mockReturnValue(true);

      await startCommand();

      expect(startServer).not.toHaveBeenCalled();
    });

    it('logs already running servers', async () => {
      await addServer('/test/directory', 9000);

      // Update config to have a PID
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 11111;
      await writeFile(configPath, JSON.stringify(config));

      // Mock isServerRunning to return true
      isServerRunning.mockReturnValue(true);

      await startCommand();

      // Check for directory
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('/test/directory')
      );
      // Check for Already running message
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Already running')
      );
      // Check for port
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('9000')
      );
      // Check for PID
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('11111')
      );
    });

    it('checks isServerRunning with the correct PID', async () => {
      await addServer('/test/directory', 9000);

      // Update config to have a PID
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 99999;
      await writeFile(configPath, JSON.stringify(config));

      // Mock isServerRunning to return true
      isServerRunning.mockReturnValue(true);

      await startCommand();

      expect(isServerRunning).toHaveBeenCalledWith(99999);
    });
  });

  describe('error handling', () => {
    it('handles startServer errors gracefully', async () => {
      await addServer('/test/directory', 9000);
      startServer.mockImplementation(() => {
        throw new Error('Failed to spawn process');
      });

      // Should not throw
      await startCommand();

      // Check for error message
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Failed to spawn process')
      );
    });

    it('continues starting other servers after one fails', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);

      // First server fails, second succeeds
      startServer
        .mockImplementationOnce(() => {
          throw new Error('First server failed');
        })
        .mockImplementationOnce(() => 22222);

      await startCommand();

      expect(startServer).toHaveBeenCalledTimes(2);
      expect(startServer).toHaveBeenCalledWith('/server/one', 9001);
      expect(startServer).toHaveBeenCalledWith('/server/two', 9002);
    });
  });

  describe('summary counts', () => {
    it('shows correct summary when all servers started', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);
      startServer.mockReturnValue(12345);

      await startCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('2 started')
      );
    });

    it('shows correct summary when all servers already running', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);

      // Update config to have PIDs
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 11111;
      config.servers[1].pid = 22222;
      await writeFile(configPath, JSON.stringify(config));

      isServerRunning.mockReturnValue(true);

      await startCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('2 already running')
      );
    });

    it('shows correct summary when all servers fail', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);
      startServer.mockImplementation(() => {
        throw new Error('Failed');
      });

      await startCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('2 failed')
      );
    });

    it('shows correct summary with mixed results', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);
      await addServer('/server/three', 9003);

      // Update config so server/two has a PID (already running)
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[1].pid = 22222;
      await writeFile(configPath, JSON.stringify(config));

      // Server one starts successfully, server two is running, server three fails
      isServerRunning.mockImplementation((pid) => pid === 22222);
      startServer
        .mockImplementationOnce(() => 11111)
        .mockImplementationOnce(() => {
          throw new Error('Failed');
        });

      await startCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('1 started')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('1 already running')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('1 failed')
      );
    });
  });

  describe('mixed running/stopped servers', () => {
    it('handles servers with null PIDs alongside servers with PIDs', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);

      // Update config so server/one has a PID, server/two has null
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 11111;
      // servers[1].pid remains null
      await writeFile(configPath, JSON.stringify(config));

      // Server one is running
      isServerRunning.mockImplementation((pid) => pid === 11111);
      startServer.mockReturnValue(22222);

      await startCommand();

      // Should not try to start server/one (already running)
      // Should start server/two (null PID)
      expect(startServer).toHaveBeenCalledTimes(1);
      expect(startServer).toHaveBeenCalledWith('/server/two', 9002);
    });

    it('starts servers with PIDs of non-running processes', async () => {
      await addServer('/test/directory', 9000);

      // Update config to have a PID
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 99999;
      await writeFile(configPath, JSON.stringify(config));

      // Process is not running (stale PID)
      isServerRunning.mockReturnValue(false);
      startServer.mockReturnValue(88888);

      await startCommand();

      // Should start because process is not running
      expect(startServer).toHaveBeenCalledWith('/test/directory', 9000);
    });
  });

  describe('multiple servers', () => {
    it('starts multiple stopped servers', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);
      await addServer('/server/three', 9003);

      let pidCounter = 10000;
      startServer.mockImplementation(() => ++pidCounter);

      await startCommand();

      expect(startServer).toHaveBeenCalledTimes(3);
      expect(startServer).toHaveBeenCalledWith('/server/one', 9001);
      expect(startServer).toHaveBeenCalledWith('/server/two', 9002);
      expect(startServer).toHaveBeenCalledWith('/server/three', 9003);
    });

    it('updates PIDs for all started servers', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);

      startServer
        .mockReturnValueOnce(11111)
        .mockReturnValueOnce(22222);

      await startCommand();

      const servers = await getAllServers();
      expect(servers[0].pid).toBe(11111);
      expect(servers[1].pid).toBe(22222);
    });
  });
});
