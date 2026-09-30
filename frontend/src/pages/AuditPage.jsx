import { Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, Link, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { audit as api } from "../api/endpoints.js";
import { Empty, ErrorAlert, JsonBlock, Loading, PageHeader, ServerPagination } from "../components/common.jsx";
import { describeActor, describeAuditEvent } from "../utils/audit.js";
import { formatDate, humanize } from "../utils/format.js";

const dateTimeInput = { inputLabel: { shrink: true } };
const iso = (local) => (local ? new Date(local).toISOString() : "");

export function ResourceCell({ e }) {
  if (e.resourceType === "Opportunity" && e.resourceId) return <Link component={RouterLink} to={`/opportunities/${e.resourceId}?tab=history`} onClick={(ev) => ev.stopPropagation()}>Opportunity</Link>;
  return <Typography variant="body2" title={e.resourceId}>{e.resourceType ?? "—"}</Typography>;
}

export function AuditDetailDialog({ event, onClose }) {
  if (!event) return null;
  const rows = [["When", formatDate(event.createdAt)], ["Actor", `${describeActor(event.actor)}${event.actor.role ? ` (${event.actor.role})` : ""}`], ["Action", humanize(event.action)], ["Resource", `${event.resourceType ?? "—"} ${event.resourceId ?? ""}`], ["Request ID", event.requestId], ["IP address", event.ipAddress], ["User agent", event.userAgent]];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{humanize(event.action)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
            {rows.map(([l, v]) => <div key={l}><Typography variant="caption" sx={{ color: "text.secondary" }}>{l}</Typography><Typography variant="body2" sx={{ wordBreak: "break-all" }}>{v || "—"}</Typography></div>)}
          </Box>
          {["before", "after", "metadata"].map((k) => event[k] != null && <div key={k}><Typography variant="subtitle2" gutterBottom>{humanize(k)}</Typography><JsonBlock value={event[k]} maxHeight={240} /></div>)}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

export default function AuditPage() {
  const [f, setF] = useState({ action: "", resourceType: "", actorType: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState(null);
  const facets = useQuery({ queryKey: ["audit", "facets"], queryFn: api.facets, staleTime: 5 * 60_000 });
  const params = { action: f.action, resourceType: f.resourceType, actorType: f.actorType, from: iso(f.from), to: iso(f.to), page, limit };
  const q = useQuery({ queryKey: ["audit", "list", params], queryFn: () => api.list(params), placeholderData: (p) => p });
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const rangeInvalid = f.from && f.to && new Date(f.from) > new Date(f.to);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every material action by people, agents and the system. Append-only; newest first." />
      <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(5, 1fr)" } }}>
          <TextField size="small" select label="Action" value={f.action} onChange={set("action")}>
            <MenuItem value="">All</MenuItem>{facets.data?.actions.map((a) => <MenuItem key={a} value={a}>{humanize(a)}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Resource" value={f.resourceType} onChange={set("resourceType")}>
            <MenuItem value="">All</MenuItem>{facets.data?.resourceTypes.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Actor type" value={f.actorType} onChange={set("actorType")}>
            <MenuItem value="">All</MenuItem>{["USER", "AGENT", "SYSTEM"].map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
          </TextField>
          <TextField size="small" type="datetime-local" label="From" value={f.from} onChange={set("from")} slotProps={dateTimeInput} error={!!rangeInvalid} />
          <TextField size="small" type="datetime-local" label="To" value={f.to} onChange={set("to")} slotProps={dateTimeInput} error={!!rangeInvalid} helperText={rangeInvalid ? "Must not be before From" : undefined} />
        </Box>
      </Card>
      <ErrorAlert error={q.error || facets.error} onRetry={q.refetch} sx={{ mb: 2 }} />
      {q.isPending ? <Loading /> : (
        <Card variant="outlined">
          <Table size="small">
            <TableHead><TableRow><TableCell>When</TableCell><TableCell>Actor</TableCell><TableCell>Action</TableCell><TableCell>Resource</TableCell><TableCell>Detail</TableCell></TableRow></TableHead>
            <TableBody>
              {q.data.items.map((e) => (
                <TableRow key={e.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpen(e)}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(e.createdAt)}</TableCell>
                  <TableCell>{describeActor(e.actor)}<Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>{e.actor.type === "USER" ? e.actor.role : humanize(e.actor.type)}</Typography></TableCell>
                  <TableCell>{humanize(e.action)}</TableCell>
                  <TableCell><ResourceCell e={e} /></TableCell>
                  <TableCell sx={{ maxWidth: 360 }}><Typography variant="body2" noWrap title={describeAuditEvent(e)}>{describeAuditEvent(e) || "—"}</Typography></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {q.data.items.length === 0 && <Empty>No events match these filters.</Empty>}
          <ServerPagination pagination={q.data.pagination} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </Card>
      )}
      <AuditDetailDialog event={open} onClose={() => setOpen(null)} />
    </>
  );
}
