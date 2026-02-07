#!/usr/bin/env node

import { createRequire } from 'node:module';
import { program } from 'commander';

import addCommand from '../src/commands/add.js';
import rmCommand from '../src/commands/rm.js';
import listCommand from '../src/commands/list.js';
import openCommand from '../src/commands/open.js';
import startCommand from '../src/commands/start.js';
import stopCommand from '../src/commands/stop.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

program
  .name('msv')
  .description('CLI tool to manage multiple markserv instances with persistence')
  .version(version);

program
  .command('add [directory]')
  .description('Add a directory to the watch list and start markserv')
  .option('--no-dotfiles', 'Hide dotfiles in directory listings')
  .action(addCommand);

program
  .command('rm [directory]')
  .description('Remove a directory from the watch list')
  .option('-a, --all', 'Remove all servers from the watch list')
  .action(rmCommand);

program
  .command('list')
  .description('Show all watched directories with status')
  .action(listCommand);

program
  .command('open [directory]')
  .description('Open the markserv URL in Microsoft Edge')
  .action(openCommand);

program
  .command('start')
  .description('Start all servers in watch list')
  .action(startCommand);

program
  .command('stop')
  .description('Stop all running markserv instances')
  .action(stopCommand);

program.parse(process.argv);
