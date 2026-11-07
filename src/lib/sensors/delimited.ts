/**
 * Delimited-text helpers shared by every spreadsheet export. DOM-free.
 */

export type Delimiter = '\t' | ',';

/**
 * One cell of text. A comma-separated file quotes anything that could break a
 * row; a tab-separated one cannot quote, so it drops the characters that would.
 */
export const cell = (text: string, delimiter: Delimiter): string => {
  if (delimiter === '\t') return text.replace(/[\t\r\n]+/g, ' ');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const formatNumber = (value: number | null, digits: number): string =>
  value === null || !Number.isFinite(value) ? '' : value.toFixed(digits);

export const joinRow = (cells: string[], delimiter: Delimiter): string =>
  cells.map((entry) => cell(entry, delimiter)).join(delimiter);
