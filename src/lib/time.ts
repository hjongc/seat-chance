import type { DayType } from "./types";

export function toTimeSlot(datetime: string): string {
  const timeMatch = datetime.match(/T(?<hour>\d{2}):(?<minute>\d{2})/);
  if (timeMatch?.groups) {
    return `${timeMatch.groups.hour}:00`;
  }

  const date = new Date(datetime);
  if (Number.isNaN(date.getTime())) {
    throw new RecommendationInputError("datetime 값이 올바른 ISO 날짜가 아닙니다.");
  }

  return `${String(date.getHours()).padStart(2, "0")}:00`;
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

