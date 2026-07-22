#!/usr/bin/env node
import { Command } from 'commander';

import { WDF_VERSION } from '@wdf/core';

import { cmdExtract, cmdImport, cmdNew, cmdPack, cmdUnpack, cmdValidate } from './commands.js';

const program = new Command();

program
  .name('wdf')
  .description('Web Document Format tooling (WDF Core 0.1)')
  .version(`wdf ${WDF_VERSION}`);

program
  .command('validate')
  .description('validate a .wdf package against WDF Core 0.1')
  .argument('<file>', 'package file (.wdf)')
  .option('--json', 'machine-readable output')
  .action(async (file: string, opts: { json?: boolean }) => {
    process.exitCode = await cmdValidate(file, opts);
  });

program
  .command('pack')
  .description('build a .wdf package from a source directory (regenerates ai/ and integrity/)')
  .argument('<dir>', 'source directory with manifest.json and content/')
  .option('-o, --output <file>', 'output file')
  .option('--standalone', 'emit a single self-contained HTML file (spec §9)')
  .action(async (dir: string, opts: { output?: string; standalone?: boolean }) => {
    process.exitCode = await cmdPack(dir, opts);
  });

program
  .command('unpack')
  .description('extract a .wdf package to a directory')
  .argument('<file>', 'package file (.wdf)')
  .argument('[dir]', 'target directory (default: package name)')
  .action((file: string, dir: string | undefined) => {
    process.exitCode = cmdUnpack(file, dir);
  });

program
  .command('extract')
  .description('print the AI layer of a package (give this to an LLM)')
  .argument('<file>', 'package file (.wdf)')
  .option('--outline', 'print ai/outline.json instead of ai/content.md')
  .action((file: string, opts: { outline?: boolean }) => {
    process.exitCode = cmdExtract(file, opts);
  });

program
  .command('import')
  .description('best-effort conversion of an HTML/Markdown file or a URL to a valid .wdf package')
  .argument('<file>', 'input file (.html or .md) or an http(s) URL')
  .option('-o, --output <file>', 'output file')
  .option('--title <title>', 'document title (default: from the source)')
  .option('--lang <tag>', 'document language (default: from the source, or "en")')
  .option('--date <iso>', 'created/modified timestamp (default: now)')
  .option('--with-source', 'embed the original input byte-for-byte (extension "source", §10)')
  .option(
    '--embed-fonts',
    'embed open metric-compatible clones of referenced fonts (extension "fonts", §10)',
  )
  .action(
    async (
      file: string,
      opts: {
        output?: string;
        title?: string;
        lang?: string;
        date?: string;
        withSource?: boolean;
        embedFonts?: boolean;
      },
    ) => {
      process.exitCode = await cmdImport(file, opts);
    },
  );

program
  .command('new')
  .description('scaffold a minimal valid document source directory')
  .argument('<dir>', 'directory to create')
  .action((dir: string) => {
    process.exitCode = cmdNew(dir);
  });

await program.parseAsync();
