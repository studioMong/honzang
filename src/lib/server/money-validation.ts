export const MAX_DECIMAL_14_2_AMOUNT = 999_999_999_999.99;

const MONEY_SCALE = 100;
const SCALE_EPSILON = 0.000001;

export function validateDecimal14_2Amount(value: number, label: string) {
  if (!Number.isFinite(value)) {
    return `${label}은 유효한 숫자여야 합니다.`;
  }
  if (value < 0) {
    return `${label}은 0 이상이어야 합니다.`;
  }
  if (value > MAX_DECIMAL_14_2_AMOUNT) {
    return `${label}은 ${MAX_DECIMAL_14_2_AMOUNT.toLocaleString("ko-KR")} 이하만 입력할 수 있습니다.`;
  }
  if (!hasAtMostTwoDecimalPlaces(value)) {
    return `${label}은 소수 둘째 자리까지만 입력할 수 있습니다.`;
  }
  return null;
}

export function moneyToMinorUnits(value: number) {
  return Math.round(value * MONEY_SCALE);
}

export function minorUnitsToMoney(value: number) {
  return value / MONEY_SCALE;
}

function hasAtMostTwoDecimalPlaces(value: number) {
  return Math.abs(value * MONEY_SCALE - Math.round(value * MONEY_SCALE)) < SCALE_EPSILON;
}
