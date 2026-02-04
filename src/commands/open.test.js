import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm as fsRm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock paths module
vi.mock('../lib/paths.js', async () => {
  return {
    normalizePath: vi.fn((dir) => {
      if (globalThis.__TEST_THROW_ENOENT__) {
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      }
      if (globalThis.__TEST_THROW_UNEXPECTED__) {
        throw new Error('Unexpected error');
      }
      // Always return the test normalized path when set, otherwise return the input
      return globalThis.__TEST_NORMALIZED_PATH__ || dir;
    }),
    getConfigDir: () => globalThis.__TEST_CONFIG_DIR__,
    getConfigPath: () => join(globalThis.__TEST_CONFIG_DIR__, 'config.json'),
  };
});

// Mock config module
vi.mock('../lib/config.js', () => ({
  findServer: vi.fn(),
}));

// Mock process module
vi.mock('../lib/process.js', () => ({
  openInEdge: vi.fn(),
}));

// Import mocked modules after mocking
const { normalizePath } = await import('../lib/paths.js');
const { findServer } = await import('../lib/config.js');
const { openInEdge } = await import('../lib/process.js');

// Import the command after all mocks are set up
const { default: openCommand } = await import('./open.js');

describe('open command', () => {
  let testConfigDir;
  let consoleSpy;
  let originalExitCode;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testConfigDir = join(tmpdir(), `markservant-open-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
    globalThis.__TEST_NORMALIZED_PATH__ = '/default/path';
    globalThis.__TEST_THROW_ENOENT__ = false;
    globalThis.__TEST_THROW_UNEXPECTED__ = false;

    // Clear all mocks
    vi.clearAllMocks();

    // Mock console.log and console.error
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };

    // Save original exitCode and reset it
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

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
    delete globalThis.__TEST_THROW_ENOENT__;
    delete globalThis.__TEST_THROW_UNEXPECTED__;

    // Restore console
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();

    // Restore original exitCode
    process.exitCode = originalExitCode;
  });

  describe('path normalization', () => {
    it('normalizes directory path correctly', async () => {
      findServer.mockResolvedValue({ port: 9000 });
      openInEdge.mockResolvedValue();

      await openCommand('/some/directory');

      expect(normalizePath).toHaveBeenCalledWith('/some/directory');
    });

    it('uses cwd when no directory provided', async () => {
      findServer.mockResolvedValue({ port: 9000 });
      openInEdge.mockResolvedValue();

      await openCommand();

      expect(normalizePath).toHaveBeenCalledWith(undefined);
    });
  });

  describe('server not found', () => {
    it('shows error when directory not in watch list', async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = '/not/watched';
      findServer.mockResolvedValue(null);

      await openCommand('/not/watched');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Error'),
        expect.stringContaining('/not/watched')
      );
    });

    it('sets process.exitCode = 1 when not found', async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = '/not/watched';
      findServer.mockResolvedValue(null);

      await openCommand('/not/watched');

      expect(process.exitCode).toBe(1);
    });

    it('shows tip to run msv add first', async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = '/not/watched';
      findServer.mockResolvedValue(null);

      await openCommand('/not/watched');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Tip'),
        expect.stringContaining('msv add')
      );
    });

    it('does not call openInEdge when server not found', async () => {
      findServer.mockResolvedValue(null);

      await openCommand('/not/watched');

      expect(openInEdge).not.toHaveBeenCalled();
    });
  });

  describe('server found', () => {
    it('opens correct URL in Edge when found', async () => {
      findServer.mockResolvedValue({ port: 8080 });
      openInEdge.mockResolvedValue();

      await openCommand('/test/directory');

      expect(openInEdge).toHaveBeenCalledWith('http://localhost:8080');
    });

    it('shows success message after opening', async () => {
      findServer.mockResolvedValue({ port: 9000 });
      openInEdge.mockResolvedValue();

      await openCommand('/test/directory');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Opened'),
        expect.stringContaining('http://localhost:9000'),
        expect.stringContaining('Microsoft Edge')
      );
    });

    it('does not set exitCode on success', async () => {
      findServer.mockResolvedValue({ port: 9000 });
      openInEdge.mockResolvedValue();

      await openCommand('/test/directory');

      expect(process.exitCode).toBeUndefined();
    });

    it('handles different port numbers', async () => {
      findServer.mockResolvedValue({ port: 3000 });
      openInEdge.mockResolvedValue();

      await openCommand('/test/directory');

      expect(openInEdge).toHaveBeenCalledWith('http://localhost:3000');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('3000'),
        expect.anything()
      );
    });
  });

  describe('error handling', () => {
    it('handles path resolution errors (ENOENT)', async () => {
      globalThis.__TEST_THROW_ENOENT__ = true;

      await openCommand('/non/existent/path');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Error'),
        expect.stringContaining('does not exist')
      );
      expect(process.exitCode).toBe(1);
    });

    it('shows the provided directory in ENOENT error message', async () => {
      globalThis.__TEST_THROW_ENOENT__ = true;

      await openCommand('/some/missing/directory');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('/some/missing/directory')
      );
    });

    it('shows cwd in ENOENT error message when no directory provided', async () => {
      globalThis.__TEST_THROW_ENOENT__ = true;
      const originalCwd = process.cwd();

      await openCommand();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining(originalCwd)
      );
    });

    it('re-throws unexpected errors', async () => {
      globalThis.__TEST_THROW_UNEXPECTED__ = true;

      await expect(openCommand('/test/directory')).rejects.toThrow('Unexpected error');
    });

    it('does not set exitCode for unexpected errors', async () => {
      globalThis.__TEST_THROW_UNEXPECTED__ = true;

      try {
        await openCommand('/test/directory');
      } catch {
        // Expected to throw
      }

      // exitCode should not be set for unexpected errors (they are re-thrown)
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('findServer integration', () => {
    it('calls findServer with normalized path', async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = '/normalized/path';
      findServer.mockResolvedValue({ port: 9000 });
      openInEdge.mockResolvedValue();

      await openCommand('/raw/path');

      expect(findServer).toHaveBeenCalledWith('/normalized/path');
    });
  });
});
