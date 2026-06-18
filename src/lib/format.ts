export function formatKRW(value: number) {
  const hasFraction = Number.isFinite(value) && Math.abs(value - Math.trunc(value)) > 0.000001;
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: hasFraction ? 2 : 0
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export function formatDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(date);
}

export function formatDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
