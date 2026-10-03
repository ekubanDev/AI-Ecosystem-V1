import { Alert, Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { auth as authApi } from "../api/endpoints.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ErrorAlert, Loading } from "../components/common.jsx";

/** Whether public sign-up is open. Unknown (still loading or the call failed) counts as open: the server enforces it either way. */
function useRegistrationOpen() {
  const q = useQuery({ queryKey: ["auth-config"], queryFn: authApi.config, staleTime: 5 * 60 * 1000, retry: false });
  return q.data?.registrationEnabled !== false;
}

function Shell({ title, children }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <Card sx={{ width: "100%", maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="overline" sx={{ color: "text.secondary" }}>AI Business Factory</Typography>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600, mb: 3 }}>{title}</Typography>
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}

const PASSWORD_HELP = "At least 10 characters";

function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

export function LoginPage() {
  const registrationOpen = useRegistrationOpen();
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    setUnverified(false);
    try {
      await login(form);
      nav(loc.state?.from ?? "/", { replace: true });
    } catch (e) {
      if (e.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
      throw e;
    }
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Shell title="Log in">
      <Box component="form" onSubmit={submit} noValidate>
        <Stack spacing={2}>
          <TextField label="Email" type="email" autoComplete="email" required autoFocus value={form.email} onChange={set("email")} />
          <TextField label="Password" type="password" autoComplete="current-password" required value={form.password} onChange={set("password")} />
          <ErrorAlert error={error} />
          {unverified && (
            <Alert severity="info" action={<Button size="small" disabled={resent} onClick={() => authApi.resendVerification(form.email).then(() => setResent(true))}>{resent ? "Sent" : "Resend"}</Button>}>
              Verify your email to continue.
            </Alert>
          )}
          <Button type="submit" variant="contained" size="large" disabled={busy || !form.email || !form.password}>{busy ? "Logging in…" : "Log in"}</Button>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Link component={RouterLink} to="/forgot-password" variant="body2">Forgot password?</Link>
            {registrationOpen && <Link component={RouterLink} to="/register" variant="body2">Create account</Link>}
          </Stack>
        </Stack>
      </Box>
    </Shell>
  );
}

export function RegisterPage() {
  const registrationOpen = useRegistrationOpen();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [done, setDone] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await authApi.register(form);
    setDone(true);
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (!registrationOpen)
    return (
      <Shell title="Registration is closed">
        <Typography sx={{ mb: 2 }}>New accounts are not being accepted right now. If you should have access, ask the owner to set up your account.</Typography>
        <Button component={RouterLink} to="/login" variant="contained">Go to log in</Button>
      </Shell>
    );
  if (done)
    return (
      <Shell title="Check your email">
        <Typography sx={{ mb: 2 }}>We sent a verification link to <b>{form.email}</b>. Verify it, then log in.</Typography>
        <Button component={RouterLink} to="/login" variant="contained">Go to log in</Button>
      </Shell>
    );
  return (
    <Shell title="Create account">
      <Box component="form" onSubmit={submit} noValidate>
        <Stack spacing={2}>
          <TextField label="Name" required autoFocus value={form.name} onChange={set("name")} />
          <TextField label="Email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
          <TextField label="Password" type="password" autoComplete="new-password" required helperText={PASSWORD_HELP} value={form.password} onChange={set("password")} />
          <ErrorAlert error={error} />
          <Button type="submit" variant="contained" size="large" disabled={busy || !form.name || !form.email || form.password.length < 10}>{busy ? "Creating…" : "Create account"}</Button>
          <Typography variant="body2">New accounts start with read-only access until an owner or admin changes the role.</Typography>
          <Link component={RouterLink} to="/login" variant="body2">Back to log in</Link>
        </Stack>
      </Box>
    </Shell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState({ status: token ? "working" : "error", error: token ? null : { message: "This link is missing its token." } });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return; // verification tokens are single-use: never submit twice (StrictMode remounts)
    started.current = true;
    authApi.verifyEmail(token).then(() => setState({ status: "ok" })).catch((error) => setState({ status: "error", error }));
  }, [token]);

  return (
    <Shell title="Email verification">
      {state.status === "working" && <Loading label="Verifying…" />}
      {state.status === "ok" && (
        <>
          <Alert severity="success" sx={{ mb: 2 }}>Your email is verified.</Alert>
          <Button component={RouterLink} to="/login" variant="contained">Log in</Button>
        </>
      )}
      {state.status === "error" && (
        <>
          <ErrorAlert error={state.error} sx={{ mb: 2 }} />
          <Button component={RouterLink} to="/login">Back to log in</Button>
        </>
      )}
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await authApi.forgotPassword(email);
    setSent(true);
  });
  return (
    <Shell title="Forgot password">
      {sent ? (
        <Alert severity="success">If an account exists for that email, a reset link has been sent.</Alert>
      ) : (
        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2}>
            <TextField label="Email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <ErrorAlert error={error} />
            <Button type="submit" variant="contained" disabled={busy || !email}>Send reset link</Button>
          </Stack>
        </Box>
      )}
      <Box sx={{ mt: 2 }}><Link component={RouterLink} to="/login" variant="body2">Back to log in</Link></Box>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await authApi.resetPassword({ token, password });
    setDone(true);
  });
  return (
    <Shell title="Reset password">
      {done ? (
        <>
          <Alert severity="success" sx={{ mb: 2 }}>Password updated. All other sessions were signed out.</Alert>
          <Button component={RouterLink} to="/login" variant="contained">Log in</Button>
        </>
      ) : (
        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2}>
            {!token && <Alert severity="error">This link is missing its token.</Alert>}
            <TextField label="New password" type="password" autoComplete="new-password" required helperText={PASSWORD_HELP} value={password} onChange={(e) => setPassword(e.target.value)} />
            <ErrorAlert error={error} />
            <Button type="submit" variant="contained" disabled={busy || !token || password.length < 10}>Set password</Button>
          </Stack>
        </Box>
      )}
    </Shell>
  );
}
