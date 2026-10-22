import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const timeLogsRouter = Router();

const createTimeLogSchema = z.object({
  device_id: z.string().min(1),
  student_palm: z.string().min(1),
  scan_time: z.coerce.date(),
});

// A reader that was offline flushes its buffered scans in one request.
const createTimeLogBatchSchema = z.object({
  scans: z.array(createTimeLogSchema).min(1).max(1000),
});

timeLogsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createTimeLogSchema.parse(req.body);
    const result = await pool.query(
      `
        INSERT INTO time_log (device_id, student_palm, time)
        VALUES ($1, $2, $3)
        RETURNING id, device_id, student_palm, time AS scan_time, transferred, created_at
      `,
      [body.device_id, body.student_palm, body.scan_time],
    );
    res.status(201).json({ data: result.rows[0] });
  }),
);

timeLogsRouter.post(
  "/batch",
  asyncHandler(async (req, res) => {
    const { scans } = createTimeLogBatchSchema.parse(req.body);
    const result = await pool.query(
      `
        INSERT INTO time_log (device_id, student_palm, time)
        SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[])
        RETURNING id
      `,
      [
        scans.map((s) => s.device_id),
        scans.map((s) => s.student_palm),
        scans.map((s) => s.scan_time),
      ],
    );
    res.status(201).json({ data: { inserted_count: result.rowCount ?? 0 } });
  }),
);
