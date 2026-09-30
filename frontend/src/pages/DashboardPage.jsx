import { Box, Button, Card, CardContent, Chip, LinearProgress, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { dashboard } from "../api/endpoints.js";
import { Empty, ErrorAlert, Loading, PageHeader } from "../components/common.jsx";
import { OpportunityStatusChip, TaskStatusChip } from "../components/chips.jsx";
import { formatCost, formatDate, formatDuration, humanize } from "../utils/format.js";

function Stat({ label, value, hint, to }) {
  const body = (
    <CardContent>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>{label}</Typography>
      <Typography variant="h4" sx={{ fontWeight: 600 }}>{value ?? "—"}</Typography>
      {hint && <Typography variant="caption" sx={{ color: "text.secondary" }}>{hint}</Typography>}
    </CardContent>
  );
  return <Card variant="outlined">{to ? <Box component={RouterLink} to={to} sx={{ color: "inherit", textDecoration: "none", display: "block" }}>{body}</Box> : body}</Card>;
}

export default function DashboardPage() {
  const summary = useQuery({ queryKey: ["dash", "summary"], queryFn: dashboard.summary, refetchInterval: 15_000 });
  const opps = useQuery({ queryKey: ["dash", "opps"], queryFn: dashboard.opportunities, refetchInterval: 15_000 });
  const agents = useQuery({ queryKey: ["dash", "agents"], queryFn: dashboard.agentActivity, refetchInterval: 15_000 });
  const exps = useQuery({ queryKey: ["dash", "exps"], queryFn: dashboard.experiments, refetchInterval: 15_000 });

  const error = summary.error || opps.error || agents.error || exps.error;
  if (summary.isPending) return <Loading />;
  const s = summary.data;
  const byStatus = opps.data?.byStatus ?? {};
  const maxStatus = Math.max(1, ...Object.values(byStatus));

  return (
    <>
      <PageHeader title="Overview" subtitle="What the factory has found, what needs a human decision, and what the agents are doing." actions={<Button component={RouterLink} to="/discovery" variant="contained">Run discovery</Button>} />
      <ErrorAlert error={error} sx={{ mb: 2 }} onRetry={() => [summary, opps, agents, exps].forEach((q) => q.refetch())} />

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, mb: 3 }}>
        <Stat label="Opportunities" value={s?.opportunities} to="/opportunities" />
        <Stat label="Awaiting your approval" value={s?.awaitingApproval} hint="Needs an owner/admin decision" to="/opportunities?status=AWAITING_APPROVAL" />
        <Stat label="Analysed (validated)" value={s?.validated} hint="Evidence attached — not proven profitable" />
        <Stat label="Approved" value={s?.approved} />
        <Stat label="Experiments running" value={s?.experimentsRunning} to="/experiments?status=RUNNING" />
        <Stat label="Agents running" value={s?.agentsRunning} hint={`${s?.tasksQueued ?? 0} queued`} to="/agents" />
        <Stat label="Tasks needing review" value={s?.tasksNeedingReview} hint="Retries exhausted" to="/agents?tab=tasks&status=WAITING_REVIEW" />
        <Stat label="AI cost" value={s?.ai?.estimatedCost ? `$${s.ai.estimatedCost.toFixed(2)}` : "not priced"} hint={`${(s?.ai?.totalTokens ?? 0).toLocaleString()} tokens · ${s?.ai?.runs ?? 0} runs`} />
      </Box>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Pipeline</Typography>
            {Object.keys(byStatus).length === 0 ? <Empty>No opportunities yet. Run a discovery to find some.</Empty> : (
              <Stack spacing={1.5}>
                {Object.entries(byStatus).map(([status, n]) => (
                  <Box key={status} component={RouterLink} to={`/opportunities?status=${status}`} sx={{ color: "inherit", textDecoration: "none" }}>
                    <Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="body2">{humanize(status)}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{n}</Typography></Stack>
                    <LinearProgress variant="determinate" value={(n / maxStatus) * 100} sx={{ height: 6, borderRadius: 3 }} />
                  </Box>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Recent discoveries</Typography>
            {!opps.data?.recent?.length ? <Empty>Nothing yet.</Empty> : (
              <Table size="small">
                <TableBody>
                  {opps.data.recent.map((o) => (
                    <TableRow key={o.id} hover>
                      <TableCell><Link component={RouterLink} to={`/opportunities/${o.id}`}>{o.name}</Link><Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>{o.category || "Uncategorized"} · {formatDate(o.createdAt)}</Typography></TableCell>
                      <TableCell align="right"><OpportunityStatusChip status={o.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Agent activity</Typography>
            {!agents.data?.byAgent?.length ? <Empty>No agent runs yet.</Empty> : (
              <Table size="small">
                <TableHead><TableRow><TableCell>Agent</TableCell><TableCell align="right">Runs</TableCell><TableCell align="right">Failed</TableCell><TableCell align="right">Avg time</TableCell><TableCell align="right">Cost</TableCell></TableRow></TableHead>
                <TableBody>
                  {agents.data.byAgent.map((a) => (
                    <TableRow key={a.agentType}>
                      <TableCell>{humanize(a.agentType)}</TableCell><TableCell align="right">{a.runs}</TableCell>
                      <TableCell align="right">{a.failed ? <Chip size="small" color="error" label={a.failed} /> : 0}</TableCell>
                      <TableCell align="right">{formatDuration(a.avgDurationMs)}</TableCell><TableCell align="right">{formatCost(a.estimatedCost || null)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {agents.data?.active?.length > 0 && (
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 2 }}>
                {agents.data.active.slice(0, 8).map((t) => <Stack key={t.id} direction="row" spacing={0.5} sx={{ alignItems: "center" }}><Typography variant="caption">{humanize(t.agentType)}</Typography><TaskStatusChip status={t.status} /></Stack>)}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Experiments</Typography>
            {!exps.data?.recent?.length ? <Empty>No experiments yet. Approve an opportunity to start one.</Empty> : (
              <Table size="small">
                <TableBody>
                  {exps.data.recent.slice(0, 6).map((e) => (
                    <TableRow key={e.id}><TableCell><Link component={RouterLink} to="/experiments">{e.name}</Link></TableCell><TableCell align="right">{humanize(e.status)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Box>
    </>
  );
}
