// Keeps a hosted API in step with the simulated readers: for each day up to `until`, sends
// every simulated scan the readers would have delivered by then and the database does not
// already hold, then processes attendance. Safe to run on a timer and after downtime: a scan
// is identified by reader, palm and reader time, so nothing is sent twice.
import type pg from "pg";
import type { Campus } from "./campus.js";
import { compareAttendance, deliverDay, type Transport } from "./runner.js";
import type { AttendanceParameters } from "./scenario.js";
import { simulateDay } from "./scenario.js";
import { seedCampus } from "./seed.js";
import { addDays, datesBetween, dohaTime, todayInDoha } from "./time.js";

export type CatchUpDay = {
  date: string;
  sent: number;
  pending: number;
  /** Set once the whole day has been delivered. */
  mismatches?: number;
};

export async function catchUp(input: {
  campus: Campus;
  pool: pg.Pool;
  transport: Transport;
  parameters: AttendanceParameters;
  from: string;
  until: number;
}): Promise<CatchUpDay[]> {
  const to = todayInDoha(input.until);
  if (input.from > to) return [];
  const { lectureIds } = await seedCampus(input.pool, input.campus, input.from, to);

  const existing = await input.pool.query<{ device_id: string; student_palm: string; time: Date }>(
    `SELECT device_id, student_palm, time FROM time_log WHERE time >= $1 AND time < $2`,
    [new Date(dohaTime(input.from, "00:00")), new Date(dohaTime(addDays(to, 1), "00:00"))],
  );
  const key = (deviceId: string, palm: string, time: number) => `${deviceId}|${palm}|${time}`;
  const sent = new Set(existing.rows.map((r) => key(r.device_id, r.student_palm, r.time.getTime())));

  const results: CatchUpDay[] = [];
  for (const date of datesBetween(input.from, to)) {
    const day = simulateDay(input.campus, date, { parameters: input.parameters });
    const due = day.events.filter((e) => e.deliver_at <= input.until);
    const pending = due.filter((e) => !sent.has(key(e.scan.device_id, e.scan.student_palm, e.device_time)));
    await deliverDay({ ...day, events: pending }, input.transport);

    const result: CatchUpDay = { date, sent: pending.length, pending: day.events.length - due.length };
    if (result.pending === 0) {
      const actual = await input.transport.listAttendance();
      result.mismatches = compareAttendance(day.expected, actual, lectureIds).length;
    }
    results.push(result);
  }
  return results;
}
