import { Add, Delete } from "@mui/icons-material";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { experiments as api } from "../api/endpoints.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ExperimentStatusChip } from "./chips.jsx";
import { ActionDialog, ErrorAlert, Loading } from "./common.jsx";
import { formatDate, formatMoney } from "../utils/format.js";

const invalidate = (qc) => {
  qc.invalidateQueries({ queryKey: ["experiments"] });
  qc.invalidateQueries({ queryKey: ["opportunity"] });
  qc.invalidateQueries({ queryKey: ["opportunities"] });
  qc.invalidateQueries({ queryKey: ["dash"] });
};

const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? v : Number(v));

/** Create (opportunityId given) or edit (experiment given). Editing is only possible while DRAFT/READY. */
export function ExperimentFormDialog({ open, onClose, opportunityId, experiment }) {
  const qc = useQueryClient();
  const editing = !!experiment;
  const [form, setForm] = useState(() => ({
    name: experiment?.name ?? "", hypothesis: experiment?.hypothesis ?? "", objective: experiment?.objective ?? "", method: experiment?.method ?? "",
    targetCustomer: experiment?.targetCustomer ?? "", budget: experiment?.budget ?? 0, currency: experiment?.currency ?? "", successCriteria: experiment?.successCriteria ?? "",
    metrics: (experiment?.metrics ?? []).map((m) => ({ name: m.name, target: m.target ?? "" })),
  }));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(), hypothesis: form.hypothesis.trim(), budget: Number(form.budget) || 0,
        ...(form.objective && { objective: form.objective }), ...(form.method && { method: form.method }), ...(form.targetCustomer && { targetCustomer: form.targetCustomer }),
        ...(form.currency && { currency: form.currency.trim() }), ...(form.successCriteria && { successCriteria: form.successCriteria }),
        metrics: form.metrics.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), ...(m.target !== "" && { target: num(m.target) }) })),
      };
      return editing ? api.update(experiment.id, body) : api.create({ opportunityId, ...body });
    },
    onSuccess: () => {
      invalidate(qc);
      onClose();
    },
  });
  const setMetric = (i, patch) => setForm({ ...form, metrics: form.metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{editing ? "Edit experiment" : "New experiment"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name" required autoFocus value={form.name} onChange={set("name")} />
          <TextField label="Hypothesis" required multiline minRows={2} helperText="e.g. At least 5% of targeted visitors will submit an interest form." value={form.hypothesis} onChange={set("hypothesis")} />
          <TextField label="Objective" value={form.objective} onChange={set("objective")} />
          <TextField label="Method" multiline minRows={2} value={form.method} onChange={set("method")} />
          <TextField label="Target customer" value={form.targetCustomer} onChange={set("targetCustomer")} />
          <Stack direction="row" spacing={2}>
            <TextField label="Budget" type="number" slotProps={{ htmlInput: { min: 0 } }} value={form.budget} onChange={set("budget")} sx={{ flex: 1 }} />
            <TextField label="Currency" placeholder="GHS" slotProps={{ htmlInput: { maxLength: 8 } }} value={form.currency} onChange={set("currency")} sx={{ flex: 1 }} />
          </Stack>
          <TextField label="Success criteria" multiline minRows={2} value={form.successCriteria} onChange={set("successCriteria")} />
          <Typography variant="subtitle2">Metrics</Typography>
          {form.metrics.map((m, i) => (
            <Stack key={i} direction="row" spacing={1}>
              <TextField size="small" label="Metric" value={m.name} onChange={(e) => setMetric(i, { name: e.target.value })} sx={{ flex: 2 }} />
              <TextField size="small" label="Target" value={m.target} onChange={(e) => setMetric(i, { target: e.target.value })} sx={{ flex: 1 }} />
              <IconButton aria-label="Remove metric" onClick={() => setForm({ ...form, metrics: form.metrics.filter((_, j) => j !== i) })}><Delete /></IconButton>
            </Stack>
          ))}
          <Box><Button size="small" startIcon={<Add />} onClick={() => setForm({ ...form, metrics: [...form.metrics, { name: "", target: "" }] })}>Add metric</Button></Box>
          {Number(form.budget) > 0 && <Alert severity="info">Starting an experiment with a budget needs owner/admin approval.</Alert>}
          <ErrorAlert error={save.error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!form.name.trim() || !form.hypothesis.trim() || save.isPending} onClick={() => save.mutate()}>{editing ? "Save" : "Create"}</Button>
      </DialogActions>
    </Dialog>
  );
}

function CompleteDialog({ experiment, open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ results: "", conclusion: "", nextAction: "" });
  const [actuals, setActuals] = useState(() => Object.fromEntries((experiment.metrics ?? []).map((m) => [m.name, m.actual ?? ""])));
  const done = useMutation({
    mutationFn: () => api.complete(experiment.id, {
      ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])),
      ...(experiment.metrics?.length && { metrics: experiment.metrics.map((m) => ({ name: m.name, ...(m.target != null && { target: m.target }), ...(actuals[m.name] !== "" && { actual: num(actuals[m.name]) }) })) }),
    }),
    onSuccess: () => {
      invalidate(qc);
      onClose();
    },
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const valid = form.results.trim() && form.conclusion.trim() && form.nextAction.trim();
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Record results</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {(experiment.metrics ?? []).map((m) => (
            <TextField key={m.name} size="small" label={`${m.name} — actual${m.target != null ? ` (target ${m.target})` : ""}`} value={actuals[m.name]} onChange={(e) => setActuals({ ...actuals, [m.name]: e.target.value })} />
          ))}
          <TextField label="Results" required multiline minRows={2} value={form.results} onChange={set("results")} />
          <TextField label="Conclusion" required multiline minRows={2} value={form.conclusion} onChange={set("conclusion")} />
          <TextField label="Next action" required helperText="What should happen next: continue, modify or stop." value={form.nextAction} onChange={set("nextAction")} />
          <ErrorAlert error={done.error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid || done.isPending} onClick={() => done.mutate()}>Complete experiment</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Loads the experiment by id so status changes made inside the dialog (or elsewhere) are reflected after invalidation. */
export function ExperimentDialog({ id, onClose }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [sub, setSub] = useState(null); // 'edit' | 'complete' | 'cancel' | 'start'
  const startKey = useRef(crypto.randomUUID());
  const canWrite = can("experiments:write");
  const [actionError, setActionError] = useState(null);
  const q = useQuery({ queryKey: ["experiments", "one", id], queryFn: () => api.get(id) });
  const e = q.data;
  const patchStatus = useMutation({
    mutationFn: (status) => api.update(id, { status }),
    onMutate: () => setActionError(null),
    onSuccess: () => invalidate(qc),
    onError: setActionError,
  });
  if (q.isPending || !e)
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="md">
        <DialogContent>{q.error ? <ErrorAlert error={q.error} /> : <Loading />}</DialogContent>
        <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
      </Dialog>
    );
  const needsApproval = e.budget > 0 && !can("experiments:approve");

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle><Stack direction="row" spacing={2} sx={{ alignItems: "center" }}><span>{e.name}</span><ExperimentStatusChip status={e.status} /></Stack></DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <div><Typography variant="caption" sx={{ color: "text.secondary" }}>Hypothesis</Typography><Typography>{e.hypothesis}</Typography></div>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {[["Objective", e.objective], ["Method", e.method], ["Target customer", e.targetCustomer], ["Budget", e.budget ? formatMoney(e.budget, e.currency) : "None"], ["Success criteria", e.successCriteria], ["Started", formatDate(e.startDate)], ["Ended", formatDate(e.endDate)]].map(([l, v]) => (
              <div key={l}><Typography variant="caption" sx={{ color: "text.secondary" }}>{l}</Typography><Typography variant="body2">{v || "—"}</Typography></div>
            ))}
          </Box>
          {e.metrics?.length > 0 && (
            <Table size="small"><TableHead><TableRow><TableCell>Metric</TableCell><TableCell>Target</TableCell><TableCell>Actual</TableCell></TableRow></TableHead>
              <TableBody>{e.metrics.map((m) => <TableRow key={m.name}><TableCell>{m.name}</TableCell><TableCell>{String(m.target ?? "—")}</TableCell><TableCell>{String(m.actual ?? "—")}</TableCell></TableRow>)}</TableBody></Table>
          )}
          {e.status === "COMPLETED" && (
            <Alert severity="success" icon={false}>
              <Typography variant="subtitle2">Results</Typography><Typography variant="body2" sx={{ mb: 1 }}>{e.results}</Typography>
              <Typography variant="subtitle2">Conclusion</Typography><Typography variant="body2" sx={{ mb: 1 }}>{e.conclusion}</Typography>
              <Typography variant="subtitle2">Next action</Typography><Typography variant="body2">{e.nextAction}</Typography>
            </Alert>
          )}
          {needsApproval && e.status === "READY" && <Alert severity="info">This experiment has a budget, so an owner or admin must start it.</Alert>}
          <ErrorAlert error={actionError} />
        </Stack>
      </DialogContent>
      <DialogActions>
        {canWrite && ["DRAFT", "READY"].includes(e.status) && <Button onClick={() => setSub("edit")}>Edit</Button>}
        {canWrite && e.status === "DRAFT" && <Button onClick={() => patchStatus.mutate("READY")} disabled={patchStatus.isPending}>Mark ready</Button>}
        {canWrite && e.status === "READY" && <Button onClick={() => patchStatus.mutate("DRAFT")} disabled={patchStatus.isPending}>Back to draft</Button>}
        {canWrite && e.status === "READY" && !needsApproval && <Button variant="contained" onClick={() => setSub("start")}>Start experiment</Button>}
        {canWrite && e.status === "RUNNING" && <Button variant="contained" onClick={() => setSub("complete")}>Record results</Button>}
        {canWrite && ["DRAFT", "READY", "RUNNING"].includes(e.status) && <Button color="error" onClick={() => setSub("cancel")}>Cancel experiment</Button>}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {sub === "edit" && <ExperimentFormDialog open experiment={e} onClose={() => { setSub(null); onClose(); }} />}
      {sub === "complete" && <CompleteDialog open experiment={e} onClose={() => { setSub(null); onClose(); }} />}
      <ActionDialog open={sub === "start"} title="Start this experiment?" description={e.budget > 0 ? `This commits a budget of ${formatMoney(e.budget, e.currency)}.` : "This experiment has no budget."} confirmLabel="Start"
        onConfirm={async () => { await api.start(e.id, startKey.current); invalidate(qc); }} onClose={() => setSub(null)} />
      <ActionDialog open={sub === "cancel"} title="Cancel this experiment?" confirmLabel="Cancel experiment" color="error"
        onConfirm={async () => { await api.cancel(e.id); invalidate(qc); onClose(); }} onClose={() => setSub(null)} />
    </Dialog>
  );
}
