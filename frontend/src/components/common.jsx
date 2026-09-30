import { Alert, AlertTitle, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TablePagination, TextField, Typography } from "@mui/material";
import { useState } from "react";

export function PageHeader({ title, subtitle, actions }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mb: 3 }}>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>{title}</Typography>
        {subtitle && <Typography variant="body2" sx={{ color: "text.secondary" }}>{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1}>{actions}</Stack>}
    </Stack>
  );
}

export function Loading({ label = "Loading…" }) {
  return (
    <Stack spacing={1} role="status" sx={{ alignItems: "center", py: 6 }}>
      <CircularProgress size={28} />
      <Typography variant="body2" sx={{ color: "text.secondary" }}>{label}</Typography>
    </Stack>
  );
}

/** Shows the server's message plus its request id, which is what someone needs to find the failure in the logs. */
export function ErrorAlert({ error, onRetry, sx }) {
  if (!error) return null;
  const details = (error.details ?? []).filter((d) => d?.message).slice(0, 5);
  return (
    <Alert severity="error" sx={sx} action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}>
      <AlertTitle>{error.message || "Something went wrong"}</AlertTitle>
      {details.map((d, i) => <div key={i}>{d.path ? `${d.path}: ` : ""}{d.message}</div>)}
      {error.requestId && <Typography variant="caption">Request ID: {error.requestId}</Typography>}
    </Alert>
  );
}

export function Empty({ children }) {
  return <Typography sx={{ color: "text.secondary", py: 4, textAlign: "center" }}>{children}</Typography>;
}

export function JsonBlock({ value, maxHeight = 320 }) {
  return (
    <Box component="pre" tabIndex={0} sx={{ m: 0, p: 1.5, fontSize: 12, overflow: "auto", maxHeight, bgcolor: "action.hover", borderRadius: 1 }}>
      {JSON.stringify(value, null, 2)}
    </Box>
  );
}

export function ServerPagination({ pagination, onPage, onLimit }) {
  if (!pagination) return null;
  return (
    <TablePagination
      component="div" count={pagination.total} page={pagination.page - 1} rowsPerPage={pagination.limit}
      rowsPerPageOptions={[10, 20, 50, 100]}
      onPageChange={(_, p) => onPage(p + 1)} onRowsPerPageChange={(e) => onLimit(Number(e.target.value))}
    />
  );
}

/** Confirmation dialog, optionally collecting a note/reason. The action's error is shown in place so the user can retry. */
export function ActionDialog({ open, title, description, confirmLabel = "Confirm", color = "primary", noteLabel, noteRequired, onConfirm, onClose }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    if (busy) return;
    setNote("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(note.trim() || undefined);
      setNote("");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {description && <Typography sx={{ mb: 2 }}>{description}</Typography>}
        {noteLabel && (
          <TextField autoFocus fullWidth multiline minRows={2} label={noteLabel + (noteRequired ? "" : " (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
        )}
        <ErrorAlert error={error} sx={{ mt: 2 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={color} onClick={submit} disabled={busy || (noteRequired && !note.trim())}>{busy ? "Working…" : confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
