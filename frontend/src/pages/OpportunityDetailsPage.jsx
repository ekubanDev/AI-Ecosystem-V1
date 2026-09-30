import { ArrowBack } from "@mui/icons-material";
import {
  Alert, Box, Button, Card, CardContent, Chip, Link, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { agents as agentsApi, audit as auditApi, opportunities as api } from "../api/endpoints.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { RunDetailDialog, SourceLink, TaskRunsDialog, TaskTable } from "../components/agentViews.jsx";
import { ConfidenceChip, EvidenceTypeChip, ExperimentStatusChip, OpportunityStatusChip } from "../components/chips.jsx";
import { ActionDialog, Empty, ErrorAlert, Loading } from "../components/common.jsx";
import { ExperimentDialog, ExperimentFormDialog } from "../components/experiments.jsx";
import { describeActor, describeAuditEvent } from "../utils/audit.js";
import { formatDate, formatMoney, humanize } from "../utils/format.js";
import { AuditDetailDialog } from "./AuditPage.jsx";

const TABS = ["overview", "evidence", "business-model", "competitors", "economics", "differentiation", "experiments", "agent-runs", "decision", "history"];
const TAB_LABEL = { overview: "Overview", evidence: "Evidence", "business-model": "Business model", competitors: "Competitors", economics: "Economics", differentiation: "Differentiation", experiments: "Experiments", "agent-runs": "Agent runs", decision: "Decision", history: "History" };

const KV = ({ label, children }) => (
  <Box><Typography variant="caption" sx={{ color: "text.secondary" }}>{label}</Typography><Typography variant="body2" component="div" sx={{ whiteSpace: "pre-wrap" }}>{children || "—"}</Typography></Box>
);
const Section = ({ title, children }) => (
  <Card variant="outlined" sx={{ mb: 2 }}><CardContent><Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>{title}</Typography>{children}</CardContent></Card>
);
const List = ({ items, empty = "None recorded." }) => (items?.length ? <ul style={{ margin: 0, paddingLeft: 20 }}>{items.map((x, i) => <li key={i}><Typography variant="body2">{x}</Typography></li>)}</ul> : <Typography variant="body2" sx={{ color: "text.secondary" }}>{empty}</Typography>);
const grid = { display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } };

function Overview({ o }) {
  return (
    <>
      <Section title="Summary">
        <Box sx={grid}>
          <KV label="Description">{o.description}</KV>
          <KV label="Problem">{o.problem}</KV>
          <KV label="Proposed solution">{o.proposedSolution}</KV>
          <KV label="Target customer">{[o.targetCustomer?.segment, o.targetCustomer?.businessType].filter(Boolean).join(" · ")}</KV>
          <KV label="Geography">{o.targetCustomer?.geography}</KV>
          <KV label="Business model">{o.businessModel?.type ? `${humanize(o.businessModel.type)}${o.businessModel.revenueMechanism ? ` — ${o.businessModel.revenueMechanism}` : ""}` : null}</KV>
          <KV label="Pricing">{o.pricing?.minimum != null ? `${formatMoney(o.pricing.minimum, o.pricing.currency)} – ${formatMoney(o.pricing.maximum, o.pricing.currency)}${o.pricing.pricingEvidence ? `\n${o.pricing.pricingEvidence}` : ""}` : null}</KV>
          <KV label="Retention">{o.retentionMechanism}</KV>
          <KV label="Acquisition channels">{o.acquisitionChannels?.join(", ")}</KV>
        </Box>
      </Section>
      <Section title="Demand signals">
        {o.demandSignals?.length ? (
          <Table size="small"><TableHead><TableRow><TableCell>Observation</TableCell><TableCell>Source</TableCell><TableCell>Strength</TableCell></TableRow></TableHead>
            <TableBody>{o.demandSignals.map((d, i) => <TableRow key={i}><TableCell>{d.observation}</TableCell><TableCell sx={{ maxWidth: 240, wordBreak: "break-all" }}>{d.source}</TableCell><TableCell>{humanize(d.strength)}</TableCell></TableRow>)}</TableBody></Table>
        ) : <Typography variant="body2" sx={{ color: "text.secondary" }}>None recorded.</Typography>}
      </Section>
      <Section title="Risks">
        {o.risks?.length ? <Table size="small"><TableBody>{o.risks.map((r, i) => <TableRow key={i}><TableCell width={110}><Chip size="small" label={r.severity} color={{ CRITICAL: "error", HIGH: "error", MEDIUM: "warning" }[r.severity] ?? "default"} /></TableCell><TableCell>{r.category}</TableCell><TableCell>{r.description}</TableCell></TableRow>)}</TableBody></Table> : <Typography variant="body2" sx={{ color: "text.secondary" }}>None recorded.</Typography>}
      </Section>
      <Box sx={grid}>
        <Section title="Uncertainties — what we don't know"><List items={o.uncertainties} /></Section>
        <Section title="Assumptions"><List items={o.assumptions} /></Section>
      </Box>
      <Section title="Hypotheses"><List items={o.hypotheses?.map((h) => `${h.statement} (${humanize(h.status)})`)} /></Section>
    </>
  );
}

function Evidence({ o }) {
  const [area, setArea] = useState("all");
  const byId = new Map(o.sources.map((s) => [s.id, s]));
  const areas = [...new Set(o.evidence.map((e) => e.area ?? "other"))];
  const rows = o.evidence.filter((e) => area === "all" || (e.area ?? "other") === area);
  const cited = o.evidence.filter((e) => e.sourceId).length;
  if (!o.evidence.length) return <Empty>No evidence recorded yet. Run an analysis to gather some.</Empty>;
  return (
    <>
      <Alert severity={cited === o.evidence.length ? "success" : "info"} sx={{ mb: 2 }}>
        {cited} of {o.evidence.length} claims cite a stored source. Claims without one are AI inference and are labelled as such — treat them as hypotheses.
      </Alert>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
        <Chip label="All" color={area === "all" ? "primary" : "default"} onClick={() => setArea("all")} />
        {areas.map((a) => <Chip key={a} label={humanize(a)} color={area === a ? "primary" : "default"} onClick={() => setArea(a)} />)}
      </Stack>
      <Table size="small">
        <TableHead><TableRow><TableCell>Claim</TableCell><TableCell>Evidence type</TableCell><TableCell>Confidence</TableCell><TableCell>Area</TableCell><TableCell>Source</TableCell></TableRow></TableHead>
        <TableBody>
          {rows.map((e, i) => (
            <TableRow key={i}>
              <TableCell>{e.claim}</TableCell><TableCell><EvidenceTypeChip type={e.evidenceType} /></TableCell><TableCell>{humanize(e.confidence)}</TableCell>
              <TableCell>{humanize(e.area ?? "other")}</TableCell>
              <TableCell>{e.sourceId ? <SourceLink source={byId.get(e.sourceId)} /> : <Typography variant="caption" sx={{ color: "text.secondary" }}>No source</Typography>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>Sources ({o.sources.length})</Typography>
      <Table size="small">
        <TableHead><TableRow><TableCell>Title</TableCell><TableCell>Type</TableCell><TableCell>Retrieved</TableCell></TableRow></TableHead>
        <TableBody>{o.sources.map((s) => <TableRow key={s.id}><TableCell><SourceLink source={s} /><Typography variant="caption" sx={{ display: "block", color: "text.secondary", wordBreak: "break-all" }}>{s.url}</Typography></TableCell><TableCell>{humanize(s.sourceType)}</TableCell><TableCell>{formatDate(s.retrievedAt)}</TableCell></TableRow>)}</TableBody>
      </Table>
    </>
  );
}

const BM_FIELDS = [["customer", "Customer"], ["problem", "Problem"], ["valueProposition", "Value proposition"], ["product", "Product"], ["acquisition", "Acquisition"], ["conversion", "Conversion"], ["pricing", "Pricing"], ["delivery", "Delivery"], ["retention", "Retention"], ["upsell", "Upsell"], ["referral", "Referral"]];

function BusinessModel({ o }) {
  const bm = o.businessModelDetail;
  if (!bm) return <Empty>No business model analysis yet.</Empty>;
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}><Typography variant="body2">Revenue model: <b>{humanize(bm.revenueModel)}</b></Typography><ConfidenceChip confidence={bm.confidence} /></Stack>
      <Table size="small">
        <TableHead><TableRow><TableCell width={170}>Business DNA</TableCell><TableCell>Reconstruction</TableCell><TableCell width={130}>Evidence</TableCell></TableRow></TableHead>
        <TableBody>{BM_FIELDS.map(([k, label]) => <TableRow key={k}><TableCell>{label}</TableCell><TableCell>{bm[k] || "—"}</TableCell><TableCell><EvidenceTypeChip type={bm.evidenceTypes?.[k]} /></TableCell></TableRow>)}</TableBody>
      </Table>
      <Box sx={{ ...grid, mt: 3 }}>
        <Section title="Operational dependencies"><List items={bm.operationalDependencies} /></Section>
        <Section title="Technology dependencies"><List items={bm.technologyDependencies} /></Section>
      </Box>
    </>
  );
}

function Competitors({ o }) {
  if (!o.competitors.length) return <Empty>No competitors profiled. Unknown is shown as unknown — nothing is invented.</Empty>;
  const Row = ({ label, items }) => <KV label={label}>{items?.length ? items.join("; ") : null}</KV>;
  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
      {o.competitors.map((c) => (
        <Card key={c.id} variant="outlined"><CardContent>
          <Typography variant="h6">{c.name}</Typography>
          {c.website && /^https?:\/\//.test(c.website) && <Link href={c.website} target="_blank" rel="noopener noreferrer nofollow" variant="body2">{c.website}</Link>}
          <Stack spacing={1.5} sx={{ mt: 1.5 }}>
            <KV label="Segment / geography">{[c.customerSegment, c.geography].filter(Boolean).join(" · ")}</KV>
            <KV label="Pricing">{c.pricing || "Unknown"}</KV>
            <KV label="Business model">{c.businessModel}</KV>
            <Row label="Products" items={c.products} /><Row label="Acquisition" items={c.acquisitionChannels} />
            <Row label="Strengths" items={c.strengths} /><Row label="Weaknesses" items={c.weaknesses} />
            <Row label="Customer complaints" items={c.customerComplaints} /><Row label="Differentiation opportunities" items={c.differentiationOpportunities} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>{c.evidenceIds?.length ? `${c.evidenceIds.length} supporting source(s)` : "No supporting sources"}</Typography>
          </Stack>
        </CardContent></Card>
      ))}
    </Box>
  );
}

function Economics({ o }) {
  const a = o.analysis?.assessment;
  const e = o.economics ?? {};
  const hasEstimates = e.estimatedCAC != null || e.estimatedLTV != null || e.estimatedARPU != null || e.estimatedMargin != null;
  if (!a && !hasEstimates) return <Empty>No analysis yet.</Empty>;
  const rated = a && [["Demand", a.demand], ["Competition", a.competition], ["Monetization", a.monetization], ["Recurring revenue potential", a.recurringRevenuePotential]];
  return (
    <>
      {a && (
        <Section title="Assessment">
          <Table size="small"><TableHead><TableRow><TableCell>Dimension</TableCell><TableCell>Rating</TableCell><TableCell>Confidence</TableCell></TableRow></TableHead>
            <TableBody>
              {rated.map(([l, r]) => <TableRow key={l}><TableCell>{l}</TableCell><TableCell>{humanize(r?.value)}</TableCell><TableCell><ConfidenceChip confidence={r?.confidence} /></TableCell></TableRow>)}
              {[["Acquisition difficulty", a.acquisitionDifficulty], ["Technical complexity", a.technicalComplexity], ["Operational complexity", a.operationalComplexity], ["Capital requirement", a.capitalRequirement]].map(([l, v]) => <TableRow key={l}><TableCell>{l}</TableCell><TableCell colSpan={2}>{humanize(v)}</TableCell></TableRow>)}
            </TableBody>
          </Table>
          {a.regulatoryConsiderations?.length > 0 && <Box sx={{ mt: 2 }}><Typography variant="subtitle2">Regulatory considerations</Typography><List items={a.regulatoryConsiderations} /></Box>}
        </Section>
      )}
      <Section title="Unit economics (estimates)">
        {hasEstimates ? (
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>These are AI estimates, not facts. Confidence: <b>{humanize(e.confidence)}</b>. Validate with a real experiment before relying on them.</Alert>
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <KV label="Est. CAC">{e.estimatedCAC}</KV><KV label="Est. LTV">{e.estimatedLTV}</KV><KV label="Est. ARPU">{e.estimatedARPU}</KV>
              <KV label="Est. margin">{e.estimatedMargin != null ? (e.estimatedMargin <= 1 ? `${Math.round(e.estimatedMargin * 100)}%` : e.estimatedMargin) : null}</KV>
            </Box>
            <Box sx={{ mt: 2 }}><KV label="Basis for the estimate">{e.basis}</KV></Box>
          </>
        ) : <Typography variant="body2" sx={{ color: "text.secondary" }}>No estimates were made — the agent had no basis for them, and none are invented.</Typography>}
      </Section>
      {o.validationPlan?.objective && (
        <Section title="Recommended validation">
          <Box sx={grid}><KV label="Objective">{o.validationPlan.objective}</KV><KV label="Method">{o.validationPlan.method}</KV><KV label="Budget">{o.validationPlan.budget}</KV><KV label="Success criteria">{o.validationPlan.successCriteria}</KV></Box>
        </Section>
      )}
    </>
  );
}

function Differentiation({ o }) {
  const loc = o.analysis?.assessment?.localization;
  return (
    <>
      <Section title="Differentiation ideas">
        {o.differentiation?.length ? (
          <Table size="small"><TableHead><TableRow><TableCell>Idea</TableCell><TableCell>Rationale</TableCell><TableCell>Geography</TableCell></TableRow></TableHead>
            <TableBody>{o.differentiation.map((d, i) => <TableRow key={i}><TableCell>{d.idea}</TableCell><TableCell>{d.rationale}</TableCell><TableCell>{d.geography}</TableCell></TableRow>)}</TableBody></Table>
        ) : <Typography variant="body2" sx={{ color: "text.secondary" }}>None recorded.</Typography>}
      </Section>
      <Section title="Localization">
        {loc ? <><Typography variant="body2" sx={{ mb: 1 }}>{loc.summary}</Typography><ConfidenceChip confidence={loc.confidence} /></> : <Typography variant="body2" sx={{ color: "text.secondary" }}>No localization analysis yet. Treat local fit as an independent hypothesis to test.</Typography>}
      </Section>
    </>
  );
}

function ExperimentsTab({ o }) {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const eligible = ["APPROVED", "EXPERIMENT"].includes(o.status);
  return (
    <>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>{eligible ? "Design the cheapest credible test of the riskiest assumption." : "Experiments can be created once the opportunity is approved."}</Typography>
        {can("experiments:write") && <Button variant="contained" disabled={!eligible} onClick={() => setCreating(true)}>New experiment</Button>}
      </Stack>
      {o.experiments.length === 0 ? <Empty>No experiments yet.</Empty> : (
        <Table size="small"><TableHead><TableRow><TableCell>Name</TableCell><TableCell>Status</TableCell><TableCell>Budget</TableCell><TableCell>Created</TableCell></TableRow></TableHead>
          <TableBody>{o.experiments.map((x) => <TableRow key={x.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpenId(x.id)}><TableCell>{x.name}</TableCell><TableCell><ExperimentStatusChip status={x.status} /></TableCell><TableCell>{x.budget ? formatMoney(x.budget, x.currency) : "—"}</TableCell><TableCell>{formatDate(x.createdAt)}</TableCell></TableRow>)}</TableBody></Table>
      )}
      {creating && <ExperimentFormDialog open opportunityId={o.id} onClose={() => setCreating(false)} />}
      {openId && <ExperimentDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function AgentRunsTab({ o }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [taskForRuns, setTaskForRuns] = useState(null);
  const [runId, setRunId] = useState(null);
  const [retry, setRetry] = useState(null);
  const q = useQuery({ queryKey: ["agents", "tasks", "opp", o.id], queryFn: () => agentsApi.tasks({ opportunityId: o.id, limit: 50, order: "asc" }), refetchInterval: (query) => (query.state.data?.items.some((t) => ["QUEUED", "RUNNING", "RETRYING"].includes(t.status)) ? 3000 : false) });
  return (
    <>
      <ErrorAlert error={q.error} />
      {q.isPending ? <Loading /> : <TaskTable tasks={q.data.items} canRetry={can("agents:runDirect")} onViewRuns={setTaskForRuns} onRetry={setRetry} />}
      <TaskRunsDialog task={taskForRuns} onClose={() => setTaskForRuns(null)} onOpenRun={setRunId} />
      {runId && <RunDetailDialog id={runId} onClose={() => setRunId(null)} />}
      <ActionDialog open={!!retry} title="Retry this task?" description="It goes back to the queue with its retry count reset." confirmLabel="Retry" onConfirm={async () => { await agentsApi.retryTask(retry.id); qc.invalidateQueries({ queryKey: ["agents"] }); }} onClose={() => setRetry(null)} />
    </>
  );
}

function History({ o }) {
  const [open, setOpen] = useState(null);
  const q = useQuery({ queryKey: ["audit", "opportunity", o.id], queryFn: () => auditApi.list({ resourceType: "Opportunity", resourceId: o.id, order: "asc", limit: 100 }) });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={q.refetch} />;
  if (!q.data.items.length) return <Empty>No recorded events.</Empty>;
  return (
    <>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>Who or what changed this opportunity, oldest first. Select an event for full detail.</Typography>
      <Table size="small">
        <TableHead><TableRow><TableCell>When</TableCell><TableCell>Actor</TableCell><TableCell>Event</TableCell><TableCell>Detail</TableCell></TableRow></TableHead>
        <TableBody>
          {q.data.items.map((e) => (
            <TableRow key={e.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpen(e)}>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(e.createdAt)}</TableCell><TableCell>{describeActor(e.actor)}</TableCell><TableCell>{humanize(e.action)}</TableCell><TableCell>{describeAuditEvent(e) || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {q.data.pagination.hasNextPage && <Typography variant="caption" sx={{ color: "text.secondary" }}>Showing the first 100 events.</Typography>}
      <AuditDetailDialog event={open} onClose={() => setOpen(null)} />
    </>
  );
}

const TERMINAL = ["REJECTED"];
const ANALYZABLE = ["DISCOVERED", "RESEARCHING", "ANALYZING", "VALIDATED", "AWAITING_APPROVAL"];
const PAUSABLE = ["DISCOVERED", "RESEARCHING", "ANALYZING", "VALIDATED", "AWAITING_APPROVAL", "APPROVED", "EXPERIMENT", "BUILDING", "LAUNCHED", "SCALING"];

function Decision({ o, act }) {
  const { can } = useAuth();
  const approve = can("opportunities:approve");
  const [dlg, setDlg] = useState(null);
  const d = o.decision;
  return (
    <>
      {d?.action && <Alert severity={d.action === "REJECTED" ? "error" : "info"} sx={{ mb: 2 }}>{humanize(d.action)} {formatDate(d.at)}{d.note ? ` — ${d.note}` : ""}</Alert>}
      {o.status === "AWAITING_APPROVAL" && <Alert severity="warning" sx={{ mb: 2 }}>Analysis is complete and waiting for a human decision. Approving allows experiments; it does not commit any spend.</Alert>}
      {!approve && <Alert severity="info" sx={{ mb: 2 }}>Only owners and admins can approve, reject or pause.</Alert>}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        {approve && o.status === "AWAITING_APPROVAL" && <Button variant="contained" color="success" onClick={() => setDlg("approve")}>Approve</Button>}
        {approve && !TERMINAL.includes(o.status) && <Button variant="outlined" color="error" onClick={() => setDlg("reject")}>Reject</Button>}
        {approve && PAUSABLE.includes(o.status) && <Button variant="outlined" onClick={() => setDlg("pause")}>Pause</Button>}
        {approve && o.status === "PAUSED" && <Button variant="outlined" onClick={() => act.resume.mutate()}>Resume{o.pausedFromStatus ? ` (${humanize(o.pausedFromStatus)})` : ""}</Button>}
        {can("agents:run") && ANALYZABLE.includes(o.status) && <Button variant="outlined" onClick={() => act.analyze.mutate()}>{o.status === "DISCOVERED" ? "Run analysis" : "Re-run analysis"}</Button>}
        {can("opportunities:write") && <Button color="error" onClick={() => setDlg("delete")}>Delete</Button>}
      </Stack>
      <ErrorAlert error={act.resume.error || act.analyze.error} sx={{ mt: 2 }} />
      {act.analyze.isSuccess && <Alert severity="success" sx={{ mt: 2 }}>Analysis queued. Follow it on the Agent runs tab.</Alert>}

      <ActionDialog open={dlg === "approve"} title="Approve this opportunity?" description="This records your decision and moves it to Approved." confirmLabel="Approve" color="success" noteLabel="Note" onConfirm={(n) => act.approve(n)} onClose={() => setDlg(null)} />
      <ActionDialog open={dlg === "reject"} title="Reject this opportunity?" description="Rejection is final." confirmLabel="Reject" color="error" noteLabel="Reason" noteRequired onConfirm={(n) => act.reject(n)} onClose={() => setDlg(null)} />
      <ActionDialog open={dlg === "pause"} title="Pause this opportunity?" description="Any analysis in progress stops quietly; resume returns it to where it was." confirmLabel="Pause" noteLabel="Note" onConfirm={(n) => act.pause(n)} onClose={() => setDlg(null)} />
      <ActionDialog open={dlg === "delete"} title="Delete this opportunity?" description="It disappears from lists. Its audit history is kept." confirmLabel="Delete" color="error" onConfirm={() => act.remove()} onClose={() => setDlg(null)} />
    </>
  );
}

export default function OpportunityDetailsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.includes(requested) && (requested !== "history" || can("audit:read")) ? requested : "overview";

  const q = useQuery({ queryKey: ["opportunity", id], queryFn: () => api.get(id), refetchInterval: (query) => (["RESEARCHING", "ANALYZING"].includes(query.state.data?.status) ? 4000 : false) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["opportunity", id] });
    qc.invalidateQueries({ queryKey: ["opportunities"] });
    qc.invalidateQueries({ queryKey: ["dash"] });
    qc.invalidateQueries({ queryKey: ["agents"] });
  };
  const wrap = (fn) => async (...a) => { await fn(...a); refresh(); };
  const act = {
    approve: wrap((n) => api.approve(id, n)),
    reject: wrap((r) => api.reject(id, r)),
    pause: wrap((n) => api.pause(id, n)),
    remove: async () => { await api.remove(id); qc.invalidateQueries({ queryKey: ["opportunities"] }); qc.invalidateQueries({ queryKey: ["dash"] }); nav("/opportunities", { replace: true }); },
    resume: useMutation({ mutationFn: () => api.resume(id), onSuccess: refresh }),
    analyze: useMutation({ mutationFn: () => api.analyze(id), onSuccess: refresh }),
  };

  if (q.isPending) return <Loading />;
  if (q.error) return <><Button component={RouterLink} to="/opportunities" startIcon={<ArrowBack />}>Opportunities</Button><ErrorAlert error={q.error} sx={{ mt: 2 }} onRetry={q.refetch} /></>;
  const o = q.data;
  const setTab = (t) => { const n = new URLSearchParams(params); n.set("tab", t); setParams(n, { replace: true }); };

  return (
    <>
      <Button component={RouterLink} to="/opportunities" startIcon={<ArrowBack />} size="small" sx={{ mb: 1 }}>Opportunities</Button>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, mb: 1 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>{o.name}</Typography>
        <OpportunityStatusChip status={o.status} />
        {["RESEARCHING", "ANALYZING"].includes(o.status) && <Typography variant="caption" sx={{ color: "text.secondary" }}>analysis in progress…</Typography>}
      </Stack>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>{[o.category, o.targetCustomer?.geography].filter(Boolean).join(" · ")} · discovered {formatDate(o.createdAt)}</Typography>
      {o.status === "AWAITING_APPROVAL" && can("opportunities:approve") && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => setTab("decision")}>Review &amp; decide</Button>}>Analysis is done and this opportunity is waiting for your decision.</Alert>
      )}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        {TABS.filter((t) => t !== "history" || can("audit:read")).map((t) => <Tab key={t} value={t} label={TAB_LABEL[t]} />)}
      </Tabs>
      {tab === "overview" && <Overview o={o} />}
      {tab === "evidence" && <Evidence o={o} />}
      {tab === "business-model" && <BusinessModel o={o} />}
      {tab === "competitors" && <Competitors o={o} />}
      {tab === "economics" && <Economics o={o} />}
      {tab === "differentiation" && <Differentiation o={o} />}
      {tab === "experiments" && <ExperimentsTab o={o} />}
      {tab === "agent-runs" && <AgentRunsTab o={o} />}
      {tab === "decision" && <Decision o={o} act={act} />}
      {tab === "history" && can("audit:read") && <History o={o} />}
    </>
  );
}
