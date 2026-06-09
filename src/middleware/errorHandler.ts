import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../errors.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "ValidationError",
      details: error.issues,
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "InternalServerError" });
};
