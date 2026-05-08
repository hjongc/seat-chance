import type { DayType } from "./types";

export function toTimeSlot(datetime: string): string {
  const { hour, minute } = toKstDateTimeParts(datetime);
  return toHalfHourSlot(hour, minute);
}

function toHalfHourSlot(hour: number, minute: number) {
  const totalMinutes = hour * 60 + minute;
  const roundedMinutes = Math.min(Math.ceil(totalMinutes / 30) * 30, 23 * 60 + 30);
  const nextHour = Math.floor(roundedMinutes / 60);
  const nextMinute = roundedMinutes % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

export function toDayType(datetime: string): DayType {
  const { weekday } = toKstDateTimeParts(datetime);
  return weekday === "Sat" || weekday === "Sun" ? "WEEKEND" : "WEEKDAY";
}

function toKstDateTimeParts(datetime: string) {
  const localMatch = datetime.match(
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::\d{2})?$/
  );
  if (localMatch?.groups) {
    const hour = Number(localMatch.groups.hour);
    const minute = Number(localMatch.groups.minute);
    assertValidTime(hour, minute);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      weekday: "short"
    }).format(
      new Date(
        Date.UTC(Number(localMatch.groups.year), Number(localMatch.groups.month) - 1, Number(localMatch.groups.day))
      )
    );
    return { hour, minute, weekday };
  }

  const date = new Date(datetime);
  if (Number.isNaN(date.getTime())) {
    throw new RecommendationInputError("datetime 값이 올바른 ISO 날짜가 아닙니다.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";

  assertValidTime(hour, minute);
  return { hour, minute, weekday };
}

function assertValidTime(hour: number, minute: number) {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new RecommendationInputError("datetime 값이 올바른 ISO 날짜가 아닙니다.");
  }
}

export class RecommendationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecommendationInputError";
  }
}
