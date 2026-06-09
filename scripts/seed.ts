import { pool } from "../src/db.js";

async function main() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const room = await client.query<{ id: string }>(
      `
        INSERT INTO rooms (room)
        VALUES ('B-101')
        ON CONFLICT (room) DO UPDATE SET room = EXCLUDED.room
        RETURNING id
      `,
    );
    const roomId = room.rows[0].id;

    const course = await client.query<{ id: string }>(
      `
        INSERT INTO courses (subject, course_num)
        VALUES ('INF ', '1201')
        ON CONFLICT (subject, course_num) DO UPDATE SET subject = EXCLUDED.subject
        RETURNING id
      `,
    );
    const courseId = course.rows[0].id;

    const schedule = await client.query<{ id: string }>(
      `
        INSERT INTO schedule (academic_year, semester, course_id, room_id, section)
        VALUES (2026, 1, $1, $2, 'A')
        ON CONFLICT (academic_year, semester, course_id, section)
        DO UPDATE SET room_id = EXCLUDED.room_id
        RETURNING id
      `,
      [courseId, roomId],
    );
    const scheduleId = schedule.rows[0].id;

    await client.query(
      `
        INSERT INTO palm_reg (student_id, student_palm)
        VALUES (60000001, 'demo-palm-1')
        ON CONFLICT (student_palm) DO UPDATE SET student_id = EXCLUDED.student_id
      `,
    );
    await client.query(
      `
        INSERT INTO device_room (device_id, room_id)
        VALUES ('device-b-101', $1)
        ON CONFLICT (device_id) DO UPDATE SET room_id = EXCLUDED.room_id
      `,
      [roomId],
    );
    await client.query(
      `
        INSERT INTO registration (schedule_id, student_id)
        VALUES ($1, 60000001)
        ON CONFLICT (schedule_id, student_id) DO NOTHING
      `,
      [scheduleId],
    );
    await client.query(
      `
        INSERT INTO lectures (schedule_id, lecture_date, start_time, end_time)
        SELECT $1, CURRENT_DATE, '09:00', '10:00'
        WHERE NOT EXISTS (
          SELECT 1 FROM lectures
          WHERE schedule_id = $1 AND lecture_date = CURRENT_DATE AND start_time = '09:00'
        )
      `,
      [scheduleId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
