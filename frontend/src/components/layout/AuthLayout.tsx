import { useGetProfileQuery, useLogoutMutation } from '@/RTKService/authService/authService';
import { setUser } from '@/store/authSlice';
import { useAppDispatch } from '@/store/hooks';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import PersonIcon from '@mui/icons-material/Person';
import SettingsIcon from '@mui/icons-material/Settings';
import { AppBar, Avatar, Badge, Box, Divider, Drawer, IconButton, ListItemIcon, Menu, MenuItem, Skeleton, Stack, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Logo from '../ui/Logo';
import { Sidebar } from './Sidebar';

interface AuthLayoutProps {
  children: ReactNode;
}

const EXPANDED_WIDTH = 280;
const COLLAPSED_WIDTH = 80;

export function AuthLayout({ children }: AuthLayoutProps) {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { data: profile } = useGetProfileQuery();
  const user = profile?.data;
  const [logout] = useLogoutMutation();

  useEffect(() => {
    if (user) {
      dispatch(setUser(user));
    }
  }, [user, dispatch]);

  const handleLogout = async () => {
    try {
      await logout().unwrap();
    } catch {
      // Logout mutation clears local auth state even if the API request fails.
    }
  };

  const drawerWidth = sidebarCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  const drawer = <Sidebar collapsed={sidebarCollapsed && !isMobile} />;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: '1px solid rgba(0,0,0,0.1)', zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <IconButton edge="start" onClick={() => (isMobile ? setMobileOpen(true) : setSidebarCollapsed((value) => !value))}>
              {sidebarCollapsed && !isMobile ? <MenuIcon /> : <MenuOpenIcon />}
            </IconButton>
            <Logo size={28} showText />
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" component="button" onClick={(event) => setMenuAnchor(event.currentTarget)} sx={{ border: 0, bgcolor: 'transparent', cursor: 'pointer' }}>
            {user ? (
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                {user.name
                  .split(' ')
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')}
              </Avatar>
            ) : (
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }} />
            )}
            {user ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ display: { xs: 'none', sm: 'flex' } }}>
                <Typography variant="body2" fontWeight={600}>
                  {user.name}
                </Typography>
                <Badge color={user.role === 'admin' ? 'primary' : user.role === 'user' ? 'success' : 'default'} badgeContent={user.role.charAt(0).toUpperCase() + user.role.slice(1)} />
              </Stack>
            ) : (
              <Skeleton width={80} height={16} sx={{ display: { xs: 'none', sm: 'block' } }} />
            )}
          </Stack>

          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => setMenuAnchor(null)}>
              <ListItemIcon>
                <PersonIcon fontSize="small" />
              </ListItemIcon>
              Profile
            </MenuItem>
            <MenuItem onClick={() => setMenuAnchor(null)}>
              <ListItemIcon>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              Settings
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" color="error" />
              </ListItemIcon>
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }} sx={{ display: { xs: 'block', sm: 'none' }, '& .MuiDrawer-paper': { width: EXPANDED_WIDTH, bgcolor: '#f1f5f9' } }}>
          {drawer}
        </Drawer>
        <Drawer variant="permanent" open sx={{ display: { xs: 'none', sm: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box', mt: '64px', height: 'calc(100% - 64px)', bgcolor: '#f1f5f9', borderRight: '1px solid rgba(0,0,0,0.1)' } }}>
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ ml: { sm: `${drawerWidth}px` }, pt: '84px', px: 3, pb: 3, minHeight: '100vh' }}>
        {children}
      </Box>
    </Box>
  );
}

export default AuthLayout;
