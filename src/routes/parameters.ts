import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listParameters, updateParameter } from "../services/parametersService.js";

export const parametersRouter = Router();

const updateParameterSchema = z.object({
  value: z.number().int().nonnegative().nullable(),
});

parametersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ data: await listParameters() });
  }),
);

parametersRouter.put(
  "/:name",
  asyncHandler(async (req, res) => {
    const body = updateParameterSchema.parse(req.body);
    const name = z.string().parse(req.params.name);
    const parameter = await updateParameter(name, body.value);
    res.json({ data: parameter });
  }),
);
