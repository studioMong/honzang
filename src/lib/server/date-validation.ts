const OPTIONAL_TIME_SUFFIX = "(?:[T ]+(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d{1,6})?)?(?: ?(?:Z|[+-](?:[01]\\d|2[0-3]):?[0-5]\\d))?)?";
const SEPARATED_DATE_PATTERN = new RegExp(`^(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})${OPTIONAL_TIME_SUFFIX}$`);
const COMPACT_DATE_PATTERN = new RegExp(`^(\\d{4})(\\d{2})(\\d{2})${OPTIONAL_TIME_SUFFIX}$`);

export function parseStrictDate(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const separated = text.match(SEPARATED_DATE_PATTERN);
  if (separated) {
    const [, year, month, day] = separated;
    return validDateParts(Number(year), Number(month), Number(day));
  }

  const compact = text.match(COMPACT_DATE_PATTERN);
  if (compact) {
    const [, year, month, day] = compact;
    return validDateParts(Number(year), Number(month), Number(day));
  }

  return null;
}

export function parseStrictDateTime(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (!parseStrictDate(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateFromStrictDate(value: string | null | undefined) {
  const normalized = parseStrictDate(value);
  return normalized ? new Date(normalized) : null;
}

function validDateParts(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
