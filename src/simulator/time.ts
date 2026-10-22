// Campus time is Asia/Qatar, a fixed UTC+3 with no daylight saving.

export const MINUTE = 60_000;
const OFFSET_MS = 3 * 60 * MINUTE;

/** Epoch ms for a Doha wall-clock date ("2026-10-25") and time ("09:30"). */
export function dohaTime(date: string, time: string): number {
  return Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}+03:00`);
}

/** ISO 8601 with the +03:00 offset, the form a Doha reader would report. */
export function toDohaIso(epochMs: number): string {
  const shifted = new Date(Math.round(epochMs) + OFFSET_MS).toISOString();
  return `${shifted.slice(0, 19)}+03:00`;
}

/** 0 = Sunday. */
export function dohaWeekday(date: string): number {
  return new Date(`${date}T12:00:00+03:00`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function todayInDoha(now = Date.now()): string {
  return new Date(now + OFFSET_MS).toISOString().slice(0, 10);
}
