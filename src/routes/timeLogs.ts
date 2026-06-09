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
