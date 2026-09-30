import { Card, Chip, MenuItem, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { users as api } from "../api/endpoints.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ErrorAlert, Loading, PageHeader, ServerPagination } from "../components/common.jsx";
import { formatDate } from "../utils/format.js";

const ROLES = ["OWNER", "ADMIN", "ANALYST", "VIEWER"];

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const q = useQuery({ queryKey: ["users", page, limit], queryFn: () => api.list({ page, limit, sortBy: "createdAt", order: "asc" }), placeholderData: (p) => p });
  const update = useMutation({ mutationFn: ({ id, ...body }) => api.update(id, body), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });

  // The server enforces these rules; mirroring them here just avoids offering choices that will be refused.
  const editable = (u) => u.id !== me.id && (me.role === "OWNER" || !["OWNER", "ADMIN"].includes(u.role));
  const roleOptions = me.role === "OWNER" ? ROLES : ["ANALYST", "VIEWER"];

  return (
    <>
      <PageHeader title="Users" subtitle="Roles take effect immediately; changing one signs that user out." />
      <ErrorAlert error={update.error || q.error} sx={{ mb: 2 }} />
      {q.isPending ? <Loading /> : (
        <Card variant="outlined">
          <Table size="small">
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Role</TableCell><TableCell>Verified</TableCell><TableCell>Active</TableCell><TableCell>Last login</TableCell></TableRow></TableHead>
            <TableBody>
              {q.data.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}{u.id === me.id && <Chip size="small" label="you" sx={{ ml: 1 }} />}</TableCell><TableCell>{u.email}</TableCell>
                  <TableCell>
                    {editable(u) ? (
                      <TextField select size="small" value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value })} slotProps={{ select: { SelectDisplayProps: { "aria-label": `Role for ${u.name}` } } }}>
                        {(roleOptions.includes(u.role) ? roleOptions : [u.role, ...roleOptions]).map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                      </TextField>
                    ) : u.role}
                  </TableCell>
                  <TableCell>{u.isEmailVerified ? "Yes" : <Typography variant="body2" sx={{ color: "warning.main" }}>No</Typography>}</TableCell>
                  <TableCell><Switch checked={u.isActive} disabled={!editable(u)} onChange={(e) => update.mutate({ id: u.id, isActive: e.target.checked })} slotProps={{ input: { "aria-label": `Active: ${u.name}` } }} /></TableCell>
                  <TableCell>{formatDate(u.lastLoginAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ServerPagination pagination={q.data.pagination} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </Card>
      )}
    </>
  );
}
