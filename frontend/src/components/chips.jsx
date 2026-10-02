import { Chip, Stack, Tooltip } from "@mui/material";
import { evidenceQuality } from "../utils/evidenceQuality.js";
import { humanize } from "../utils/format.js";

const OPP_COLORS = {
  DISCOVERED: "default", RESEARCHING: "info", ANALYZING: "info", VALIDATED: "secondary", AWAITING_APPROVAL: "warning",
  APPROVED: "success", EXPERIMENT: "primary", BUILDING: "primary", LAUNCHED: "success", SCALING: "success", PAUSED: "default", REJECTED: "error",
};
const TASK_COLORS = { QUEUED: "default", RUNNING: "info", COMPLETED: "success", FAILED: "error", CANCELLED: "default", RETRYING: "warning", WAITING_REVIEW: "warning", STARTED: "info" };
const EXP_COLORS = { DRAFT: "default", READY: "info", RUNNING: "primary", COMPLETED: "success", CANCELLED: "default" };
const RUN_COLORS = { QUEUED: "default", RUNNING: "info", COMPLETED: "success", FAILED: "error", CANCELLED: "default" };

const make = (colors) =>
  function StatusChip({ status, ...rest }) {
    return <Chip size="small" label={humanize(status)} color={colors[status] ?? "default"} variant={colors[status] === "default" ? "outlined" : "filled"} {...rest} />;
  };

export const OpportunityStatusChip = make(OPP_COLORS);
export const TaskStatusChip = make(TASK_COLORS);
export const ExperimentStatusChip = make(EXP_COLORS);
export const DiscoveryStatusChip = make(RUN_COLORS);

const EVIDENCE = {
  VERIFIED: { color: "success", tip: "Stated directly by a cited source" },
  SUPPORTED: { color: "success", tip: "Indicated by a cited source" },
  ESTIMATED: { color: "warning", tip: "A quantitative estimate, not a fact" },
  INFERRED: { color: "warning", tip: "AI reasoning, not directly sourced" },
  ASSUMED: { color: "default", tip: "An assumption" },
  UNKNOWN: { color: "default", tip: "Not known" },
};

/** Evidence type is always shown: the product's rule is that sourced fact and AI inference must never look the same. */
export function EvidenceTypeChip({ type }) {
  const e = EVIDENCE[type] ?? EVIDENCE.UNKNOWN;
  return (
    <Tooltip title={e.tip}>
      <Chip size="small" label={type ?? "UNKNOWN"} color={e.color} variant={e.color === "default" ? "outlined" : "filled"} />
    </Tooltip>
  );
}

export function ConfidenceChip({ confidence }) {
  const color = { HIGH: "success", MEDIUM: "info", LOW: "warning" }[confidence] ?? "default";
  return <Chip size="small" variant="outlined" color={color} label={`${humanize(confidence ?? "UNKNOWN")} confidence`} />;
}

/** At-a-glance evidence quality as counts (never a single score), so weak opportunities are visible before anyone approves them. */
export function EvidenceQualityChips({ opportunity }) {
  const q = evidenceQuality(opportunity);
  if (!q.total) return <Chip size="small" variant="outlined" color="warning" label="No evidence recorded" />;
  const share = Math.round(q.sourcedShare * 100);
  const weak = share < 60 || q.sources < 3;
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }} aria-label="Evidence quality">
      <Tooltip title="Claims labelled VERIFIED or SUPPORTED that cite a stored source">
        <Chip size="small" color={weak ? "warning" : "success"} variant="outlined" label={`${q.sourced} of ${q.total} claims sourced (${share}%)`} />
      </Tooltip>
      <Tooltip title="Inferred, estimated, assumed or unknown: AI reasoning, not sourced fact">
        <Chip size="small" variant="outlined" label={`${q.guessed} inferred or assumed`} />
      </Tooltip>
      <Chip size="small" variant="outlined" label={`${q.sources} source${q.sources === 1 ? "" : "s"}`} />
      {q.downgraded > 0 && (
        <Tooltip title="Claims the agents labelled as sourced, but whose citation was missing or did not support them; they were downgraded to inferred">
          <Chip size="small" color="warning" variant="outlined" label={`${q.downgraded} downgraded`} />
        </Tooltip>
      )}
    </Stack>
  );
}
