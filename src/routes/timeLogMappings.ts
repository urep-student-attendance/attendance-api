import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { processTimeLogMappings } from "../services/timeLogMappingService.js";

export const timeLogMappingsRouter = Router();

timeLogMappingsRouter.post(
  "/process",
  asyncHandler(async (_req, res) => {
    res.json({ data: await processTimeLogMappings() });
  }),
);
