import { Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { PageHeader } from "../components/common.jsx";

const CAPS = [["Create and edit opportunities", "opportunities:write"], ["Run discovery and analysis", "agents:run"], ["Run agents directly, retry tasks", "agents:runDirect"], ["Approve / reject / pause opportunities", "opportunities:approve"], ["Create and run experiments", "experiments:write"], ["Start experiments with a budget", "experiments:approve"], ["Manage users", "users:manage"]];

export default function SettingsPage() {
  const { user, can } = useAuth();
  const health = useQuery({ queryKey: ["health"], queryFn: () => get("/health").then((r) => r.data), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="Settings" subtitle="Your account and what your role allows." />
      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Account</Typography>
          <Typography>{user.name}</Typography><Typography sx={{ color: "text.secondary" }}>{user.email}</Typography>
          <Chip size="small" label={user.role} sx={{ mt: 1 }} />
        </CardContent></Card>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>What your role can do</Typography>
          <Stack spacing={0.5}>{CAPS.map(([label, cap]) => <Typography key={cap} variant="body2" sx={{ color: can(cap) ? "text.primary" : "text.disabled" }}>{can(cap) ? "✓" : "—"} {label}</Typography>)}</Stack>
        </CardContent></Card>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>Server</Typography>
          <Chip size="small" color={health.data?.status === "ok" ? "success" : health.isError ? "error" : "warning"} label={health.isPending ? "Checking…" : health.isError ? "Unreachable" : health.data.status === "ok" ? "API and database healthy" : "Degraded"} />
        </CardContent></Card>
      </Stack>
    </>
  );
}
