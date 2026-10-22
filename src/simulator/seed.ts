// Writes a simulated campus into the database: the SIS stand-in tables (students, rooms,
// courses, schedule, registration, lectures), the palm registration desk (palm_reg) and reader
// setup (device_room). Safe to run repeatedly for the same campus.
import type pg from "pg";
import { type Campus, lecturesBetween } from "./campus.js";

export type SeedResult = {
  scheduleIds: Map<string, number>;
  /** `${section_key}|${lecture_date}` -> lecture id */
  lectureIds: Map<string, number>;
};

export async function seedCampus(
  client: pg.Pool | pg.PoolClient,
  campus: Campus,
  from: string,
  to: string,
): Promise<SeedResult> {
  const roomIds = new Map<string, number>();
  for (const { room } of campus.rooms) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO rooms (room) VALUES ($1)
       ON CONFLICT (room) DO UPDATE SET room = EXCLUDED.room
       RETURNING id`,
      [room],
    );
    roomIds.set(room, Number(result.rows[0].id));
  }

  for (const reader of campus.readers) {
    if (reader.room === null) continue;
    await client.query(
      `INSERT INTO device_room (device_id, room_id) VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET room_id = EXCLUDED.room_id`,
      [reader.device_id, roomIds.get(reader.room)],
    );
  }

  const courseIds = new Map<string, number>();
  for (const course of campus.courses) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO courses (subject, course_num, title) VALUES ($1, $2, $3)
       ON CONFLICT (subject, course_num) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [course.subject, course.course_num, course.title],
    );
    courseIds.set(`${course.subject}${course.course_num}`, Number(result.rows[0].id));
  }

  const scheduleIds = new Map<string, number>();
  for (const s of campus.sections) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO schedule (academic_year, semester, course_id, room_id, section, instructor)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (academic_year, semester, course_id, section)
       DO UPDATE SET room_id = EXCLUDED.room_id, instructor = EXCLUDED.instructor
       RETURNING id`,
      [
        campus.academic_year,
        campus.semester,
        courseIds.get(`${s.subject}${s.course_num}`),
        roomIds.get(s.room),
        s.section,
        s.instructor,
      ],
    );
    scheduleIds.set(s.key, Number(result.rows[0].id));
  }

  for (const student of campus.students) {
    await client.query(
      `INSERT INTO students (student_id, name, program) VALUES ($1, $2, $3)
       ON CONFLICT (student_id) DO UPDATE SET name = EXCLUDED.name, program = EXCLUDED.program`,
      [student.student_id, student.name, student.program],
    );
    if (student.palm_status === "linked") {
      await client.query(
        `INSERT INTO palm_reg (student_id, student_palm, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (student_palm)
         DO UPDATE SET student_id = EXCLUDED.student_id, created_at = EXCLUDED.created_at`,
        [student.student_id, student.student_palm, new Date(student.palm_registered_at)],
      );
    }
    for (const sectionKey of student.sections) {
      await client.query(
        `INSERT INTO registration (schedule_id, student_id) VALUES ($1, $2)
         ON CONFLICT (schedule_id, student_id) DO NOTHING`,
        [scheduleIds.get(sectionKey), student.student_id],
      );
    }
  }

  const lectureIds = new Map<string, number>();
  for (const lecture of lecturesBetween(campus, from, to)) {
    const scheduleId = scheduleIds.get(lecture.section_key);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM lectures
       WHERE schedule_id = $1 AND lecture_date = $2 AND start_time = $3`,
      [scheduleId, lecture.lecture_date, lecture.start_time],
    );
    const id = existing.rows[0]
      ? existing.rows[0].id
      : (
          await client.query<{ id: string }>(
            `INSERT INTO lectures (schedule_id, lecture_date, start_time, end_time)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [scheduleId, lecture.lecture_date, lecture.start_time, lecture.end_time],
          )
        ).rows[0].id;
    lectureIds.set(`${lecture.section_key}|${lecture.lecture_date}`, Number(id));
  }

  return { scheduleIds, lectureIds };
}
