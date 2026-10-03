import { CheckCircle } from "@mui/icons-material";
import { Alert, Box, Button, Checkbox, Container, FormControlLabel, FormHelperText, List, ListItem, ListItemIcon, ListItemText, Paper, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { publicPages } from "../api/endpoints.js";
import { ErrorAlert, Loading } from "../components/common.jsx";
import { validateLead } from "../utils/leadForm.js";

const EMPTY = { name: "", email: "", phone: "", company: "", sector: "", message: "", consent: false, website: "" };

/** Public, unauthenticated page for one published opportunity. Shows only what the owner wrote, and collects interest, not payment. */
export default function PublicLandingPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const page = useQuery({ queryKey: ["public-page", slug], queryFn: () => publicPages.get(slug), retry: false });
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const submit = useMutation({ mutationFn: (body) => publicPages.submitLead(slug, body) });

  // One view per browser tab session. Counters only: nothing identifying the visitor is sent or stored.
  const loaded = Boolean(page.data);
  useEffect(() => {
    if (!loaded) return;
    const key = `abf:viewed:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* storage blocked: count the view anyway */ }
    const source = (params.get("utm_source") || params.get("source") || "").slice(0, 100);
    publicPages.recordView(slug, source ? { source } : {}).catch(() => {}); // analytics must never get in the visitor's way
  }, [loaded, slug, params]);

  if (page.isPending) return <Loading />;
  if (page.error) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600, mb: 1 }}>This page is not available</Typography>
        <Typography sx={{ color: "text.secondary" }}>{page.error.status === 404 ? "It may not have been published yet, or it has been taken down." : "We could not load it. Please try again in a moment."}</Typography>
      </Container>
    );
  }
  const p = page.data;
  const set = (k) => (e) => {
    setValues((v) => ({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
    setErrors(({ [k]: _cleared, ...rest }) => rest); // a message about a field goes away as soon as the person touches it
  };
  const onSubmit = (e) => {
    e.preventDefault();
    const found = validateLead(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = { ...values, consent: true };
    for (const k of ["phone", "company", "sector", "message"]) if (!body[k].trim()) delete body[k];
    const src = params.get("utm_source") || params.get("source");
    if (src) body.source = src.slice(0, 100);
    if (!body.website) delete body.website;
    submit.mutate(body);
  };

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
      <Typography variant="overline" sx={{ color: "text.secondary" }}>{p.name}</Typography>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 1 }}>{p.headline}</Typography>
      {p.subheadline && <Typography variant="h6" component="p" sx={{ color: "text.secondary", fontWeight: 400, mb: 2 }}>{p.subheadline}</Typography>}
      {p.bullets.length > 0 && (
        <List dense sx={{ mb: 2 }}>
          {p.bullets.map((b) => (
            <ListItem key={b} disableGutters>
              <ListItemIcon sx={{ minWidth: 36 }}><CheckCircle color="primary" /></ListItemIcon>
              <ListItemText primary={b} />
            </ListItem>
          ))}
        </List>
      )}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        {submit.isSuccess ? (
          <Alert severity="success" role="status">Thank you. We have your details and will be in touch.</Alert>
        ) : (
          <Box component="form" noValidate onSubmit={onSubmit} aria-label="Register your interest">
            <Stack spacing={2}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>This is an early-stage offer. Registering your interest is free and is not a purchase.</Typography>
              <TextField label="Name" required value={values.name} onChange={set("name")} error={Boolean(errors.name)} helperText={errors.name} autoComplete="name" fullWidth />
              <TextField label="Email" type="email" required value={values.email} onChange={set("email")} error={Boolean(errors.email)} helperText={errors.email} autoComplete="email" fullWidth />
              <TextField label="Phone (optional)" value={values.phone} onChange={set("phone")} autoComplete="tel" fullWidth />
              <TextField label="Company (optional)" value={values.company} onChange={set("company")} autoComplete="organization" fullWidth />
              <TextField label="Your sector (optional)" value={values.sector} onChange={set("sector")} fullWidth />
              <TextField label="Anything you would like us to know (optional)" value={values.message} onChange={set("message")} multiline minRows={2} fullWidth />
              {/* Honeypot: hidden from people and assistive tech; bots tend to fill every field. */}
              <Box aria-hidden="true" sx={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>
                <label>Website<input tabIndex={-1} autoComplete="off" value={values.website} onChange={set("website")} /></label>
              </Box>
              <Box>
                <FormControlLabel control={<Checkbox checked={values.consent} onChange={set("consent")} />} label={p.consentText} />
                {errors.consent && <FormHelperText error>{errors.consent}</FormHelperText>}
              </Box>
              <ErrorAlert error={submit.error} />
              <Button type="submit" variant="contained" size="large" disabled={submit.isPending}>{submit.isPending ? "Sending…" : p.ctaLabel}</Button>
            </Stack>
          </Box>
        )}
      </Paper>
    </Container>
  );
}
