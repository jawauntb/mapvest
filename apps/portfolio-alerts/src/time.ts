export type LocalParts = {
  date: string; // YYYY-MM-DD
  hour: number;
  weekday: number; // 0 = Sunday
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

export function localDate(at: Date, timeZone: string): string {
  return localParts(at, timeZone).date;
}

export const isFriday = (parts: LocalParts) => parts.weekday === 5;
export const isWeekday = (parts: LocalParts) => parts.weekday >= 1 && parts.weekday <= 5;
