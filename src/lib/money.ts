/** Money conversion between Meta's minor units and the major units people type. Client + server safe, no deps. */

// Currencies Meta stores without minor units (offset 1). Everything else is offset 100.
const ZERO_DECIMAL = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
const offset = (currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100);
export const toMinorUnits = (amount: number, currency: string) => Math.round(amount * offset(currency));
export const fromMinorUnits = (minor: number, currency: string) => minor / offset(currency);
