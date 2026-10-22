import { Router } from "express";
import { z } from "zod";
import { getStudentOverview } from "../services/studentOverviewService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const studentsRouter = Router();

studentsRouter.get(
  "/:studentId/overview",
  asyncHandler(async (req, res) => {
    const studentId = z.coerce.number().int().positive().max(2_147_483_647).parse(req.params.studentId);
    res.json({ data: await getStudentOverview(studentId) });
  }),
);
