import type { DayType } from "./types";

export function toTimeSlot(datetime: string): string {
  const timeMatch = datetime.match(/T(?<hour>\d{2}):(?<minute>\d{2})/);
  if (timeMatch?.groups) {
    return toHalfHourSlot(Number(timeMatch.groups.hour), Number(timeMatch.groups.minute));
  }

  const date = new Date(datetime);
  if (Number.isNaN(date.getTime())) {
    throw new RecommendationInputError("datetime 값이 올바른 ISO 날짜가 아닙니다.");
  }

  return toHalfHourSlot(date.getHours(), date.getMinutes());
}

function toHalfHourSlot(hour: number, minute: number) {
  const totalMinutes = hour * 60 + minute;
  const roundedMinutes = Math.min(Math.ceil(totalMinutes / 30) * 30, 23 * 60 + 30);
  const nextHour = Math.floor(roundedMinutes / 60);
  const nextMinute = roundedMinutes % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

export function toDayType(datetime: string): DayType {
  const date = new Date(datetime);
  if (Number.isNaN(date.getTime())) {
    throw new RecommendationInputError("datetime 값이 올바른 ISO 날짜가 아닙니다.");
  }

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short"
  }).format(date);

  return weekday === "Sat" || weekday === "Sun" ? "WEEKEND" : "WEEKDAY";
}

export class RecommendationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecommendationInputError";
  }
}
