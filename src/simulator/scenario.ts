// Generates one simulated teaching day: who turns up, when they scan, which reader they use,
// reader outages, and stray scans. It also derives the attendance the API should produce,
// independently of the API's SQL, so a run can be checked end to end.
import {
  type BehaviourProfile,
  type Campus,
  type SimLecture,
  type SimStudent,
  lecturesBetween,
  readerForRoom,
} from "./campus.js";
import { createRng } from "./random.js";
import { type ScanEvent, type ScanIntent, VirtualReader } from "./reader.js";
import { MINUTE, dohaTime } from "./time.js";

export type AttendanceParameters = { before: number; after: number | null };

export type ExpectedCause =
  | "counted"
  | "skipped_class"
  | "forgot_to_scan"
  | "palm_not_linked"
  | "palm_not_enrolled"
  | "scanned_outside_window"
  | "scanned_wrong_reader";

export type ExpectedAttendance = {
  section_key: string;
  lecture_date: string;
  student_id: number;
  status: "present" | "absent";
  /** Device time of the scan that should count, epoch ms. */
  scan_time: number | null;
  late_minutes: number | null;
  cause: ExpectedCause;
  /** The reader's clock drift changed the outcome compared with true time. */
  clock_skew_changed_outcome: boolean;
};

export type SimulatedDay = {
  date: string;
  lectures: SimLecture[];
  events: ScanEvent[];
  expected: ExpectedAttendance[];
  outages: { device_id: string; from: number; to: number }[];
  rejected: { student_id: number; section_key: string; true_time: number }[];
};

export type DayOptions = {
  parameters?: AttendanceParameters;
  outages?: boolean;
};

const PROFILES: Record<BehaviourProfile, { attend: number; mean: number; spread: number }> = {
  punctual: { attend: 0.97, mean: -5, spread: 3 },
  typical: { attend: 0.9, mean: -3, spread: 4 },
  late_prone: { attend: 0.85, mean: 7, spread: 8 },
  disengaged: { attend: 0.6, mean: 10, spread: 12 },
};

export function simulateDay(campus: Campus, date: string, options: DayOptions = {}): SimulatedDay {
  const params = options.parameters ?? { before: 10, after: 20 };
  const rng = createRng(`day:${campus.seed}:${date}`);
  const readers = new Map(
    campus.readers.map((r) => [r.device_id, new VirtualReader(r, () => rng.int(300, 2000))]),
  );
  const roomReaders = campus.readers.filter((r) => r.room !== null);
  const corridor = campus.readers.find((r) => r.room === null);

  const lectures = lecturesBetween(campus, date, date);

  // About half the days, one classroom reader loses the network around a lecture.
  const outages: SimulatedDay["outages"] = [];
  if (options.outages !== false && lectures.length && rng.chance(0.5)) {
    const lecture = rng.pick(lectures);
    const reader = readerForRoom(campus, lecture.room)!;
    const from = lecture.start - rng.int(5, 25) * MINUTE;
    const to = from + rng.int(40, 90) * MINUTE;
    readers.get(reader.device_id)!.goOffline(from, to);
    outages.push({ device_id: reader.device_id, from, to });
  }
  const events: ScanEvent[] = [];
  const rejected: SimulatedDay["rejected"] = [];
  const intention = new Map<string, ExpectedCause>();
  const key = (sectionKey: string, studentId: number) => `${sectionKey}|${studentId}`;

  const capture = (
    deviceId: string,
    student: SimStudent | null,
    palm: string | null,
    trueTime: number,
    intent: ScanIntent,
    sectionKey: string | null,
  ) => {
    const event = readers.get(deviceId)!.capture({
      palm,
      trueTime,
      intent,
      studentId: student?.student_id ?? null,
      sectionKey,
    });
    if (event) events.push(event);
    else if (student && sectionKey) {
      rejected.push({ student_id: student.student_id, section_key: sectionKey, true_time: trueTime });
    }
  };

  const intentFor = (offsetMinutes: number): ScanIntent => {
    if (offsetMinutes < -params.before) return "early";
    if (offsetMinutes <= 0) return "on_time";
    if (offsetMinutes <= (params.after ?? 20)) return "late";
    return "very_late";
  };

  for (const lecture of lectures) {
    const reader = readerForRoom(campus, lecture.room)!;
    const duration = (lecture.end - lecture.start) / MINUTE;
    for (const student of campus.students) {
      if (!student.sections.includes(lecture.section_key)) continue;
      const profile = PROFILES[student.profile];
      const k = key(lecture.section_key, student.student_id);

      if (!rng.chance(profile.attend)) {
        intention.set(k, "skipped_class");
        continue;
      }
      if (rng.chance(0.02)) {
        intention.set(k, "forgot_to_scan");
        continue;
      }

      const offset = Math.min(Math.max(rng.normal(profile.mean, profile.spread), -35), duration - 5);
      const trueTime = lecture.start + offset * MINUTE + rng.int(0, 59) * 1000;
      const palm = student.palm_status === "not_enrolled" ? null : student.student_palm;

      const detour = rng.next();
      if (detour < 0.02) {
        const other = rng.pick(roomReaders.filter((r) => r.device_id !== reader.device_id));
        capture(other.device_id, student, palm, trueTime, "wrong_room", lecture.section_key);
        if (rng.chance(0.6)) {
          const retry = trueTime + rng.int(60, 150) * 1000;
          capture(reader.device_id, student, palm, retry, intentFor((retry - lecture.start) / MINUTE), lecture.section_key);
        }
      } else if (detour < 0.03 && corridor) {
        capture(corridor.device_id, student, palm, trueTime, "corridor_reader", lecture.section_key);
        if (rng.chance(0.7)) {
          const retry = trueTime + rng.int(60, 180) * 1000;
          capture(reader.device_id, student, palm, retry, intentFor((retry - lecture.start) / MINUTE), lecture.section_key);
        }
      } else {
        capture(reader.device_id, student, palm, trueTime, intentFor(offset), lecture.section_key);
      }

      if (rng.chance(0.06)) {
        const again = trueTime + rng.int(30, 180) * 1000;
        capture(reader.device_id, student, palm, again, "duplicate", lecture.section_key);
      }
    }
  }

  // Staff, guests and vendor test palms enrolled on a reader but unknown to palm_reg.
  for (let i = rng.int(3, 6); i > 0; i -= 1) {
    const reader = rng.pick(campus.readers);
    const visitorPalm = `PV-VIS${rng.int(0, 0xfffff).toString(16).padStart(5, "0").toUpperCase()}`;
    capture(reader.device_id, null, visitorPalm, dohaTime(date, "08:00") + rng.int(0, 8 * 60) * MINUTE, "visitor", null);
  }

  // Students scanning out of curiosity around lunch, outside any class.
  const scanners = rng.shuffle(campus.students.filter((s) => s.palm_status !== "not_enrolled"));
  for (const student of scanners.slice(0, Math.min(8, scanners.length))) {
    const reader = rng.pick(roomReaders);
    capture(reader.device_id, student, student.student_palm, dohaTime(date, "12:20") + rng.int(0, 80) * MINUTE, "walk_by", null);
  }

  events.sort((a, b) => a.deliver_at - b.deliver_at || a.true_time - b.true_time);

  return {
    date,
    lectures,
    events,
    expected: expectAttendance(campus, lectures, events, params, intention),
    outages,
    rejected,
  };
}

function expectAttendance(
  campus: Campus,
  lectures: SimLecture[],
  events: ScanEvent[],
  params: AttendanceParameters,
  intention: Map<string, ExpectedCause>,
): ExpectedAttendance[] {
  const roomOf = new Map(campus.readers.map((r) => [r.device_id, r.room]));
  const expected: ExpectedAttendance[] = [];

  for (const lecture of lectures) {
    const from = lecture.start - params.before * MINUTE;
    const to = params.after === null ? lecture.end : lecture.start + params.after * MINUTE;
    const inWindow = (t: number) => t >= from && t <= to;

    for (const student of campus.students) {
      if (!student.sections.includes(lecture.section_key)) continue;
      const mine = events.filter((e) => e.scan.student_palm === student.student_palm);
      const inRoom = mine.filter((e) => roomOf.get(e.scan.device_id) === lecture.room);
      const counted = inRoom
        .filter((e) => inWindow(e.device_time))
        .sort((a, b) => a.device_time - b.device_time)[0];
      const countedByTrueTime = inRoom.some((e) => inWindow(e.true_time));

      const base = {
        section_key: lecture.section_key,
        lecture_date: lecture.lecture_date,
        student_id: student.student_id,
      };

      if (counted && student.palm_status === "linked") {
        const late = Math.max(0, Math.floor((counted.device_time - lecture.start) / MINUTE));
        expected.push({
          ...base,
          status: "present",
          scan_time: counted.device_time,
          late_minutes: params.after === null ? late : null,
          cause: "counted",
          clock_skew_changed_outcome: !countedByTrueTime,
        });
        continue;
      }

      const forLecture = mine.filter((e) => e.section_key === lecture.section_key);
      let cause: ExpectedCause;
      if (student.palm_status === "unlinked" && forLecture.length) cause = "palm_not_linked";
      else if (student.palm_status === "not_enrolled" && intention.get(`${lecture.section_key}|${student.student_id}`) === undefined)
        cause = "palm_not_enrolled";
      else if (forLecture.length && forLecture.every((e) => roomOf.get(e.scan.device_id) !== lecture.room))
        cause = "scanned_wrong_reader";
      else if (forLecture.length) cause = "scanned_outside_window";
      else cause = intention.get(`${lecture.section_key}|${student.student_id}`) ?? "skipped_class";

      expected.push({
        ...base,
        status: "absent",
        scan_time: null,
        late_minutes: null,
        cause,
        clock_skew_changed_outcome: student.palm_status === "linked" && countedByTrueTime,
      });
    }
  }

  return expected;
}
