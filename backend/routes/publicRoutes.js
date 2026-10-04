import { Router } from "express";
import * as c from "../controllers/landingController.js";
import { validate } from "../middleware/validate.js";
import * as v from "../validators/landing.js";

/** Unauthenticated. Keep this surface tiny: read one published page, submit one lead form. */
export default function publicRoutes(leadLimiter, viewLimiter) {
  const r = Router();
  r.get("/privacy", c.privacy);
  r.get("/landing/:slug", validate({ params: v.slugParam }), c.getPublic);
  r.post("/landing/:slug/view", viewLimiter, validate({ params: v.slugParam, body: v.recordView }), c.recordView);
  r.post("/landing/:slug/leads", leadLimiter, validate({ params: v.slugParam, body: v.submitLead }), c.submitLead);
  return r;
}
