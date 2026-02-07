import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, exec as execCallback } from 'child_process';
import { startServer, stopServer, isServerRunning, openInEdge } from './process.js';

// Mock child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

describe('process.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startServer', () => {
    it('spawns markserv with correct arguments using node and full path', () => {
      const mockChild = {
        pid: 12345,
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      startServer('/path/to/directory', 8080);

      const expectedMarkservPath = `${require('path').dirname(process.execPath)}/markserv`;
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [expectedMarkservPath, '/path/to/directory', '-p', '8080', '--livereloadport', '18080', '--no-browser'],
        {
          cwd: '/',
          detached: true,
          stdio: 'ignore',
        }
      );
    });

    it('returns the PID of the spawned process', () => {
      const mockChild = {
        pid: 54321,
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      const pid = startServer('/some/dir', 3000);

      expect(pid).toBe(54321);
    });

    it('uses detached mode and calls unref', () => {
      const mockChild = {
        pid: 99999,
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      startServer('/test/dir', 4000);

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        })
      );
      expect(mockChild.unref).toHaveBeenCalled();
    });

    it('converts port number to string in arguments', () => {
      const mockChild = {
        pid: 11111,
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      startServer('/dir', 9999);

      const expectedMarkservPath = `${require('path').dirname(process.execPath)}/markserv`;
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [expectedMarkservPath, '/dir', '-p', '9999', '--livereloadport', '19999', '--no-browser'],
        expect.any(Object)
      );
    });

    it('adds --dotfiles allow flag when dotfiles option is true', () => {
      const mockChild = {
        pid: 12345,
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      startServer('/path/to/dir', 8000, { dotfiles: true });

      const expectedMarkservPath = `${require('path').dirname(process.execPath)}/markserv`;
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [expectedMarkservPath, '/path/to/dir', '-p', '8000', '--livereloadport', '18000', '--no-browser', '--dotfiles', 'allow'],
        expect.any(Object)
      );
    });

    it('does not add --dotfiles flag when dotfiles option is false', () => {
      const mockChild = {
        pid: 12345,
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      startServer('/path/to/dir', 8000, { dotfiles: false });

      const expectedMarkservPath = `${require('path').dirname(process.execPath)}/markserv`;
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [expectedMarkservPath, '/path/to/dir', '-p', '8000', '--livereloadport', '18000', '--no-browser'],
        expect.any(Object)
      );
    });

    it('does not add --dotfiles flag when dotfiles option is undefined', () => {
      const mockChild = {
        pid: 12345,
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      startServer('/path/to/dir', 8000, {});

      const expectedMarkservPath = `${require('path').dirname(process.execPath)}/markserv`;
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [expectedMarkservPath, '/path/to/dir', '-p', '8000', '--livereloadport', '18000', '--no-browser'],
        expect.any(Object)
      );
    });
  });

  describe('stopServer', () => {
    let originalKill;

    beforeEach(() => {
      originalKill = process.kill;
    });

    afterEach(() => {
      process.kill = originalKill;
    });

    it('returns true when process is successfully stopped', () => {
      process.kill = vi.fn();

      const result = stopServer(12345);

      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
      expect(result).toBe(true);
    });

    it('returns false when process does not exist (ESRCH)', () => {
      const error = new Error('No such process');
      error.code = 'ESRCH';
      process.kill = vi.fn().mockImplementation(() => {
        throw error;
      });

      const result = stopServer(99999);

      expect(result).toBe(false);
    });

    it('returns false when permission denied (EPERM)', () => {
      const error = new Error('Operation not permitted');
      error.code = 'EPERM';
      process.kill = vi.fn().mockImplementation(() => {
        throw error;
      });

      const result = stopServer(1);

      expect(result).toBe(false);
    });

    it('returns false for other errors', () => {
      const error = new Error('Unknown error');
      error.code = 'UNKNOWN';
      process.kill = vi.fn().mockImplementation(() => {
        throw error;
      });

      const result = stopServer(12345);

      expect(result).toBe(false);
    });
  });

  describe('isServerRunning', () => {
    let originalKill;

    beforeEach(() => {
      originalKill = process.kill;
    });

    afterEach(() => {
      process.kill = originalKill;
    });

    it('returns true for a running process (using current process PID)', () => {
      // Using the actual process.pid to test with a real running process
      process.kill = originalKill;

      const result = isServerRunning(process.pid);

      expect(result).toBe(true);
    });

    it('returns false for a non-existent process (very high PID)', () => {
      // Restore original to test with real behavior
      process.kill = originalKill;

      const result = isServerRunning(999999999);

      expect(result).toBe(false);
    });

    it('returns true when signal 0 succeeds (mocked)', () => {
      process.kill = vi.fn();

      const result = isServerRunning(12345);

      expect(process.kill).toHaveBeenCalledWith(12345, 0);
      expect(result).toBe(true);
    });

    it('returns true when EPERM error occurs (process exists but no permission)', () => {
      const error = new Error('Operation not permitted');
      error.code = 'EPERM';
      process.kill = vi.fn().mockImplementation(() => {
        throw error;
      });

      const result = isServerRunning(1);

      expect(result).toBe(true);
    });

    it('returns false when ESRCH error occurs (process does not exist)', () => {
      const error = new Error('No such process');
      error.code = 'ESRCH';
      process.kill = vi.fn().mockImplementation(() => {
        throw error;
      });

      const result = isServerRunning(99999);

      expect(result).toBe(false);
    });

    it('returns false for other errors', () => {
      const error = new Error('Some other error');
      error.code = 'OTHER';
      process.kill = vi.fn().mockImplementation(() => {
        throw error;
      });

      const result = isServerRunning(12345);

      expect(result).toBe(false);
    });
  });

  describe('openInEdge', () => {
    it('calls exec with correct command for opening URL in Edge', async () => {
      execCallback.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      await openInEdge('http://localhost:8080');

      expect(execCallback).toHaveBeenCalledWith(
        'open -a "Microsoft Edge" "http://localhost:8080"',
        expect.any(Function)
      );
    });

    it('returns a promise that resolves when command completes', async () => {
      execCallback.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      const result = openInEdge('http://localhost:3000');

      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('rejects when exec fails', async () => {
      const error = new Error('Command failed');
      execCallback.mockImplementation((cmd, callback) => {
        callback(error, null);
      });

      await expect(openInEdge('http://localhost:8080')).rejects.toThrow('Command failed');
    });

    it('properly escapes URL in command', async () => {
      execCallback.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      await openInEdge('http://localhost:8080/path?query=value');

      expect(execCallback).toHaveBeenCalledWith(
        'open -a "Microsoft Edge" "http://localhost:8080/path?query=value"',
        expect.any(Function)
      );
    });
  });
});
