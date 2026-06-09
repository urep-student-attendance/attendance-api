import { Router } from "express";
import { z } from "zod";
import {
  listAttendance,
  processAttendance,
} from "../services/attendanceService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const attendanceRouter = Router();

const processAttendanceSchema = z.object({
  lecture_id: z.number().int().positive().optional(),
  schedule_id: z.number().int().positive().optional(),
  from_date: z.string().date().optional(),
  to_date: z.string().date().optional(),
});

const listAttendanceSchema = z.object({
  student_id: z.coerce.number().int().positive().optional(),
  lecture_id: z.coerce.number().int().positive().optional(),
  schedule_id: z.coerce.number().int().positive().optional(),
  status: z.enum(["present", "absent"]).optional(),
});

attendanceRouter.post(
  "/process",
  asyncHandler(async (req, res) => {
    const filters = processAttendanceSchema.parse(req.body ?? {});
    res.json({ data: await processAttendance(filters) });
  }),
);

attendanceRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = listAttendanceSchema.parse(req.query);
    res.json({ data: await listAttendance(filters) });
  }),
);
