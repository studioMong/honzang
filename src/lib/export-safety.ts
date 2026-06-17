const CSV_FORMULA_PATTERN = /^\s*[=+\-@\t\r\n]/;

export function sanitizeCsvCellValue(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = String(value ?? "");
  return CSV_FORMULA_PATTERN.test(text) ? `'${text}` : text;
}
