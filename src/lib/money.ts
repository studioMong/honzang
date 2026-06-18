export const MAX_DECIMAL_14_2_AMOUNT = 999_999_999_999.99;

const MONEY_SCALE = 100;
const SCALE_EPSILON = 0.000001;

export function moneyToMinorUnits(value: number) {
  return Math.round(value * MONEY_SCALE);
}

export function minorUnitsToMoney(value: number) {
  return value / MONEY_SCALE;
}

export function hasAtMostTwoDecimalPlaces(value: number) {
  return Math.abs(value * MONEY_SCALE - Math.round(value * MONEY_SCALE)) < SCALE_EPSILON;
}
