import { Cancel, PlayArrow } from "@mui/icons-material";
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Link, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { discovery as api } from "../api/endpoints.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { DiscoveryStatusChip } from "../components/chips.jsx";
import { ActionDialog, Empty, ErrorAlert, Loading, PageHeader, ServerPagination } from "../components/common.jsx";
import { formatDate, humanize } from "../utils/format.js";

const REVENUE = ["SUBSCRIPTION", "TRANSACTION", "PRODUCTIZED_SERVICE", "LEAD_GENERATION", "MARKETPLACE_COMMISSION", "API_USAGE", "DATA"];
const isActive = (s) => s === "QUEUED" || s === "RUNNING";
const csv = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

function RunForm() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ market: "Ghana", geography: "Ghana, Africa", customerType: "B2B", count: 20, revenue: ["SUBSCRIPTION"], objective: "" });
  // One key per submission attempt: an accidental double-click or a retry after a network error can't start two runs.
  const key = useRef(crypto.randomUUID());
  const run = useMutation({
    mutationFn: () => api.run({
      market: form.market.trim(), count: Number(form.count), ...(form.customerType && { customerType: form.customerType }),
      ...(csv(form.geography).length && { geography: csv(form.geography) }), ...(form.revenue.length && { revenuePreference: form.revenue }),
      ...(form.objective.trim() && { objective: form.objective.trim() }),
    }, key.current),
    onSuccess: () => {
      key.current = crypto.randomUUID();
      qc.invalidateQueries({ queryKey: ["discovery"] });
    },
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const countOk = Number.isInteger(Number(form.count)) && form.count >= 1 && form.count <= 50;

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Run discovery</Typography>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" } }}>
          <TextField label="Market" required value={form.market} onChange={set("market")} />
          <TextField label="Geography (comma-separated)" value={form.geography} onChange={set("geography")} />
          <TextField label="Customer type" select value={form.customerType} onChange={set("customerType")}>
            {["", "B2B", "B2C", "B2B2C"].map((t) => <MenuItem key={t} value={t}>{t || "Any"}</MenuItem>)}
          </TextField>
          <TextField label="Target count" type="number" slotProps={{ htmlInput: { min: 1, max: 50 } }} value={form.count} onChange={set("count")} error={!countOk} helperText={countOk ? "1–50 (each opportunity costs several AI calls)" : "Enter 1–50"} />
          <TextField label="Revenue preference" select slotProps={{ select: { multiple: true, renderValue: (v) => v.map(humanize).join(", ") } }} value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })}>
            {REVENUE.map((r) => <MenuItem key={r} value={r}>{humanize(r)}</MenuItem>)}
          </TextField>
          <TextField label="Objective (optional)" value={form.objective} onChange={set("objective")} />
        </Box>
        <ErrorAlert error={run.error} sx={{ mt: 2 }} />
        {run.isSuccess && <Alert severity="success" sx={{ mt: 2 }}>Discovery queued. Progress appears below.</Alert>}
        <Button sx={{ mt: 2 }} variant="contained" startIcon={<PlayArrow />} disabled={run.isPending || !form.market.trim() || !countOk} onClick={() => run.mutate()}>{run.isPending ? "Starting…" : "Run discovery"}</Button>
      </CardContent>
    </Card>
  );
}

function Progress({ run }) {
  const p = run.progress ?? { percent: 0, stage: run.status };
  return (
    <Box sx={{ minWidth: 160 }}>
      <LinearProgress variant="determinate" value={p.percent ?? 0} aria-label={`Progress ${p.percent}%`} />
      <Typography variant="caption" sx={{ color: "text.secondary" }}>{humanize(p.stage)} · {p.percent}%</Typography>
    </Box>
  );
}

function RunDialog({ id, onClose }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({ queryKey: ["discovery", "run", id], queryFn: () => api.get(id), enabled: !!id, refetchInterval: (query) => (isActive(query.state.data?.status) ? 2500 : false) });
  const r = q.data;
  return (
    <Dialog open={!!id} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Discovery run</DialogTitle>
      <DialogContent>
        <ErrorAlert error={q.error} />
        {q.isPending ? <Loading /> : r && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}><DiscoveryStatusChip status={r.status} /><Box sx={{ flexGrow: 1 }}><Progress run={r} /></Box></Stack>
            {r.error && <Alert severity="error">{r.error}</Alert>}
            <Typography variant="body2" sx={{ color: "text.secondary" }}>Started {formatDate(r.createdAt)} · request: {r.request?.market}{r.request?.geography ? ` (${r.request.geography.join(", ")})` : ""}, target {r.request?.count}</Typography>
            <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              {[["Candidates", r.stats.candidates], ["Created", r.stats.opportunitiesCreated], ["Duplicates skipped", r.stats.duplicatesSkipped], ["Analysed", r.stats.opportunitiesCompleted], ["Failed", r.stats.opportunitiesFailed], ["Skipped (paused/rejected)", r.stats.opportunitiesSkipped ?? 0]].map(([l, v]) => (
                <Card key={l} variant="outlined" sx={{ p: 1.5 }}><Typography variant="caption" sx={{ color: "text.secondary" }}>{l}</Typography><Typography variant="h6">{v}</Typography></Card>
              ))}
            </Box>
            {Object.keys(r.tasks ?? {}).length > 0 && (
              <Table size="small">
                <TableHead><TableRow><TableCell>Agent</TableCell><TableCell>Task states</TableCell></TableRow></TableHead>
                <TableBody>{Object.entries(r.tasks).map(([agent, states]) => <TableRow key={agent}><TableCell>{humanize(agent)}</TableCell><TableCell>{Object.entries(states).map(([s, n]) => `${humanize(s)}: ${n}`).join(" · ")}</TableCell></TableRow>)}</TableBody>
              </Table>
            )}
            {r.stats.opportunitiesFailed > 0 && <Alert severity="warning">Some steps failed. Review and retry them on the <Link component={RouterLink} to={`/agents?tab=tasks&workflowId=${r.id}`}>Agents page</Link>.</Alert>}
            <Link component={RouterLink} to="/opportunities?status=AWAITING_APPROVAL">View opportunities awaiting approval →</Link>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {r && isActive(r.status) && can("agents:run") && <Button color="error" startIcon={<Cancel />} onClick={() => setCancelling(true)}>Cancel run</Button>}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
      <ActionDialog open={cancelling} title="Cancel this discovery run?" description="Queued steps are cancelled; steps already running are stopped or their results discarded." confirmLabel="Cancel run" color="error"
        onConfirm={async () => { await api.cancel(id); qc.invalidateQueries({ queryKey: ["discovery"] }); }} onClose={() => setCancelling(false)} />
    </Dialog>
  );
}

export default function DiscoveryPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [openId, setOpenId] = useState(null);
  const q = useQuery({
    queryKey: ["discovery", "list", page, limit], queryFn: () => api.list({ page, limit }), placeholderData: (p) => p,
    refetchInterval: (query) => (query.state.data?.items.some((r) => isActive(r.status)) ? 3000 : false),
  });

  return (
    <>
      <PageHeader title="Discovery" subtitle="Scout → research → competitors → business model → analysis, ending in a human review queue." />
      {can("agents:run") ? <RunForm /> : <Alert severity="info" sx={{ mb: 3 }}>You have read-only access. Ask an owner or admin to change your role to run discovery.</Alert>}
      <ErrorAlert error={q.error} onRetry={q.refetch} sx={{ mb: 2 }} />
      {q.isPending ? <Loading /> : (
        <Card variant="outlined">
          <Table size="small">
            <TableHead><TableRow><TableCell>Started</TableCell><TableCell>Request</TableCell><TableCell>Status</TableCell><TableCell>Progress</TableCell><TableCell align="right">Created</TableCell></TableRow></TableHead>
            <TableBody>
              {q.data.items.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpenId(r.id)}>
                  <TableCell>{formatDate(r.createdAt)}</TableCell>
                  <TableCell>{r.request?.market} · {r.request?.count} target</TableCell>
                  <TableCell><DiscoveryStatusChip status={r.status} /></TableCell>
                  <TableCell>{isActive(r.status) ? <Typography variant="caption">In progress…</Typography> : humanize(r.stage)}</TableCell>
                  <TableCell align="right">{r.stats?.opportunitiesCreated ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {q.data.items.length === 0 && <Empty>No discovery runs yet.</Empty>}
          <ServerPagination pagination={q.data.pagination} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </Card>
      )}
      <RunDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
