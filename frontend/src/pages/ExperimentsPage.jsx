import { Card, Link, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { experiments as api } from "../api/endpoints.js";
import { ExperimentStatusChip } from "../components/chips.jsx";
import { Empty, ErrorAlert, Loading, PageHeader, ServerPagination } from "../components/common.jsx";
import { ExperimentDialog } from "../components/experiments.jsx";
import { formatDate, formatMoney, humanize } from "../utils/format.js";

const STATUSES = ["DRAFT", "READY", "RUNNING", "COMPLETED", "CANCELLED"];

export default function ExperimentsPage() {
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState(null);
  const status = params.get("status") ?? "";
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const q = useQuery({ queryKey: ["experiments", "list", status, page, limit], queryFn: () => api.list({ status, page, limit }), placeholderData: (p) => p });

  return (
    <>
      <PageHeader title="Experiments" subtitle="The smallest tests that produce real customer evidence. Create them from an approved opportunity." />
      <Stack direction="row" sx={{ mb: 2 }}>
        <TextField size="small" select label="Status" value={status} sx={{ minWidth: 180 }} onChange={(e) => { setPage(1); const n = new URLSearchParams(params); e.target.value ? n.set("status", e.target.value) : n.delete("status"); setParams(n, { replace: true }); }}>
          <MenuItem value="">All</MenuItem>{STATUSES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
        </TextField>
      </Stack>
      <ErrorAlert error={q.error} onRetry={q.refetch} sx={{ mb: 2 }} />
      {q.isPending ? <Loading /> : (
        <Card variant="outlined">
          <Table size="small">
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Status</TableCell><TableCell>Opportunity</TableCell><TableCell>Budget</TableCell><TableCell>Created</TableCell></TableRow></TableHead>
            <TableBody>
              {q.data.items.map((e) => (
                <TableRow key={e.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpenId(e.id)}>
                  <TableCell>{e.name}</TableCell><TableCell><ExperimentStatusChip status={e.status} /></TableCell>
                  <TableCell><Link component={RouterLink} to={`/opportunities/${e.opportunityId}?tab=experiments`} onClick={(ev) => ev.stopPropagation()}>View</Link></TableCell>
                  <TableCell>{e.budget ? formatMoney(e.budget, e.currency) : "—"}</TableCell><TableCell>{formatDate(e.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {q.data.items.length === 0 && <Empty>No experiments{status ? " with this status" : " yet"}.</Empty>}
          <ServerPagination pagination={q.data.pagination} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </Card>
      )}
      {openId && <ExperimentDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
