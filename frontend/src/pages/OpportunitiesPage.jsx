import { Add, Search } from "@mui/icons-material";
import {
  Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Link, MenuItem, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TableSortLabel, TextField, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { opportunities as api } from "../api/endpoints.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { OpportunityStatusChip } from "../components/chips.jsx";
import { Empty, ErrorAlert, Loading, PageHeader, ServerPagination } from "../components/common.jsx";
import { formatDate, humanize } from "../utils/format.js";

export const STATUSES = ["DISCOVERED", "RESEARCHING", "ANALYZING", "VALIDATED", "AWAITING_APPROVAL", "APPROVED", "EXPERIMENT", "BUILDING", "LAUNCHED", "SCALING", "PAUSED", "REJECTED"];
export const MODEL_TYPES = ["SAAS", "MARKETPLACE", "AGENCY", "PRODUCTIZED_SERVICE", "SUBSCRIPTION", "API", "DATA", "LEAD_GENERATION", "AFFILIATE", "DIGITAL_PRODUCT", "COMMUNITY", "MEDIA", "EDUCATION", "PROCUREMENT", "DIRECTORY", "AGGREGATOR", "HYBRID", "OTHER"];

const SORTABLE = [["name", "Name"], ["status", "Status"], ["category", "Category"], ["createdAt", "Discovered"]];

function CreateDialog({ open, onClose }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", category: "", description: "", problem: "", geography: "" });
  const create = useMutation({
    mutationFn: () => api.create({
      name: form.name.trim(), ...(form.category && { category: form.category.trim() }), ...(form.description && { description: form.description.trim() }),
      ...(form.problem && { problem: form.problem.trim() }), ...(form.geography && { targetCustomer: { geography: form.geography.trim() } }),
    }),
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
      onClose();
      nav(`/opportunities/${o.id}`);
    },
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New opportunity</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name" required autoFocus value={form.name} onChange={set("name")} />
          <TextField label="Category" value={form.category} onChange={set("category")} />
          <TextField label="Target geography" value={form.geography} onChange={set("geography")} />
          <TextField label="Description" multiline minRows={2} value={form.description} onChange={set("description")} />
          <TextField label="Problem" multiline minRows={2} value={form.problem} onChange={set("problem")} />
          <ErrorAlert error={create.error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function OpportunitiesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);

  const filters = {
    q, status: params.get("status") ?? "", category: params.get("category") ?? "", geography: params.get("geography") ?? "",
    businessModelType: params.get("businessModelType") ?? "", sortBy: params.get("sortBy") ?? "createdAt", order: params.get("order") ?? "desc",
    page: Number(params.get("page") ?? 1), limit: Number(params.get("limit") ?? 20),
  };
  // Functional update: always builds on the latest URL params, so a debounced search can't overwrite a filter changed meanwhile.
  const update = useCallback(
    (patch) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) (v === "" || v == null ? next.delete(k) : next.set(k, v));
          if (!("page" in patch)) next.delete("page"); // any filter change returns to page 1
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );

  // Debounce free-text search so each keystroke doesn't hit the API.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search }), 350);
    return () => clearTimeout(t);
  }, [search, q, update]);

  const query = useQuery({ queryKey: ["opportunities", filters], queryFn: () => api.list(filters), placeholderData: (prev) => prev });

  return (
    <>
      <PageHeader title="Opportunities" subtitle="Every finding with its evidence, awaiting or past a human decision." actions={can("opportunities:write") && <Button startIcon={<Add />} variant="contained" onClick={() => setCreating(true)}>New opportunity</Button>} />
      <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "2fr 1fr 1fr 1fr 1fr" } }}>
          <TextField size="small" label="Search" value={search} onChange={(e) => setSearch(e.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }} />
          <TextField size="small" select label="Status" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
            <MenuItem value="">All</MenuItem>{STATUSES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Business model" value={filters.businessModelType} onChange={(e) => update({ businessModelType: e.target.value })}>
            <MenuItem value="">All</MenuItem>{MODEL_TYPES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Category" value={filters.category} onChange={(e) => update({ category: e.target.value })} />
          <TextField size="small" label="Geography" value={filters.geography} onChange={(e) => update({ geography: e.target.value })} />
        </Box>
      </Card>

      <ErrorAlert error={query.error} onRetry={query.refetch} sx={{ mb: 2 }} />
      {query.isPending ? <Loading /> : (
        <Card variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {SORTABLE.map(([key, label]) => (
                    <TableCell key={key} sortDirection={filters.sortBy === key ? filters.order : false}>
                      <TableSortLabel active={filters.sortBy === key} direction={filters.sortBy === key ? filters.order : "asc"} onClick={() => update({ sortBy: key, order: filters.sortBy === key && filters.order === "asc" ? "desc" : "asc" })}>{label}</TableSortLabel>
                    </TableCell>
                  ))}
                  <TableCell>Customer / geography</TableCell><TableCell>Model</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {query.data.items.map((o) => (
                  <TableRow key={o.id} hover>
                    <TableCell><Link component={RouterLink} to={`/opportunities/${o.id}`} sx={{ fontWeight: 600 }}>{o.name}</Link><Typography variant="caption" noWrap sx={{ display: "block", color: "text.secondary", maxWidth: 360 }}>{o.description}</Typography></TableCell>
                    <TableCell><OpportunityStatusChip status={o.status} /></TableCell>
                    <TableCell>{o.category || "—"}</TableCell>
                    <TableCell>{formatDate(o.createdAt)}</TableCell>
                    <TableCell><Typography variant="body2">{o.targetCustomer?.segment || "—"}</Typography><Typography variant="caption" sx={{ color: "text.secondary" }}>{o.targetCustomer?.geography}</Typography></TableCell>
                    <TableCell>{humanize(o.businessModel?.type)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {query.data.items.length === 0 && <Empty>No opportunities match. {can("agents:run") && <Link component={RouterLink} to="/discovery">Run a discovery</Link>}</Empty>}
          <ServerPagination pagination={query.data.pagination} onPage={(page) => update({ page })} onLimit={(limit) => update({ limit })} />
        </Card>
      )}
      <CreateDialog key={String(creating)} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
