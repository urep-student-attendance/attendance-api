// A fictional but realistic UDST-style campus: rooms with WavePass500 readers, a
// Sunday-Thursday timetable, students with palm enrolments and section registrations.
// Everything is derived from a seed, so the same seed always gives the same campus.
import { createRng } from "./random.js";
import { datesBetween, dohaTime, dohaWeekday } from "./time.js";

export type SimRoom = { room: string };

export type SimReader = {
  device_id: string;
  model: string;
  /** null = installed but not linked in device_room yet. */
  room: string | null;
  /** Reader clock minus true time, in seconds. Readers drift unless synced. */
  clock_skew_seconds: number;
};

export type SimCourse = { subject: string; course_num: string; title: string };

export type SimSection = {
  key: string;
  subject: string;
  course_num: string;
  section: string;
  room: string;
  /** Doha weekdays, 0 = Sunday. */
  days: number[];
  start_time: string;
  end_time: string;
  instructor: string;
};

export type BehaviourProfile = "punctual" | "typical" | "late_prone" | "disengaged";

/**
 * linked: palm enrolled on the reader and linked to the student ID in palm_reg.
 * unlinked: enrolled on the reader, but the registration desk never linked it, so scans stay unmapped.
 * not_enrolled: never enrolled, the reader rejects the palm and sends nothing.
 */
export type PalmStatus = "linked" | "unlinked" | "not_enrolled";

export type SimStudent = {
  student_id: number;
  /** Fictional, for the app's display only. */
  name: string;
  program: string;
  /** When the registration desk enrolled the palm, epoch ms (orientation week). */
  palm_registered_at: number;
  student_palm: string;
  palm_status: PalmStatus;
  profile: BehaviourProfile;
  sections: string[];
};

export type SimLecture = {
  section_key: string;
  lecture_date: string;
  start_time: string;
  end_time: string;
  start: number;
  end: number;
  room: string;
};

export type Campus = {
  seed: string;
  academic_year: number;
  semester: number;
  rooms: SimRoom[];
  readers: SimReader[];
  courses: SimCourse[];
  sections: SimSection[];
  students: SimStudent[];
};

export type CampusOptions = {
  seed?: string;
  students?: number;
  academicYear?: number;
  semester?: number;
};

const ROOMS = ["10.2.33", "10.2.35", "10.1.08", "10.3.12", "05.1.20", "05.2.14"];

const READERS: SimReader[] = [
  { device_id: "WP500-Q24A0101", model: "WavePass500", room: "10.2.33", clock_skew_seconds: 0 },
  { device_id: "WP500-Q24A0102", model: "WavePass500", room: "10.2.35", clock_skew_seconds: 4 },
  { device_id: "WP500-Q24A0103", model: "WavePass500", room: "10.1.08", clock_skew_seconds: 95 },
  { device_id: "WP500-Q24A0104", model: "WavePass500", room: "10.3.12", clock_skew_seconds: -2 },
  { device_id: "WP500-Q24A0105", model: "WavePass500", room: "05.1.20", clock_skew_seconds: 0 },
  { device_id: "WP500-Q24A0106", model: "WavePass500", room: "05.2.14", clock_skew_seconds: 1 },
  // Mounted in the building 10 corridor but never added to device_room.
  { device_id: "WP500-Q24A0107", model: "WavePass500", room: null, clock_skew_seconds: 0 },
];

const COURSES: SimCourse[] = [
  { subject: "INFS", course_num: "1201", title: "Computer Programming" },
  { subject: "INFS", course_num: "2203", title: "Database Systems" },
  { subject: "INFS", course_num: "3204", title: "Mobile App Development" },
  { subject: "CYBS", course_num: "2101", title: "Network Security" },
  { subject: "DSAI", course_num: "3301", title: "Machine Learning" },
  { subject: "MATH", course_num: "1101", title: "Calculus I" },
  { subject: "COMM", course_num: "1010", title: "Technical Writing" },
];

const SU_TU = [0, 2];
const MO_WE = [1, 3];
const SU_TU_TH = [0, 2, 4];
const TH = [4];

// Instructor names are fictional.
const SECTIONS: SimSection[] = [
  section("INFS", "1201", "A", "10.2.33", SU_TU, "08:00", "09:15", "Dr. S. Khalil"),
  section("INFS", "1201", "B", "10.2.33", MO_WE, "08:00", "09:15", "Dr. S. Khalil"),
  section("INFS", "2203", "A", "10.2.35", SU_TU, "09:30", "10:45", "Mr. O. Farouk"),
  section("INFS", "2203", "B", "10.2.33", MO_WE, "14:00", "15:15", "Mr. O. Farouk"),
  section("INFS", "3204", "A", "10.3.12", SU_TU, "14:00", "15:15", "Dr. N. Haddad"),
  section("INFS", "3204", "L1", "05.2.14", TH, "11:00", "12:50", "Ms. A. Rahman"),
  section("CYBS", "2101", "A", "10.1.08", SU_TU, "11:00", "12:15", "Dr. K. Ibrahim"),
  section("CYBS", "2101", "B", "10.1.08", MO_WE, "15:30", "16:45", "Dr. K. Ibrahim"),
  section("DSAI", "3301", "A", "10.3.12", MO_WE, "09:30", "10:45", "Dr. M. Saeed"),
  section("MATH", "1101", "A", "05.1.20", SU_TU_TH, "08:00", "08:50", "Dr. H. Yousef"),
  section("MATH", "1101", "B", "05.1.20", SU_TU_TH, "10:00", "10:50", "Dr. H. Yousef"),
  section("COMM", "1010", "A", "10.2.35", MO_WE, "11:00", "12:15", "Ms. R. Saleh"),
];

const FIRST_NAMES = [
  "Layla", "Omar", "Mariam", "Yousef", "Noor", "Khalid", "Aisha", "Hamad", "Fatima", "Ali",
  "Sara", "Abdulla", "Huda", "Faisal", "Reem", "Tariq", "Dana", "Saad", "Lulwa", "Jassim",
];
const LAST_NAMES = [
  "Mansour", "Al-Kuwari", "Haddad", "Rahman", "Al-Sulaiti", "Nasser", "Qureshi", "Al-Marri",
  "Farouk", "Al-Thani", "Siddiqui", "Hassan", "Al-Emadi", "Khan", "Saleh", "Al-Naimi",
];
const PROGRAMS = [
  "BSc Information Technology",
  "BSc Cybersecurity",
  "BSc Data Science and AI",
  "BSc Software Engineering",
];

function section(
  subject: string,
  course_num: string,
  name: string,
  room: string,
  days: number[],
  start_time: string,
  end_time: string,
  instructor: string,
): SimSection {
  return {
    key: `${subject}${course_num}-${name}`,
    subject,
    course_num,
    section: name,
    room,
    days,
    start_time,
    end_time,
    instructor,
  };
}

function minutesOf(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(a: SimSection, b: SimSection) {
  if (!a.days.some((day) => b.days.includes(day))) return false;
  return minutesOf(a.start_time) < minutesOf(b.end_time) && minutesOf(b.start_time) < minutesOf(a.end_time);
}

export function createCampus(options: CampusOptions = {}): Campus {
  const seed = options.seed ?? "urep-32";
  const rng = createRng(`campus:${seed}`);
  // Separate stream, so adding display fields never changes who attends what.
  const names = createRng(`names:${seed}`);
  const desk = createRng(`palm-desk:${seed}`);
  const studentCount = options.students ?? 90;

  const ids = new Set<number>();
  while (ids.size < studentCount) ids.add(rng.int(60301000, 60309999));

  const lectureSections = SECTIONS.filter((s) => s.section !== "L1");
  const students: SimStudent[] = [...ids].sort().map((student_id) => {
    const roll = rng.next();
    const profile: BehaviourProfile =
      roll < 0.3 ? "punctual" : roll < 0.75 ? "typical" : roll < 0.9 ? "late_prone" : "disengaged";
    const palmRoll = rng.next();
    const palm_status: PalmStatus =
      palmRoll < 0.94 ? "linked" : palmRoll < 0.98 ? "unlinked" : "not_enrolled";

    const wanted = rng.int(4, 5);
    const chosen: SimSection[] = [];
    for (const candidate of rng.shuffle(lectureSections)) {
      if (chosen.length >= wanted) break;
      const sameCourse = chosen.some(
        (s) => s.subject === candidate.subject && s.course_num === candidate.course_num,
      );
      if (sameCourse || chosen.some((s) => overlaps(s, candidate))) continue;
      chosen.push(candidate);
    }
    const lab = SECTIONS.find((s) => s.key === "INFS3204-L1")!;
    if (chosen.some((s) => s.key === "INFS3204-A") && !chosen.some((s) => overlaps(s, lab))) {
      chosen.push(lab);
    }

    return {
      student_id,
      name: `${names.pick(FIRST_NAMES)} ${names.pick(LAST_NAMES)}`,
      program: names.pick(PROGRAMS),
      palm_registered_at:
        dohaTime(`2026-08-${23 + desk.int(0, 4)}`, "09:00") + desk.int(0, 6 * 60) * 60_000,
      student_palm: `PV-${rng.int(0, 0xffffffff).toString(16).padStart(8, "0").toUpperCase()}`,
      palm_status,
      profile,
      sections: chosen.map((s) => s.key),
    };
  });

  return {
    seed,
    academic_year: options.academicYear ?? 2026,
    semester: options.semester ?? 1,
    rooms: ROOMS.map((room) => ({ room })),
    readers: READERS.map((reader) => ({ ...reader })),
    courses: COURSES.map((course) => ({ ...course })),
    sections: SECTIONS.map((s) => ({ ...s, days: [...s.days] })),
    students,
  };
}

/** Lecture occurrences for every section meeting between two Doha dates (inclusive). */
export function lecturesBetween(campus: Campus, from: string, to: string): SimLecture[] {
  const lectures: SimLecture[] = [];
  for (const date of datesBetween(from, to)) {
    const weekday = dohaWeekday(date);
    for (const s of campus.sections) {
      if (!s.days.includes(weekday)) continue;
      lectures.push({
        section_key: s.key,
        lecture_date: date,
        start_time: s.start_time,
        end_time: s.end_time,
        start: dohaTime(date, s.start_time),
        end: dohaTime(date, s.end_time),
        room: s.room,
      });
    }
  }
  return lectures.sort((a, b) => a.start - b.start || a.section_key.localeCompare(b.section_key));
}

export function readerForRoom(campus: Campus, room: string) {
  return campus.readers.find((reader) => reader.room === room);
}
