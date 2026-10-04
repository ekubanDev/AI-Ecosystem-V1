import { Alert, Button, Chip, FormControlLabel, IconButton, MenuItem, Select, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import { Delete } from "@mui/icons-material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { leads as leadsApi, opportunities as oppApi, publicPages } from "../api/endpoints.js";
import { conversionLabel, lowSample } from "../utils/landingStats.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ActionDialog, Empty, ErrorAlert, Loading, ServerPagination } from "./common.jsx";
import { formatDate, humanize } from "../utils/format.js";
import { parseBullets } from "../utils/leadForm.js";

const LANDING_STATUSES = ["APPROVED", "EXPERIMENT", "BUILDING", "LAUNCHED", "SCALING"]; // mirrors backend/models/constants.js
const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "NOT_INTERESTED"];

function Editor({ o }) {
  const qc = useQueryClient();
  const l = o.landing ?? {};
  const [form, setForm] = useState({ headline: l.headline ?? "", subheadline: l.subheadline ?? "", bullets: (l.bullets ?? []).join("\n"), ctaLabel: l.ctaLabel ?? "", enabled: Boolean(l.enabled) });
  const save = useMutation({
    mutationFn: () => oppApi.updateLanding(o.id, { enabled: form.enabled, headline: form.headline.trim() || undefined, subheadline: form.subheadline.trim() || undefined, bullets: parseBullets(form.bullets), ctaLabel: form.ctaLabel.trim() || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opportunity", o.id] }),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const url = `${window.location.origin}/p/${o.slug}`;
  const eligible = LANDING_STATUSES.includes(o.status);
  const privacy = useQuery({ queryKey: ["privacy-contact"], queryFn: publicPages.privacy, staleTime: 5 * 60 * 1000 });

  return (
    <Stack spacing={2} sx={{ mb: 4, maxWidth: 640 }}>
      <Alert severity="info">
        Publishing makes this page visible to anyone with the link, and it collects personal data (name, email and what visitors choose to add).
        Visitors must tick a consent box, and you can delete any lead on request. Check the wording before you publish: say only what you can deliver.
      </Alert>
      {privacy.data && !privacy.data.configured && (
        <Alert severity="warning">
          The privacy notice has no responsible party yet. Set PRIVACY_OPERATOR_NAME and PRIVACY_CONTACT_EMAIL on the server: in production a page cannot be published until they are set, and visitors are shown an incomplete notice until then.
        </Alert>
      )}
      {privacy.data?.configured && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>The privacy notice at <a href="/privacy" target="_blank" rel="noreferrer">/privacy</a> names {privacy.data.operatorName} ({privacy.data.contactEmail}) as responsible for visitors' details.</Typography>
      )}
      <TextField label="Headline" required={form.enabled} value={form.headline} onChange={set("headline")} slotProps={{ htmlInput: { maxLength: 120 } }} fullWidth />
      <TextField label="Sub-headline" value={form.subheadline} onChange={set("subheadline")} slotProps={{ htmlInput: { maxLength: 300 } }} fullWidth />
      <TextField label="Bullet points (one per line, up to 6)" value={form.bullets} onChange={set("bullets")} multiline minRows={3} fullWidth />
      <TextField label="Button label" value={form.ctaLabel} onChange={set("ctaLabel")} placeholder="Register my interest" slotProps={{ htmlInput: { maxLength: 40 } }} fullWidth />
      <FormControlLabel
        control={<Switch checked={form.enabled} disabled={!eligible} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />}
        label={form.enabled ? "Published (public)" : "Not published"}
      />
      {!eligible && <Typography variant="body2" sx={{ color: "text.secondary" }}>A page can only be published once the opportunity is approved.</Typography>}
      <ErrorAlert error={save.error} />
      {save.isSuccess && <Alert severity="success" role="status">Saved.</Alert>}
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        {l.enabled && <Typography variant="body2">Live at <a href={url} target="_blank" rel="noreferrer">{url}</a></Typography>}
      </Stack>
    </Stack>
  );
}

function Stat({ label, value, hint }) {
  return (
    <Stack role="group" aria-label={label} sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 2, py: 1.5, minWidth: 130 }}>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>{label}</Typography>
      <Typography variant="h5" component="p" sx={{ fontWeight: 600 }}>{value}</Typography>
      {hint && <Typography variant="caption" sx={{ color: "text.secondary" }}>{hint}</Typography>}
    </Stack>
  );
}

function Results({ o }) {
  const q = useQuery({ queryKey: ["landing-stats", o.id], queryFn: () => oppApi.landingStats(o.id), refetchInterval: 30000 });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={q.refetch} sx={{ mb: 3 }} />;
  const s = q.data;
  if (!s.views && !s.leads && !o.landing?.enabled) return null;
  const days = s.byDay.filter((d) => d.views || d.leads).slice(-14).reverse();
  return (
    <section style={{ marginBottom: 32 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Results</Typography>
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
        <Stat label="Page views" value={s.views} />
        <Stat label="Leads" value={s.leads} />
        <Stat label="Conversion" value={conversionLabel(s)} hint="leads ÷ views" />
        <Stat label="Last view" value={s.lastViewAt ? formatDate(s.lastViewAt) : "—"} />
      </Stack>
      {lowSample(s) && <Alert severity="warning" sx={{ mb: 2 }}>Fewer than 30 views so far: treat the conversion rate as a rough signal, not a result.</Alert>}
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
        Views are counted without cookies or visitor IDs, so a refresh counts again and bots are included. A lead is interest, not demand: the experiment's real test is how many commit to pay.
      </Typography>
      {days.length > 0 && (
        <Table size="small" sx={{ maxWidth: 520, mb: 2 }} aria-label="Views and leads by day">
          <TableHead><TableRow><TableCell>Day (UTC)</TableCell><TableCell align="right">Views</TableCell><TableCell align="right">Leads</TableCell></TableRow></TableHead>
          <TableBody>{days.map((d) => <TableRow key={d.day}><TableCell>{d.day}</TableCell><TableCell align="right">{d.views}</TableCell><TableCell align="right">{d.leads}</TableCell></TableRow>)}</TableBody>
        </Table>
      )}
      {s.bySource.length > 0 && (
        <Table size="small" sx={{ maxWidth: 520 }} aria-label="Views and leads by source">
          <TableHead><TableRow><TableCell>Source</TableCell><TableCell align="right">Views</TableCell><TableCell align="right">Leads</TableCell></TableRow></TableHead>
          <TableBody>{s.bySource.map((r) => <TableRow key={r.source || "direct"}><TableCell>{r.source || "(direct)"}</TableCell><TableCell align="right">{r.views}</TableCell><TableCell align="right">{r.leads}</TableCell></TableRow>)}</TableBody>
        </Table>
      )}
    </section>
  );
}

function Leads({ o }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [doomed, setDoomed] = useState(null);
  const q = useQuery({ queryKey: ["leads", o.id, page, limit], queryFn: () => leadsApi.list({ opportunityId: o.id, page, limit }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["leads", o.id] });
  const setStatus = useMutation({ mutationFn: ({ id, status }) => leadsApi.update(id, { status }), onSuccess: refresh });

  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={q.refetch} />;
  const { items, pagination } = q.data;
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <Typography variant="h6" component="h2">Leads</Typography>
        <Chip size="small" label={pagination?.total ?? items.length} />
      </Stack>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
        These are people who asked to hear more. Interest is not demand: the test is how many commit to pay.
      </Typography>
      <ErrorAlert error={setStatus.error} sx={{ mb: 2 }} />
      {items.length === 0 ? <Empty>No leads yet.</Empty> : (
        <Table size="small">
          <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Contact</TableCell><TableCell>Company / sector</TableCell><TableCell>Status</TableCell><TableCell>Received</TableCell><TableCell /></TableRow></TableHead>
          <TableBody>
            {items.map((x) => (
              <TableRow key={x.id}>
                <TableCell>{x.name}{x.message && <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>“{x.message}”</Typography>}</TableCell>
                <TableCell>{x.email}{x.phone && <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>{x.phone}</Typography>}</TableCell>
                <TableCell>{[x.company, x.sector].filter(Boolean).join(" · ") || "—"}{x.source && <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>via {x.source}</Typography>}</TableCell>
                <TableCell>
                  {can("leads:write") ? (
                    <Select size="small" value={x.status} onChange={(e) => setStatus.mutate({ id: x.id, status: e.target.value })} slotProps={{ input: { "aria-label": `Status for ${x.name}` } }}>
                      {LEAD_STATUSES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
                    </Select>
                  ) : humanize(x.status)}
                </TableCell>
                <TableCell>{formatDate(x.createdAt)}</TableCell>
                <TableCell>
                  {can("leads:write") && <Tooltip title="Delete this person's data"><IconButton aria-label={`Delete ${x.name}`} onClick={() => setDoomed(x)}><Delete /></IconButton></Tooltip>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ServerPagination pagination={pagination} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
      <ActionDialog
        open={Boolean(doomed)} title="Delete this lead?" color="error" confirmLabel="Delete permanently"
        description={doomed ? `This permanently removes ${doomed.name}'s details. Do this when they ask to be deleted. It cannot be undone.` : ""}
        onConfirm={async () => { await leadsApi.remove(doomed.id); refresh(); }} onClose={() => setDoomed(null)}
      />
    </>
  );
}

export function LandingTab({ o }) {
  const { can } = useAuth();
  return (
    <>
      {can("landing:publish")
        ? <Editor o={o} />
        : <Alert severity="info" sx={{ mb: 3 }}>{o.landing?.enabled ? "This page is published." : "This page is not published."} Only an owner or admin can edit or publish it.</Alert>}
      <Results o={o} />
      {can("leads:read") ? <Leads o={o} /> : <Empty>You do not have access to leads.</Empty>}
    </>
  );
}
