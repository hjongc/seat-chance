import { getHolidays, isHoliday } from "korean-holidays";
import type { DayType } from "./types";

interface KoreaDateParts {
  year: number;
  month: number;
  day: number;
  weekday: string;
}

interface SupplementalHoliday {
  month: number;
  day: number;
  nameKo: string;
}

const koreaDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short"
});

const modernSupplementalHolidays: SupplementalHoliday[] = [
  { month: 5, day: 1, nameKo: "노동절" },
  { month: 7, day: 17, nameKo: "제헌절" }
];

export function currentKoreaDayType(now = new Date()): DayType {
  return dayTypeForKoreaDate(toKoreaDateParts(now));
}

export function currentKoreaDateInputValue(now = new Date()): string {
  const parts = toKoreaDateParts(now);
  return koreaDateInputValue(parts.year, parts.month, parts.day);
}

export function dayTypeForKoreaDateInputValue(value: string): DayType {
  const match = value.match(/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/);
  if (!match?.groups) {
    throw new Error("Korea date input must be formatted as YYYY-MM-DD.");
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  return dayTypeForKoreaDate({
    year,
    month,
    day,
    weekday: weekdayForPlainDate(year, month, day)
  });
}

export function dayTypeForKoreaDate(parts: KoreaDateParts): DayType {
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return "WEEKEND";
  }
  return isKoreanPublicHoliday(parts.year, parts.month, parts.day) ? "WEEKEND" : "WEEKDAY";
}

export function toKoreaDateParts(date: Date): KoreaDateParts {
  const parts = koreaDateFormatter.formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
    weekday: stringPart(parts, "weekday")
  };
}

export function isKoreanPublicHoliday(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return Boolean(isHoliday(date)) || isSupplementalKoreanHoliday(date);
}

function isSupplementalKoreanHoliday(date: Date) {
  const year = date.getFullYear();
  if (year < 2026) {
    return false;
  }

  const dateKey = localDateKey(date);
  if (modernSupplementalHolidays.some((holiday) => dateKey === holidayKey(year, holiday))) {
    return true;
  }

  return supplementalSubstituteHolidayKeys(year).has(dateKey);
}

function supplementalSubstituteHolidayKeys(year: number) {
  const baseHolidays = getHolidays(year);
  const occupiedDateKeys = new Set(baseHolidays.map((holiday) => localDateKey(holiday.date)));
  for (const holiday of modernSupplementalHolidays) {
    occupiedDateKeys.add(holidayKey(year, holiday));
  }

  const substituteDateKeys = new Set<string>();
  for (const holiday of modernSupplementalHolidays) {
    const holidayDate = new Date(year, holiday.month - 1, holiday.day);
    if (!needsSubstituteHoliday(holidayDate, holiday, baseHolidays)) {
      continue;
    }

    let substituteDate = addDays(holidayDate, 1);
    while (
      isWeekend(substituteDate) ||
      occupiedDateKeys.has(localDateKey(substituteDate)) ||
      substituteDateKeys.has(localDateKey(substituteDate))
    ) {
      substituteDate = addDays(substituteDate, 1);
    }
    substituteDateKeys.add(localDateKey(substituteDate));
  }

  return substituteDateKeys;
}

function needsSubstituteHoliday(date: Date, holiday: SupplementalHoliday, baseHolidays: ReturnType<typeof getHolidays>) {
  if (isWeekend(date)) {
    return true;
  }
  return baseHolidays.some(
    (baseHoliday) => sameLocalDate(baseHoliday.date, date) && baseHoliday.nameKo !== holiday.nameKo
  );
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function sameLocalDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function holidayKey(year: number, holiday: SupplementalHoliday) {
  return `${year}-${String(holiday.month).padStart(2, "0")}-${String(holiday.day).padStart(2, "0")}`;
}

function koreaDateInputValue(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekdayForPlainDate(year: number, month: number, day: number) {
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayIndex];
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value;
  const numberValue = Number(value);
  if (Number.isInteger(numberValue)) {
    return numberValue;
  }
  throw new Error(`Korea date part is missing: ${type}`);
}

function stringPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value;
  if (value) {
    return value;
  }
  throw new Error(`Korea date part is missing: ${type}`);
}
