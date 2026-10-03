import { Alert, Button, Chip, List, ListItem, ListItemText, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { agents as agentsApi, opportunities as oppApi } from "../api/endpoints.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { Empty, ErrorAlert } from "./common.jsx";
import { EvidenceTypeChip, TaskStatusChip } from "./chips.jsx";
import { formatDate, formatMoney } from "../utils/format.js";

const APPROVED = ["APPROVED", "EXPERIMENT", "BUILDING", "LAUNCHED", "SCALING"]; // mirrors backend/models/constants.js
const ACTIVE = ["QUEUED", "RUNNING", "RETRYING"];

const Section = ({ title, children }) => (
  <section style={{ marginBottom: 24 }}>
    <Typography variant="h6" component="h2" sx={{ mb: 1 }}>{title}</Typography>
    {children}
  </section>
);
const Bullets = ({ items, empty = "None." }) =>
  items?.length ? <List dense disablePadding>{items.map((t, i) => <ListItem key={i} disableGutters><ListItemText primary={t} /></ListItem>)}</List> : <Typography variant="body2" sx={{ color: "text.secondary" }}>{empty}</Typography>;

export function BlueprintTab({ o }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const b = o.blueprint;
  const eligible = APPROVED.includes(o.status);
  const tasks = useQuery({
    queryKey: ["agents", "tasks", "blueprint", o.id],
    queryFn: () => agentsApi.tasks({ opportunityId: o.id, agentType: "BUSINESS_ARCHITECT", limit: 1, order: "desc" }),
    refetchInterval: (query) => (query.state.data?.items.some((t) => ACTIVE.includes(t.status)) ? 3000 : false),
  });
  const latest = tasks.data?.items?.[0];
  const generate = useMutation({
    mutationFn: () => oppApi.generateBlueprint(o.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", "tasks", "blueprint", o.id] }),
  });
  // When the task that was running finishes, pull in the blueprint it wrote.
  const wasActive = useRef(false);
  useEffect(() => {
    const active = Boolean(latest && ACTIVE.includes(latest.status));
    if (wasActive.current && !active) qc.invalidateQueries({ queryKey: ["opportunity", o.id] });
    wasActive.current = active;
  }, [latest, o.id, qc]);
  const working = generate.isPending || Boolean(latest && ACTIVE.includes(latest.status));
  const failed = latest && ["FAILED", "WAITING_REVIEW"].includes(latest.status);

  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        This blueprint is an AI-drafted plan to test and build the business cheaply. It is not evidence that the business will work: prices are hypotheses,
        brand names are unchecked ideas, and nothing here has been validated with customers.
      </Alert>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 3, flexWrap: "wrap" }} useFlexGap>
        {can("agents:run") && (
          <Button variant="contained" onClick={() => generate.mutate()} disabled={!eligible || working}>
            {working ? "Drafting…" : b ? "Regenerate blueprint" : "Draft blueprint"}
          </Button>
        )}
        {latest && <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><Typography variant="body2" sx={{ color: "text.secondary" }}>Last run</Typography><TaskStatusChip status={latest.status} /></Stack>}
        {b && <Typography variant="body2" sx={{ color: "text.secondary" }}>Version {b.version} · updated {formatDate(b.updatedAt)} · confidence {String(b.confidence).toLowerCase()}</Typography>}
      </Stack>
      {!eligible && <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>A blueprint can only be drafted once the opportunity is approved.</Typography>}
      <ErrorAlert error={generate.error} sx={{ mb: 2 }} />
      {failed && <Alert severity="warning" sx={{ mb: 2 }}>The last attempt did not finish{latest.error ? `: ${latest.error}` : ""}. See Agent runs for details, then try again.</Alert>}

      {!b ? <Empty>No blueprint yet.</Empty> : (
        <>
          <Section title="Positioning"><Typography>{b.positioning}</Typography></Section>
          <Section title="Offer">
            <Typography><strong>What you sell:</strong> {b.offer?.whatYouSell}</Typography>
            {b.offer?.howDelivered && <Typography><strong>How it is delivered:</strong> {b.offer.howDelivered}</Typography>}
          </Section>
          <Section title="Brand ideas">
            <Alert severity="warning" sx={{ mb: 1 }}>Ideas only. Whether these names, domains or trademarks are available has not been checked.</Alert>
            <Bullets items={b.brandOptions?.map((x) => (x.rationale ? `${x.name}: ${x.rationale}` : x.name))} />
          </Section>
          <Section title="Pricing hypotheses">
            {b.pricingHypotheses?.length ? (
              <Table size="small">
                <TableHead><TableRow><TableCell>Tier</TableCell><TableCell>Price</TableCell><TableCell>Basis</TableCell><TableCell>Evidence</TableCell></TableRow></TableHead>
                <TableBody>
                  {b.pricingHypotheses.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell>{p.tier}</TableCell>
                      <TableCell>{p.price != null ? `${formatMoney(p.price, p.currency)}${p.unit ? ` ${p.unit}` : ""}` : "—"}</TableCell>
                      <TableCell>{p.basis}</TableCell>
                      <TableCell><EvidenceTypeChip type={p.evidenceType} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <Typography variant="body2" sx={{ color: "text.secondary" }}>No pricing hypotheses.</Typography>}
          </Section>
          <Section title="Manual-first plan"><Bullets items={b.manualFirstPlan} /></Section>
          <Section title="MVP scope">
            <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
              {[["Must have", b.mvpScope?.mustHave], ["Nice to have", b.mvpScope?.niceToHave], ["Not now", b.mvpScope?.notNow]].map(([label, items]) => (
                <div key={label} style={{ flex: 1 }}><Typography variant="subtitle2">{label}</Typography><Bullets items={items} /></div>
              ))}
            </Stack>
          </Section>
          <Section title="Must be true before building software"><Bullets items={b.validationGates} /></Section>
          <Section title="Launch checklist">
            {b.launchChecklist?.length ? (
              <List dense disablePadding>
                {b.launchChecklist.map((c, i) => (
                  <ListItem key={i} disableGutters secondaryAction={c.requiresHumanApproval && <Chip size="small" color="warning" label="Needs your approval" />}>
                    <ListItemText primary={c.item} />
                  </ListItem>
                ))}
              </List>
            ) : <Typography variant="body2" sx={{ color: "text.secondary" }}>No checklist.</Typography>}
          </Section>
          <Section title="Local considerations (verify before relying on them)"><Bullets items={b.localizationNotes} /></Section>
          <Section title="Risks and mitigations">
            {b.risksAndMitigations?.length ? (
              <Table size="small">
                <TableHead><TableRow><TableCell>Risk</TableCell><TableCell>Mitigation</TableCell></TableRow></TableHead>
                <TableBody>{b.risksAndMitigations.map((r, i) => <TableRow key={i}><TableCell>{r.risk}</TableCell><TableCell>{r.mitigation || "—"}</TableCell></TableRow>)}</TableBody>
              </Table>
            ) : <Typography variant="body2" sx={{ color: "text.secondary" }}>None recorded.</Typography>}
          </Section>
          <Section title="Assumptions and uncertainties">
            <Typography variant="subtitle2">Assumptions</Typography><Bullets items={b.assumptions} />
            <Typography variant="subtitle2" sx={{ mt: 1 }}>Uncertainties</Typography><Bullets items={b.uncertainties} />
          </Section>
        </>
      )}
    </>
  );
}
