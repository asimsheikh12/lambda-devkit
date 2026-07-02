import pc from 'picocolors';
import { loadConfig } from '../config/load.js';
import type { MergedConfig } from '../config/merge.js';

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export async function runListCommand(
  cwd: string = process.cwd(),
  options: { reloadConfig?: boolean } = {},
): Promise<number> {
  const config = await loadConfig(cwd, options.reloadConfig ? { reload: true } : undefined);

  const rows = config.functions.map((fn) => ({
    name: fn.name,
    entry: fn.entry,
    trigger: fn.trigger,
  }));

  const nameWidth = Math.max(4, ...rows.map((row) => row.name.length));
  const entryWidth = Math.max(5, ...rows.map((row) => row.entry.length));
  const triggerWidth = Math.max(7, ...rows.map((row) => row.trigger.length));

  console.log(
    `${pad('NAME', nameWidth)}  ${pad('ENTRY', entryWidth)}  ${pad('TRIGGER', triggerWidth)}`,
  );
  console.log(pc.dim('-'.repeat(nameWidth + entryWidth + triggerWidth + 4)));

  for (const row of rows) {
    console.log(
      `${pad(row.name, nameWidth)}  ${pad(row.entry, entryWidth)}  ${pad(row.trigger, triggerWidth)}`,
    );
  }

  return 0;
}

export type { MergedConfig };
