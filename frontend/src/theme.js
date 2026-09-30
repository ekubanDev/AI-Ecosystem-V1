import { createTheme } from "@mui/material";

export const makeTheme = (mode) =>
  createTheme({
    palette: { mode, primary: { main: mode === "dark" ? "#7aa2ff" : "#2b4de0" } },
    shape: { borderRadius: 8 },
    typography: { fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    components: { MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: "none" } } } },
  });
