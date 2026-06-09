import { pool } from "../db.js";

export async function processTimeLogMappings() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `
        WITH mapped AS (
          INSERT INTO time_log_mapping (time_log_id, room_id, student_id, time)
          SELECT tl.id, dr.room_id, pr.student_id, tl.time
          FROM time_log tl
          JOIN palm_reg pr ON pr.student_palm = tl.student_palm
          JOIN device_room dr ON dr.device_id = tl.device_id
          WHERE tl.transferred = false
          ON CONFLICT (time_log_id) DO NOTHING
          RETURNING time_log_id
        )
        UPDATE time_log tl
        SET transferred = true
        FROM mapped
        WHERE tl.id = mapped.time_log_id
        RETURNING tl.id
      `,
    );
    const unmapped = await client.query(
      `
        SELECT count(*)::int AS count
        FROM time_log tl
        WHERE tl.transferred = false
          AND NOT EXISTS (
            SELECT 1 FROM palm_reg pr WHERE pr.student_palm = tl.student_palm
          )
          OR tl.transferred = false
          AND NOT EXISTS (
            SELECT 1 FROM device_room dr WHERE dr.device_id = tl.device_id
          )
      `,
    );
    await client.query("COMMIT");

    return {
      mapped_count: inserted.rowCount ?? 0,
      unmapped_count: Number(unmapped.rows[0].count),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
