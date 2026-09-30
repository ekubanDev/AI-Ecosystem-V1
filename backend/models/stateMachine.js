import { invalidTransition } from "../utils/errors.js";

/** Forward path of the opportunity lifecycle (spec §13). */
export const OPPORTUNITY_FLOW = [
  "DISCOVERED", "RESEARCHING", "ANALYZING", "VALIDATED", "AWAITING_APPROVAL",
  "APPROVED", "EXPERIMENT", "BUILDING", "LAUNCHED", "SCALING",
];

const ACTIVE = new Set(OPPORTUNITY_FLOW);

/** status -> statuses reachable directly from it. PAUSED resumes to its recorded prior status (see resume). */
export const OPPORTUNITY_TRANSITIONS = Object.fromEntries([
  ...OPPORTUNITY_FLOW.map((s, i) => [s, [OPPORTUNITY_FLOW[i + 1], "PAUSED", "REJECTED"].filter(Boolean)]),
  ["PAUSED", ["REJECTED", ...OPPORTUNITY_FLOW]],
  ["REJECTED", []],
]);

export const canTransition = (from, to) => (OPPORTUNITY_TRANSITIONS[from] ?? []).includes(to);

export const assertTransition = (from, to) => {
  if (!canTransition(from, to)) throw invalidTransition(from, to);
};

/** Statuses from which `to` is a legal next step. */
export const sourcesFor = (to) => Object.keys(OPPORTUNITY_TRANSITIONS).filter((s) => canTransition(s, to));

export const isActiveStatus = (s) => ACTIVE.has(s);

/** Statuses meaning the analysis pipeline has finished / a human has been asked to decide. */
const idx = (s) => OPPORTUNITY_FLOW.indexOf(s);
export const VALIDATED_STATUSES = OPPORTUNITY_FLOW.slice(idx("VALIDATED"));
export const APPROVED_STATUSES = OPPORTUNITY_FLOW.slice(idx("APPROVED"));
