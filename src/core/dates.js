/**
 * Date helpers: `toUtcDateTimeNumber` encodes a Date as the number yyyyMMddHHmmss in UTC (the
 * timestamp format of src/db/transactions-store.js) and `getCalendarDaysBetween` counts calendar
 * days between two dates (used by src/webapp/patches.js for the SBC expiry display).
 *
 * Invariants:
 * - The numeric timestamp format is persisted in the IndexedDB transaction stores and used for
 *   IDBKeyRange queries; changing it breaks stored data and date-range queries.
 * - `getCalendarDaysBetween` compares local calendar dates (time of day ignored) and floors the
 *   difference, so daylight-saving changes do not affect it.
 */
export function toUtcDateTimeNumber(date) {
  return (
    10000000000 * date.getUTCFullYear() +
    100000000 * (date.getUTCMonth() + 1) +
    1000000 * date.getUTCDate() +
    10000 * date.getUTCHours() +
    100 * date.getUTCMinutes() +
    date.getUTCSeconds()
  );
}

export function getCalendarDaysBetween(startDate, endDate) {
  const startDayUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endDayUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.floor((endDayUtc - startDayUtc) / 86400000);
}
