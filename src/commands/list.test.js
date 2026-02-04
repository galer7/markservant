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
  isServerRunning: vi.fn(),
}));

// Import config after mocking
const { addServer, getAllServers } = await import('../lib/config.js');
const { isServerRunning } = await import('../lib/process.js');

// Import the command after all mocks are set up
const { default: listCommand } = await import('./list.js');

describe('list command', () => {
  let testConfigDir;
  let consoleSpy;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testConfigDir = join(tmpdir(), `markservant-list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
    globalThis.__TEST_NORMALIZED_PATH__ = '/default/path';

    // Clear all mocks
    vi.clearAllMocks();

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

  describe('empty server list', () => {
    it('shows "No watched directories" when empty', async () => {
      await listCommand();

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.log).toHaveBeenCalledWith('No watched directories');
    });
  });

  describe('header display', () => {
    it('displays header with correct columns', async () => {
      await addServer('/test/directory', 9000);

      await listCommand();

      // First call should be the header
      const headerCall = consoleSpy.log.mock.calls[0][0];
      expect(headerCall).toContain('Directory');
      expect(headerCall).toContain('Port');
      expect(headerCall).toContain('Status');
      expect(headerCall).toContain('URL');
    });

    it('displays separator line after header', async () => {
      await addServer('/test/directory', 9000);

      await listCommand();

      // Second call should be the separator line
      const separatorCall = consoleSpy.log.mock.calls[1][0];
      expect(separatorCall).toMatch(/^-+$/);
    });
  });

  describe('server status display', () => {
    it('shows servers with running status when PID is active', async () => {
      await addServer('/test/directory', 9000);

      // Update config to add PID
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      // Mock isServerRunning to return true
      isServerRunning.mockReturnValue(true);

      await listCommand();

      expect(isServerRunning).toHaveBeenCalledWith(12345);
      // Third call should be the server entry
      const serverCall = consoleSpy.log.mock.calls[2][0];
      expect(serverCall).toContain('running');
    });

    it('shows servers with stopped status when PID is inactive', async () => {
      await addServer('/test/directory', 9000);

      // Update config to add PID
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 12345;
      await writeFile(configPath, JSON.stringify(config));

      // Mock isServerRunning to return false
      isServerRunning.mockReturnValue(false);

      await listCommand();

      expect(isServerRunning).toHaveBeenCalledWith(12345);
      // Third call should be the server entry
      const serverCall = consoleSpy.log.mock.calls[2][0];
      expect(serverCall).toContain('stopped');
    });

    it('shows stopped status when PID is null', async () => {
      await addServer('/test/directory', 9000);

      await listCommand();

      // isServerRunning should not be called when PID is null
      expect(isServerRunning).not.toHaveBeenCalled();
      // Third call should be the server entry
      const serverCall = consoleSpy.log.mock.calls[2][0];
      expect(serverCall).toContain('stopped');
    });
  });

  describe('URL formatting', () => {
    it('formats URLs correctly with http://localhost:PORT', async () => {
      await addServer('/test/directory', 9000);

      await listCommand();

      // Third call should be the server entry
      const serverCall = consoleSpy.log.mock.calls[2][0];
      expect(serverCall).toContain('http://localhost:9000');
    });

    it('formats URLs correctly for different ports', async () => {
      await addServer('/test/directory', 3456);

      await listCommand();

      const serverCall = consoleSpy.log.mock.calls[2][0];
      expect(serverCall).toContain('http://localhost:3456');
    });
  });

  describe('multiple servers', () => {
    it('handles multiple servers with different statuses', async () => {
      await addServer('/first/directory', 9001);
      await addServer('/second/directory', 9002);
      await addServer('/third/directory', 9003);

      // Update config to add PIDs to some servers
      const configPath = join(testConfigDir, 'config.json');
      const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf-8'));
      config.servers[0].pid = 11111; // running
      config.servers[1].pid = 22222; // stopped
      // servers[2].pid remains null
      await writeFile(configPath, JSON.stringify(config));

      // Mock isServerRunning to return true for first PID, false for second
      isServerRunning.mockImplementation((pid) => pid === 11111);

      await listCommand();

      // Should have header, separator, and 3 server entries (5 calls total)
      expect(consoleSpy.log).toHaveBeenCalledTimes(5);

      // Verify isServerRunning was called for servers with PIDs
      expect(isServerRunning).toHaveBeenCalledWith(11111);
      expect(isServerRunning).toHaveBeenCalledWith(22222);
      expect(isServerRunning).toHaveBeenCalledTimes(2);

      // Verify each server line contains expected data
      const firstServerCall = consoleSpy.log.mock.calls[2][0];
      expect(firstServerCall).toContain('/first/directory');
      expect(firstServerCall).toContain('9001');
      expect(firstServerCall).toContain('running');

      const secondServerCall = consoleSpy.log.mock.calls[3][0];
      expect(secondServerCall).toContain('/second/directory');
      expect(secondServerCall).toContain('9002');
      expect(secondServerCall).toContain('stopped');

      const thirdServerCall = consoleSpy.log.mock.calls[4][0];
      expect(thirdServerCall).toContain('/third/directory');
      expect(thirdServerCall).toContain('9003');
      expect(thirdServerCall).toContain('stopped');
    });

    it('displays all servers in the list', async () => {
      await addServer('/server/one', 9001);
      await addServer('/server/two', 9002);

      await listCommand();

      // Should have header, separator, and 2 server entries
      expect(consoleSpy.log).toHaveBeenCalledTimes(4);

      // Verify all servers are listed
      const allCalls = consoleSpy.log.mock.calls.map((call) => call[0]).join('\n');
      expect(allCalls).toContain('/server/one');
      expect(allCalls).toContain('/server/two');
      expect(allCalls).toContain('9001');
      expect(allCalls).toContain('9002');
    });
  });

  describe('column alignment', () => {
    it('aligns columns based on longest directory path', async () => {
      await addServer('/short', 9001);
      await addServer('/very/long/directory/path/here', 9002);

      await listCommand();

      // Both server entries should be printed
      expect(consoleSpy.log).toHaveBeenCalledTimes(4);

      // The separator line should be long enough to cover all columns
      const separatorCall = consoleSpy.log.mock.calls[1][0];
      expect(separatorCall.length).toBeGreaterThan(40);
    });

    it('aligns columns based on longest port number', async () => {
      await addServer('/test/one', 9);
      await addServer('/test/two', 65535);

      await listCommand();

      // Separator should accommodate the longest port
      const separatorCall = consoleSpy.log.mock.calls[1][0];
      expect(separatorCall.length).toBeGreaterThan(40);
    });
  });

  describe('directory display', () => {
    it('displays full directory path', async () => {
      await addServer('/Users/test/Documents/markdown', 9000);

      await listCommand();

      const serverCall = consoleSpy.log.mock.calls[2][0];
      expect(serverCall).toContain('/Users/test/Documents/markdown');
    });
  });

  describe('port display', () => {
    it('displays port numbers correctly', async () => {
      await addServer('/test/directory', 8080);

      await listCommand();

      const serverCall = consoleSpy.log.mock.calls[2][0];
      expect(serverCall).toContain('8080');
    });
  });
});
