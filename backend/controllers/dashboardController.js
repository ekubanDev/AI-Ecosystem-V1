import * as svc from "../services/dashboardService.js";
import { ok } from "../utils/http.js";

export const summary = async (_req, res) => ok(res, await svc.summary());
export const opportunities = async (_req, res) => ok(res, await svc.opportunities());
export const agentActivity = async (_req, res) => ok(res, await svc.agentActivity());
export const experiments = async (_req, res) => ok(res, await svc.experiments());
