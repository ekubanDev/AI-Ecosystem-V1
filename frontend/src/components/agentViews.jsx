import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { agents as api } from "../api/endpoints.js";
import { ConfidenceChip, EvidenceTypeChip, TaskStatusChip } from "./chips.jsx";
import { Empty, ErrorAlert, JsonBlock, Loading } from "./common.jsx";
import { formatCost, formatDate, formatDuration, hostOf, humanize, safeHref } from "../utils/format.js";

const Field = ({ label, children }) => (
  <Box><Typography variant="caption" sx={{ color: "text.secondary" }}>{label}</Typography><Typography variant="body2" component="div">{children ?? "—"}</Typography></Box>
);

/** Everything the spec says an agent run must expose: input, model, sources, output, duration, tokens, errors, timestamps. */
export function RunDetailDialog({ id, onClose }) {
  const q = useQuery({ queryKey: ["agents", "run", id], queryFn: () => api.run(id), enabled: !!id });
  const r = q.data;
  const out = r?.output;
  return (
    <Dialog open={!!id} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Agent run{r ? ` · ${humanize(r.agentType)}` : ""}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={q.error} />
        {q.isPending ? <Loading /> : r && (
          <Stack spacing={2}>
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <Field label="Status">{r.status}</Field>
              <Field label="Model">{r.model}</Field>
              <Field label="Duration">{formatDuration(r.durationMs)}</Field>
              <Field label="Tokens">{r.tokenUsage ? `${r.tokenUsage.inputTokens} in / ${r.tokenUsage.outputTokens} out` : "—"}</Field>
              <Field label="Estimated cost">{formatCost(r.estimatedCost)}</Field>
              <Field label="Started">{formatDate(r.startedAt)}</Field>
              <Field label="Completed">{formatDate(r.completedAt)}</Field>
            </Box>
            {r.error && <Alert severity="error">{r.error}</Alert>}
            {out && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><Typography variant="body2">Agent-reported:</Typography><ConfidenceChip confidence={out.confidence} /></Stack>
            )}
            {out?.uncertainties?.length > 0 && (
              <Alert severity="warning" icon={false}><Typography variant="subtitle2">Uncertainties</Typography><ul style={{ margin: 0, paddingLeft: 18 }}>{out.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul></Alert>
            )}
            {out?.findings?.length > 0 && (
              <>
                <Typography variant="subtitle2">Findings</Typography>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Statement</TableCell><TableCell>Evidence</TableCell><TableCell>Sources</TableCell></TableRow></TableHead>
                  <TableBody>{out.findings.slice(0, 50).map((f, i) => <TableRow key={i}><TableCell>{f.statement}</TableCell><TableCell><EvidenceTypeChip type={f.evidenceType} /></TableCell><TableCell>{f.sourceIds?.length ?? 0}</TableCell></TableRow>)}</TableBody>
                </Table>
              </>
            )}
            <Typography variant="subtitle2">Sources used ({r.sourcesUsed?.length ?? 0})</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>{r.sourcesUsed?.length ? r.sourcesUsed.join(", ") : "None"}</Typography>
            <Typography variant="subtitle2">Input</Typography>
            <JsonBlock value={r.input} />
            <Typography variant="subtitle2">Output</Typography>
            {r.output ? <JsonBlock value={r.output} maxHeight={420} /> : <Typography variant="body2" sx={{ color: "text.secondary" }}>No output recorded.</Typography>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

/** Lists the executions of one task (a task has several runs when it was retried). */
export function TaskRunsDialog({ task, onClose, onOpenRun }) {
  const q = useQuery({ queryKey: ["agents", "runs", "task", task?.id], queryFn: () => api.runs({ taskId: task.id, limit: 20, order: "asc" }), enabled: !!task });
  return (
    <Dialog open={!!task} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{task ? `${humanize(task.agentType)} — runs` : ""}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={q.error} />
        {q.isPending ? <Loading /> : q.data.items.length === 0 ? <Empty>No runs yet.</Empty> : (
          <Table size="small">
            <TableHead><TableRow><TableCell>Started</TableCell><TableCell>Status</TableCell><TableCell>Duration</TableCell><TableCell>Tokens</TableCell></TableRow></TableHead>
            <TableBody>
              {q.data.items.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => onOpenRun(r.id)}>
                  <TableCell>{formatDate(r.startedAt)}</TableCell><TableCell>{r.status}</TableCell><TableCell>{formatDuration(r.durationMs)}</TableCell><TableCell>{r.tokenUsage?.totalTokens ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

export function TaskTable({ tasks, onViewRuns, onRetry, canRetry }) {
  if (!tasks.length) return <Empty>No tasks.</Empty>;
  return (
    <Table size="small">
      <TableHead><TableRow><TableCell>Agent</TableCell><TableCell>Workflow</TableCell><TableCell>Status</TableCell><TableCell align="right">Retries</TableCell><TableCell>Created</TableCell><TableCell>Error</TableCell><TableCell /></TableRow></TableHead>
      <TableBody>
        {tasks.map((t) => (
          <TableRow key={t.id}>
            <TableCell>{humanize(t.agentType)}</TableCell><TableCell>{humanize(t.workflow)}</TableCell><TableCell><TaskStatusChip status={t.status} /></TableCell>
            <TableCell align="right">{t.retryCount}</TableCell><TableCell>{formatDate(t.createdAt)}</TableCell>
            <TableCell sx={{ maxWidth: 280 }}><Typography variant="caption" noWrap title={t.error} sx={{ color: t.error ? "error" : "text.secondary" }}>{t.error || "—"}</Typography></TableCell>
            <TableCell align="right">
              <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                <Button size="small" onClick={() => onViewRuns(t)}>Runs</Button>
                {canRetry && ["FAILED", "WAITING_REVIEW"].includes(t.status) && <Button size="small" color="warning" onClick={() => onRetry(t)}>Retry</Button>}
              </Stack>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const SourceLink = ({ source }) =>
  source ? (safeHref(source.url) ? <Link href={safeHref(source.url)} target="_blank" rel="noopener noreferrer nofollow" title={source.url}>{source.title || hostOf(source.url)}</Link> : <span>{source.title || source.url}</span>) : "—";
