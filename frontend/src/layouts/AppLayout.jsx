import { Analytics, Groups, Logout, Menu as MenuIcon, PlayCircle, Psychology, Science, Settings, Lightbulb } from "@mui/icons-material";
import { AppBar, Box, Button, Chip, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography } from "@mui/material";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

const WIDTH = 232;

export default function AppLayout() {
  const { user, can, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const items = [
    { to: "/", label: "Overview", icon: <Analytics />, end: true },
    { to: "/opportunities", label: "Opportunities", icon: <Lightbulb /> },
    { to: "/discovery", label: "Discovery", icon: <PlayCircle /> },
    { to: "/experiments", label: "Experiments", icon: <Science /> },
    { to: "/agents", label: "Agents", icon: <Psychology /> },
    ...(can("users:manage") ? [{ to: "/users", label: "Users", icon: <Groups /> }] : []),
    { to: "/settings", label: "Settings", icon: <Settings /> },
  ];

  const nav = (
    <Box role="navigation" aria-label="Main">
      <Toolbar><Typography variant="h6" sx={{ fontWeight: 700 }}>AI Business Factory</Typography></Toolbar>
      <Divider />
      <List>
        {items.map((i) => (
          <ListItemButton key={i.to} component={NavLink} to={i.to} end={i.end} onClick={() => setOpen(false)} sx={{ "&.active": { bgcolor: "action.selected" } }}>
            <ListItemIcon sx={{ minWidth: 40 }}>{i.icon}</ListItemIcon>
            <ListItemText primary={i.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider", ml: { md: `${WIDTH}px` }, width: { md: `calc(100% - ${WIDTH}px)` } }}>
        <Toolbar>
          <IconButton aria-label="Open navigation" edge="start" onClick={() => setOpen(true)} sx={{ mr: 1, display: { md: "none" } }}><MenuIcon /></IconButton>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" sx={{ mr: 1, display: { xs: "none", sm: "block" } }}>{user.name}</Typography>
          <Chip size="small" label={user.role} sx={{ mr: 1 }} />
          <Button size="small" startIcon={<Logout />} onClick={logout}>Log out</Button>
        </Toolbar>
      </AppBar>
      <Box component="nav" sx={{ width: { md: WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer variant="temporary" open={open} onClose={() => setOpen(false)} ModalProps={{ keepMounted: true }} sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: WIDTH } }}>{nav}</Drawer>
        <Drawer variant="permanent" open sx={{ display: { xs: "none", md: "block" }, "& .MuiDrawer-paper": { width: WIDTH, boxSizing: "border-box" } }}>{nav}</Drawer>
      </Box>
      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, mt: 8, minWidth: 0 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
