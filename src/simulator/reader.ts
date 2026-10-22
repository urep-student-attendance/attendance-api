// A virtual WavePass500 palm reader. It matches the palm itself, stamps the scan with its
// own (possibly drifting) clock, and buffers scans while its network is down.
import type { SimReader } from "./campus.js";
import { toDohaIso } from "./time.js";

/** What a reader sends to POST /time-logs. */
export type DeviceScan = {
  device_id: string;
  student_palm: string;
  scan_time: string;
};

export type ScanIntent =
  | "on_time"
  | "early"
  | "late"
  | "very_late"
  | "duplicate"
  | "wrong_room"
  | "corridor_reader"
  | "visitor"
  | "walk_by";

export type ScanEvent = {
  scan: DeviceScan;
  /** When the palm was actually on the reader. */
  true_time: number;
  /** The reader's clock at that moment; this is what the server sees. */
  device_time: number;
  /** When the server receives it. */
  deliver_at: number;
  /** true = held in the reader's offline buffer and flushed later. */
  buffered: boolean;
  intent: ScanIntent;
  student_id: number | null;
  section_key: string | null;
};

export type Outage = { from: number; to: number };

export class VirtualReader {
  readonly outages: Outage[] = [];

  constructor(
    readonly reader: SimReader,
    private readonly latencyMs: () => number = () => 800,
  ) {}

  get deviceId() {
    return this.reader.device_id;
  }

  goOffline(from: number, to: number) {
    this.outages.push({ from, to });
  }

  /** Returns null when the reader rejects the palm (not enrolled on the device). */
  capture(input: {
    palm: string | null;
    trueTime: number;
    intent: ScanIntent;
    studentId: number | null;
    sectionKey: string | null;
  }): ScanEvent | null {
    if (input.palm === null) return null;

    const deviceTime = input.trueTime + this.reader.clock_skew_seconds * 1000;
    const outage = this.outages.find((o) => input.trueTime >= o.from && input.trueTime < o.to);
    const deliverAt = outage ? outage.to + 5_000 : input.trueTime + this.latencyMs();

    return {
      scan: {
        device_id: this.reader.device_id,
        student_palm: input.palm,
        // Readers report whole seconds.
        scan_time: toDohaIso(Math.floor(deviceTime / 1000) * 1000),
      },
      true_time: input.trueTime,
      device_time: Math.floor(deviceTime / 1000) * 1000,
      deliver_at: deliverAt,
      buffered: Boolean(outage),
      intent: input.intent,
      student_id: input.studentId,
      section_key: input.sectionKey,
    };
  }
}
