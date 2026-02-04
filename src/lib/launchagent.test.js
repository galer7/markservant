import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Store original process.argv
const originalArgv = [...process.argv];

// Mock the paths module to use temp directories
vi.mock('./paths.js', async () => {
  return {
    getLaunchAgentPath: () => join(globalThis.__TEST_LAUNCH_AGENTS_DIR__, 'com.markservant.plist'),
  };
});

// Mock child_process module
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Import after mocking
const { execSync } = await import('node:child_process');
const { installLaunchAgent, uninstallLaunchAgent, isLaunchAgentInstalled } = await import('./launchagent.js');

describe('launchagent.js', () => {
  let testLaunchAgentsDir;

  beforeEach(async () => {
    // Reset all mocks including implementations
    vi.resetAllMocks();

    // Create a unique temp directory for each test
    testLaunchAgentsDir = join(tmpdir(), `markservant-test-launchagent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    globalThis.__TEST_LAUNCH_AGENTS_DIR__ = testLaunchAgentsDir;

    // Set up process.argv[1] to simulate the msv binary path
    process.argv[1] = '/usr/local/bin/msv';
  });

  afterEach(async () => {
    // Clean up the temp directory after each test
    if (existsSync(testLaunchAgentsDir)) {
      await rm(testLaunchAgentsDir, { recursive: true, force: true });
    }
    delete globalThis.__TEST_LAUNCH_AGENTS_DIR__;

    // Restore original process.argv
    process.argv = [...originalArgv];
  });

  describe('installLaunchAgent', () => {
    it('creates LaunchAgents directory if it does not exist', () => {
      expect(existsSync(testLaunchAgentsDir)).toBe(false);

      installLaunchAgent();

      expect(existsSync(testLaunchAgentsDir)).toBe(true);
    });

    it('writes correct plist content with msv binary path', async () => {
      installLaunchAgent();

      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      const content = await readFile(plistPath, 'utf-8');

      // Check for XML declaration
      expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(content).toContain('<!DOCTYPE plist PUBLIC');

      // Check for plist structure
      expect(content).toContain('<plist version="1.0">');
      expect(content).toContain('<dict>');
      expect(content).toContain('</dict>');
      expect(content).toContain('</plist>');

      // Check for label
      expect(content).toContain('<key>Label</key>');
      expect(content).toContain('<string>com.markservant</string>');

      // Check for program arguments with msv path
      expect(content).toContain('<key>ProgramArguments</key>');
      expect(content).toContain('<string>/usr/local/bin/msv</string>');
      expect(content).toContain('<string>start</string>');

      // Check for RunAtLoad
      expect(content).toContain('<key>RunAtLoad</key>');
      expect(content).toContain('<true/>');
    });

    it('uses the current process.argv[1] for msv binary path', async () => {
      // Change the binary path
      process.argv[1] = '/custom/path/to/msv';

      installLaunchAgent();

      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      const content = await readFile(plistPath, 'utf-8');

      expect(content).toContain('<string>/custom/path/to/msv</string>');
    });

    it('calls launchctl load with correct plist path', () => {
      installLaunchAgent();

      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      expect(execSync).toHaveBeenCalledWith(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
    });

    it('returns true on success', () => {
      const result = installLaunchAgent();

      expect(result).toBe(true);
    });

    it('cleans up plist if launchctl load fails', () => {
      const error = new Error('launchctl failed');
      execSync.mockImplementation(() => {
        throw error;
      });

      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');

      expect(() => installLaunchAgent()).toThrow();

      // The plist should be cleaned up after failure
      expect(existsSync(plistPath)).toBe(false);
    });

    it('throws error with message when launchctl fails', () => {
      const error = new Error('Service already loaded');
      execSync.mockImplementation(() => {
        throw error;
      });

      expect(() => installLaunchAgent()).toThrow('Failed to load LaunchAgent: Service already loaded');
    });

    it('overwrites existing plist file', async () => {
      // Create directory and an existing plist
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      writeFileSync(plistPath, 'old content', 'utf-8');

      installLaunchAgent();

      const content = await readFile(plistPath, 'utf-8');
      expect(content).not.toBe('old content');
      expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    });

    it('does not create directory if it already exists', async () => {
      // Create the directory first
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const statBefore = existsSync(testLaunchAgentsDir);

      installLaunchAgent();

      const statAfter = existsSync(testLaunchAgentsDir);
      expect(statBefore).toBe(true);
      expect(statAfter).toBe(true);
    });
  });

  describe('uninstallLaunchAgent', () => {
    it('returns false if plist does not exist', () => {
      const result = uninstallLaunchAgent();

      expect(result).toBe(false);
    });

    it('calls launchctl unload with correct plist path', async () => {
      // Create the plist file first
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      writeFileSync(plistPath, 'plist content', 'utf-8');

      uninstallLaunchAgent();

      expect(execSync).toHaveBeenCalledWith(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
    });

    it('deletes the plist file', async () => {
      // Create the plist file first
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      writeFileSync(plistPath, 'plist content', 'utf-8');

      expect(existsSync(plistPath)).toBe(true);

      uninstallLaunchAgent();

      expect(existsSync(plistPath)).toBe(false);
    });

    it('returns true on success', async () => {
      // Create the plist file first
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      writeFileSync(plistPath, 'plist content', 'utf-8');

      const result = uninstallLaunchAgent();

      expect(result).toBe(true);
    });

    it('handles launchctl unload failure gracefully', async () => {
      // Create the plist file first
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      writeFileSync(plistPath, 'plist content', 'utf-8');

      const error = new Error('Could not find service');
      execSync.mockImplementation(() => {
        throw error;
      });

      // Should not throw even if launchctl fails
      const result = uninstallLaunchAgent();

      expect(result).toBe(true);
      // File should still be deleted
      expect(existsSync(plistPath)).toBe(false);
    });

    it('deletes plist even when agent was not loaded', async () => {
      // Create the plist file first
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      writeFileSync(plistPath, 'plist content', 'utf-8');

      // Simulate launchctl unload failing because agent wasn't loaded
      const error = new Error('No such process');
      execSync.mockImplementation(() => {
        throw error;
      });

      const result = uninstallLaunchAgent();

      expect(result).toBe(true);
      expect(existsSync(plistPath)).toBe(false);
    });

    it('does not call launchctl if plist does not exist', () => {
      uninstallLaunchAgent();

      expect(execSync).not.toHaveBeenCalled();
    });
  });

  describe('isLaunchAgentInstalled', () => {
    it('returns true if plist exists', async () => {
      // Create the plist file
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      writeFileSync(plistPath, 'plist content', 'utf-8');

      const result = isLaunchAgentInstalled();

      expect(result).toBe(true);
    });

    it('returns false if plist does not exist', () => {
      const result = isLaunchAgentInstalled();

      expect(result).toBe(false);
    });

    it('returns false if directory exists but plist does not', async () => {
      // Create the directory but not the plist
      await mkdir(testLaunchAgentsDir, { recursive: true });

      const result = isLaunchAgentInstalled();

      expect(result).toBe(false);
    });

    it('returns true after successful install', () => {
      expect(isLaunchAgentInstalled()).toBe(false);

      installLaunchAgent();

      expect(isLaunchAgentInstalled()).toBe(true);
    });

    it('returns false after successful uninstall', async () => {
      // Create the plist file first
      await mkdir(testLaunchAgentsDir, { recursive: true });
      const plistPath = join(testLaunchAgentsDir, 'com.markservant.plist');
      writeFileSync(plistPath, 'plist content', 'utf-8');

      expect(isLaunchAgentInstalled()).toBe(true);

      uninstallLaunchAgent();

      expect(isLaunchAgentInstalled()).toBe(false);
    });
  });
});
