// Delivers simulated reader traffic to the API the way real readers would: one request per
// live scan, one batch per offline-buffer flush. Then runs the API's processing steps and
// compares the attendance it produced with what the simulation expects.
import type { DeviceScan, ScanEvent } from "./reader.js";
import type { ExpectedAttendance, SimulatedDay } from "./scenario.js";

export type AttendanceRow = {
  lecture_id: number;
  student_id: number;
  status: "present" | "absent";
  scan_time: string | null;
  late_minutes: number | null;
};

export type Transport = {
  sendScan(scan: DeviceScan): Promise<void>;
  sendBatch(scans: DeviceScan[]): Promise<void>;
  processMappings(): Promise<{ mapped_count: number; unmapped_count: number }>;
  processAttendance(range: { from_date: string; to_date: string }): Promise<{
    processed_count: number;
    present_count: number;
    absent_count: number;
  }>;
  listAttendance(): Promise<AttendanceRow[]>;
};

export function httpTransport(baseUrl: string): Transport {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${method} ${path} failed with ${response.status}: ${await response.text()}`);
    }
    return ((await response.json()) as { data: T }).data;
  };

  return {
    sendScan: async (scan) => void (await call("POST", "/time-logs", scan)),
    sendBatch: async (scans) => void (await call("POST", "/time-logs/batch", { scans })),
    processMappings: () => call("POST", "/time-log-mappings/process", {}),
    processAttendance: (range) => call("POST", "/attendance/process", range),
    listAttendance: () => call("GET", "/attendance"),
  };
}

export type Delivery = { buffered: boolean; deliver_at: number; events: ScanEvent[] };

/** Live scans go one by one; scans flushed from the same reader's buffer go together. */
export function groupDeliveries(events: ScanEvent[]): Delivery[] {
  const deliveries: Delivery[] = [];
  const flushes = new Map<string, Delivery>();
  for (const event of events) {
    if (!event.buffered) {
      deliveries.push({ buffered: false, deliver_at: event.deliver_at, events: [event] });
      continue;
    }
    const key = `${event.scan.device_id}|${event.deliver_at}`;
    let flush = flushes.get(key);
    if (!flush) {
      flush = { buffered: true, deliver_at: event.deliver_at, events: [] };
      flushes.set(key, flush);
      deliveries.push(flush);
    }
    flush.events.push(event);
  }
  return deliveries.sort((a, b) => a.deliver_at - b.deliver_at);
}

export type RunOptions = {
  /** 0 = send everything immediately; N = N simulated seconds per real second. */
  speed?: number;
  onDelivery?: (delivery: Delivery) => void;
  /** Re-run mapping and attendance after every delivery, like a live deployment would. */
  processContinuously?: boolean;
};

export async function deliverDay(day: SimulatedDay, transport: Transport, options: RunOptions = {}) {
  const speed = options.speed ?? 0;
  const deliveries = groupDeliveries(day.events);
  let previous = deliveries[0]?.deliver_at ?? 0;

  for (const delivery of deliveries) {
    if (speed > 0) {
      const waitMs = (delivery.deliver_at - previous) / speed;
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      previous = delivery.deliver_at;
    }
    const scans = delivery.events.map((e) => e.scan);
    if (delivery.buffered) await transport.sendBatch(scans);
    else await transport.sendScan(scans[0]);
    options.onDelivery?.(delivery);
    if (options.processContinuously) {
      await transport.processMappings();
      await transport.processAttendance({ from_date: day.date, to_date: day.date });
    }
  }

  const mapping = await transport.processMappings();
  const attendance = await transport.processAttendance({ from_date: day.date, to_date: day.date });
  return { deliveries: deliveries.length, mapping, attendance };
}

export type Mismatch = { expected: ExpectedAttendance; actual: AttendanceRow | undefined };

export function compareAttendance(
  expected: ExpectedAttendance[],
  actual: AttendanceRow[],
  lectureIds: Map<string, number>,
): Mismatch[] {
  // pg returns BIGINT ids as strings.
  const byKey = new Map(actual.map((row) => [`${Number(row.lecture_id)}|${Number(row.student_id)}`, row]));
  const mismatches: Mismatch[] = [];
  for (const exp of expected) {
    const lectureId = lectureIds.get(`${exp.section_key}|${exp.lecture_date}`);
    const row = byKey.get(`${lectureId}|${exp.student_id}`);
    const sameScan =
      exp.scan_time === null
        ? row?.scan_time === null
        : row?.scan_time != null && new Date(row.scan_time).getTime() === exp.scan_time;
    if (!row || row.status !== exp.status || !sameScan || row.late_minutes !== exp.late_minutes) {
      mismatches.push({ expected: exp, actual: row });
    }
  }
  return mismatches;
}

export function summarize(day: SimulatedDay) {
  const count = <T extends string>(values: T[]) =>
    values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
  return {
    date: day.date,
    lectures: day.lectures.length,
    scans: day.events.length,
    buffered_scans: day.events.filter((e) => e.buffered).length,
    rejected_by_reader: day.rejected.length,
    outages: day.outages,
    scans_by_intent: count(day.events.map((e) => e.intent)),
    expected_by_cause: count(day.expected.map((e) => e.cause)),
    present: day.expected.filter((e) => e.status === "present").length,
    absent: day.expected.filter((e) => e.status === "absent").length,
    clock_skew_changed_outcome: day.expected.filter((e) => e.clock_skew_changed_outcome).length,
  };
}
