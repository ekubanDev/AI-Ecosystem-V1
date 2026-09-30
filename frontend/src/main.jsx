import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { makeTheme } from "./theme.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      // Never retry client errors (validation, auth, permission); do retry flaky network/5xx once.
      retry: (count, err) => (err?.status >= 400 && err?.status < 500 ? false : count < 1),
    },
  },
});

function Root() {
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = useMemo(() => makeTheme(dark ? "dark" : "light"), [dark]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>
);
