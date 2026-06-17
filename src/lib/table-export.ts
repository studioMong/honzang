import { sanitizeCsvCellValue } from "@/lib/export-safety";

export type TableRow = Record<string, string | number>;

export function toCsv(rows: TableRow[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: string | number | null | undefined) => {
    const text = sanitizeCsvCellValue(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(","))].join("\n");
}

export function toCsvFileContent(rows: TableRow[]) {
  return `\uFEFF${toCsv(rows)}`;
}
