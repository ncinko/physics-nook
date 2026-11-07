/**
 * Spreadsheet export of sensor runs. DOM-free.
 *
 * `wide` gives each run its own block of columns (t plus one per channel),
 * which is how a sheet is laid out for plotting. `long` is one row per sample
 * with the run named on every row, which is what a pivot table wants. There is
 * no trailing newline so a paste does not end on an empty row.
 */

import { formatNumber, joinRow, type Delimiter } from './delimited.ts';
import type { SensorChannel, SensorRun } from './types.ts';

export type ExportLayout = 'wide' | 'long';

const columnName = (channel: SensorChannel) => `${channel.name} (${channel.unit})`;

export const serializeSensorRuns = (
  runs: readonly SensorRun[],
  options: { delimiter: Delimiter; layout: ExportLayout },
): string => {
  const { delimiter, layout } = options;
  if (runs.length === 0) return '';

  if (layout === 'long') {
    const channelNames: string[] = [];
    runs.forEach((run) =>
      run.channels.forEach((channel) => {
        const name = columnName(channel);
        if (!channelNames.includes(name)) channelNames.push(name);
      }),
    );
    const lines = [joinRow(['run', 't (s)', ...channelNames], delimiter)];
    runs.forEach((run) => {
      const byName = new Map(run.channels.map((channel, index) => [columnName(channel), index]));
      run.t.forEach((time, sample) => {
        lines.push(
          joinRow(
            [
              run.label,
              formatNumber(time, 4),
              ...channelNames.map((name) => {
                const index = byName.get(name);
                return index === undefined ? '' : formatNumber(run.values[index][sample], 4);
              }),
            ],
            delimiter,
          ),
        );
      });
    });
    return lines.join('\n');
  }

  const prefix = (run: SensorRun, column: string) =>
    runs.length > 1 ? `${run.label}: ${column}` : column;
  const header = runs.flatMap((run) => [
    prefix(run, 't (s)'),
    ...run.channels.map((channel) => prefix(run, columnName(channel))),
  ]);
  const height = Math.max(...runs.map((run) => run.t.length));
  const lines = [joinRow(header, delimiter)];
  for (let sample = 0; sample < height; sample += 1) {
    lines.push(
      joinRow(
        runs.flatMap((run) =>
          sample < run.t.length
            ? [
                formatNumber(run.t[sample], 4),
                ...run.channels.map((_, index) => formatNumber(run.values[index][sample], 4)),
              ]
            : ['', ...run.channels.map(() => '')],
        ),
        delimiter,
      ),
    );
  }
  return lines.join('\n');
};
