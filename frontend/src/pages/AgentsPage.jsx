import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { agents as api } from "../api/endpoints.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { RunDetailDialog, TaskRunsDialog, TaskTable } from "../components/agentViews.jsx";
import { TaskStatusChip } from "../components/chips.jsx";
import { ActionDialog, Empty, ErrorAlert, JsonBlock, Loading, PageHeader, ServerPagination } from "../components/common.jsx";
import { formatCost, formatDate, formatDuration, humanize } from "../utils/format.js";

const AGENT_TYPES = ["OPPORTUNITY_SCOUT", "RESEARCH", "COMPETITOR", "BUSINESS_MODEL", "OPPORTUNITY_ANALYST"];
const RUN_STATUSES = ["STARTED", "COMPLETED", "FAILED", "CANCELLED"];
const TASK_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "RETRYING", "WAITING_REVIEW"];

const Filter = ({ label, value, onChange, options }) => (
  <TextField size="small" select label={label} value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 170 }}>
    <MenuItem value="">All</MenuItem>{options.map((o) => <MenuItem key={o} value={o}>{humanize(o)}</MenuItem>)}
  </TextField>
);

function Registry() {
  const q = useQuery({ queryKey: ["agents", "registry"], queryFn: api.list, staleTime: 60_000 });
  const [runFor, setRunFor] = useState(null);
  const { can } = useAuth();
  if (q.isPending) return <Loading />;
  return (
    <>
      <ErrorAlert error={q.error} />
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
        {q.data?.map((a) => (
          <Card key={a.agentType} variant="outlined"><CardContent>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}><Typography variant="h6">{a.name}</Typography><Typography variant="caption">v{a.version}</Typography></Stack>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>{a.description}</Typography>
            <Typography variant="caption" sx={{ display: "block" }}>Reads: {a.permissions.read.join(", ") || "—"}</Typography>
            <Typography variant="caption" sx={{ display: "block" }}>Writes: {a.permissions.write.join(", ") || "—"}</Typography>
            <Typography variant="caption" sx={{ display: "block" }}>External access: {a.permissions.external.join(", ") || "none"}</Typography>
            {can("agents:runDirect") && <Button size="small" sx={{ mt: 1 }} onClick={() => setRunFor(a)}>Run directly…</Button>}
          </CardContent></Card>
        ))}
      </Box>
      {runFor && <RunAgentDialog agent={runFor} onClose={() => setRunFor(null)} />}
    </>
  );
}

function RunAgentDialog({ agent, onClose }) {
  const qc = useQueryClient();
  const [text, setText] = useState("{\n  \n}");
  const [parseError, setParseError] = useState(null);
  const key = useRef(crypto.randomUUID());
  const run = useMutation({
    mutationFn: (input) => api.runAgent(agent.agentType.toLowerCase().replace(/_/g, "-"), { input }, key.current),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); },
  });
  const submit = () => {
    let input;
    try { input = JSON.parse(text); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Input must be a JSON object."); } catch (e) { setParseError(e.message); return; }
    setParseError(null);
    run.mutate(input);
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Run {agent.name}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>Direct runs persist their output but do not continue to the next agent. Input is validated by the server before anything is queued.</Alert>
        <Typography variant="subtitle2" gutterBottom>Input schema</Typography>
        <JsonBlock value={agent.inputSchema} maxHeight={200} />
        <TextField sx={{ mt: 2 }} fullWidth multiline minRows={6} label="Input (JSON)" value={text} onChange={(e) => setText(e.target.value)} error={!!parseError} helperText={parseError} slotProps={{ htmlInput: { style: { fontFamily: "monospace", fontSize: 13 } } }} />
        <ErrorAlert error={run.error} sx={{ mt: 2 }} />
        {run.isSuccess && <Alert severity="success" sx={{ mt: 2 }}>Queued as task {run.data.taskId}.</Alert>}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button><Button variant="contained" disabled={run.isPending || run.isSuccess} onClick={submit}>Queue run</Button></DialogActions>
    </Dialog>
  );
}

function Runs() {
  const [f, setF] = useState({ agentType: "", status: "" });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [openId, setOpenId] = useState(null);
  const q = useQuery({ queryKey: ["agents", "runs", f, page, limit], queryFn: () => api.runs({ ...f, page, limit }), placeholderData: (p) => p, refetchInterval: 10_000 });
  const set = (k) => (v) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}><Filter label="Agent" value={f.agentType} onChange={set("agentType")} options={AGENT_TYPES} /><Filter label="Status" value={f.status} onChange={set("status")} options={RUN_STATUSES} /></Stack>
      <ErrorAlert error={q.error} onRetry={q.refetch} sx={{ mb: 2 }} />
      {q.isPending ? <Loading /> : (
        <Card variant="outlined">
          <Table size="small">
            <TableHead><TableRow><TableCell>Started</TableCell><TableCell>Agent</TableCell><TableCell>Status</TableCell><TableCell>Model</TableCell><TableCell align="right">Duration</TableCell><TableCell align="right">Tokens</TableCell><TableCell align="right">Cost</TableCell></TableRow></TableHead>
            <TableBody>
              {q.data.items.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpenId(r.id)}>
                  <TableCell>{formatDate(r.startedAt)}</TableCell><TableCell>{humanize(r.agentType)}</TableCell><TableCell><TaskStatusChip status={r.status} /></TableCell><TableCell>{r.model ?? "—"}</TableCell>
                  <TableCell align="right">{formatDuration(r.durationMs)}</TableCell><TableCell align="right">{r.tokenUsage?.totalTokens ?? 0}</TableCell><TableCell align="right">{formatCost(r.estimatedCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {q.data.items.length === 0 && <Empty>No runs match.</Empty>}
          <ServerPagination pagination={q.data.pagination} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </Card>
      )}
      {openId && <RunDetailDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Tasks({ initial }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({ agentType: "", status: initial.status ?? "", workflowId: initial.workflowId ?? "" });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [forRuns, setForRuns] = useState(null);
  const [runId, setRunId] = useState(null);
  const [retry, setRetry] = useState(null);
  const q = useQuery({ queryKey: ["agents", "tasks", f, page, limit], queryFn: () => api.tasks({ ...f, page, limit }), placeholderData: (p) => p, refetchInterval: 10_000 });
  const set = (k) => (v) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
        <Filter label="Agent" value={f.agentType} onChange={set("agentType")} options={AGENT_TYPES} /><Filter label="Status" value={f.status} onChange={set("status")} options={TASK_STATUSES} />
        {f.workflowId && <Button size="small" onClick={() => set("workflowId")("")}>Clear workflow filter</Button>}
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>Failed and waiting-for-review tasks were not retried automatically (permanent error, or retries exhausted). {can("agents:runDirect") ? "Retry them here." : "An owner or admin can retry them."}</Alert>
      <ErrorAlert error={q.error} onRetry={q.refetch} sx={{ mb: 2 }} />
      {q.isPending ? <Loading /> : (
        <Card variant="outlined">
          <TaskTable tasks={q.data.items} canRetry={can("agents:runDirect")} onViewRuns={setForRuns} onRetry={setRetry} />
          <ServerPagination pagination={q.data.pagination} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </Card>
      )}
      <TaskRunsDialog task={forRuns} onClose={() => setForRuns(null)} onOpenRun={setRunId} />
      {runId && <RunDetailDialog id={runId} onClose={() => setRunId(null)} />}
      <ActionDialog open={!!retry} title="Retry this task?" description="It returns to the queue with its retry count reset." confirmLabel="Retry" onConfirm={async () => { await api.retryTask(retry.id); qc.invalidateQueries({ queryKey: ["agents"] }); qc.invalidateQueries({ queryKey: ["discovery"] }); qc.invalidateQueries({ queryKey: ["dash"] }); }} onClose={() => setRetry(null)} />
    </>
  );
}

export default function AgentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = ["registry", "runs", "tasks"].includes(params.get("tab")) ? params.get("tab") : "runs";
  return (
    <>
      <PageHeader title="Agents" subtitle="What each agent may access, and a full record of everything they have done." />
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: v })} sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tab value="runs" label="Runs" /><Tab value="tasks" label="Tasks" /><Tab value="registry" label="Agents" />
      </Tabs>
      {tab === "runs" && <Runs />}
      {tab === "tasks" && <Tasks initial={{ status: params.get("status"), workflowId: params.get("workflowId") }} />}
      {tab === "registry" && <Registry />}
    </>
  );
}
