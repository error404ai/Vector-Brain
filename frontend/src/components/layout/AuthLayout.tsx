import { useGetProfileQuery, useLogoutMutation } from '@/RTKService/authService/authService';
import { setUser } from '@/store/authSlice';
import { useAppDispatch } from '@/store/hooks';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import MenuIcon from '@mui/icons-material/Menu';
import PersonIcon from '@mui/icons-material/Person';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import {
  alpha,
  AppBar,
  Avatar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Logo from '../ui/Logo';
import { Sidebar } from './Sidebar';

interface AuthLayoutProps {
  children: ReactNode;
}

const DRAWER_WIDTH = 260;
const MINI_DRAWER_WIDTH = 68;

const mobileNav = [
  { label: 'Home', value: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Tasks', value: '/agent-tasks', icon: <SmartToyIcon /> },
  { label: 'Rules', value: '/my-rules', icon: <ManageAccountsIcon /> },
  { label: 'Settings', value: '/settings', icon: <SettingsIcon /> },
];

function getInitials(name?: string) {
  if (!name) return 'U';
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [open, setOpen] = useState(!isMobile);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const { data: profile } = useGetProfileQuery();
  const user = profile?.data;
  const [logout] = useLogoutMutation();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    if (user) {
      dispatch(setUser(user));
    }
  }, [dispatch, user]);

  const drawerWidth = open ? DRAWER_WIDTH : MINI_DRAWER_WIDTH;
  const currentMobileValue = useMemo(() => mobileNav.find((item) => location.pathname.startsWith(item.value))?.value ?? '/dashboard', [location.pathname]);

  const handleLogout = async () => {
    setProfileAnchor(null);
    try {
      await logout().unwrap();
    } catch {
      // Local auth cleanup is handled by the auth slice/base query path.
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          bgcolor: 'rgba(255, 255, 255, 0.92)',
          color: 'text.primary',
          borderBottom: '1px solid',
          borderColor: 'divider',
          backdropFilter: 'blur(12px)',
          zIndex: (muiTheme) => muiTheme.zIndex.drawer + 1,
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 60, md: 64 }, gap: 1.5 }}>
          <Tooltip title={isMobile ? 'Open menu' : open ? 'Collapse menu' : 'Expand menu'}>
            <IconButton edge="start" onClick={() => (isMobile ? setMobileOpen(true) : setOpen((value) => !value))}>
              <MenuIcon />
            </IconButton>
          </Tooltip>
          <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }}>
            <Logo size={34} showText />
          </Box>
          <Box sx={{ display: { xs: 'block', sm: 'none' }, minWidth: 0 }}>
            <Logo size={32} showText={false} />
          </Box>
          <Box sx={{ flex: 1 }} />
          <Chip
            icon={<AutoAwesomeIcon />}
            label="AI Workspace"
            size="small"
            color="primary"
            variant="outlined"
            sx={{ display: { xs: 'none', md: 'inline-flex' }, bgcolor: alpha(theme.palette.primary.main, 0.06) }}
          />
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            component="button"
            onClick={(event) => setProfileAnchor(event.currentTarget)}
            sx={{
              border: 0,
              bgcolor: 'transparent',
              cursor: 'pointer',
              minWidth: 0,
              borderRadius: 2,
              p: 0.5,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {user ? <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontWeight: 800 }}>{getInitials(user.name)}</Avatar> : <Skeleton variant="circular" width={34} height={34} />}
            <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0, textAlign: 'left' }}>
              {user ? (
                <>
                  <Typography variant="body2" noWrap sx={{ maxWidth: 160, fontWeight: 800 }}>
                    {user.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                    {user.role}
                  </Typography>
                </>
              ) : (
                <Skeleton width={110} height={28} />
              )}
            </Box>
          </Stack>
          <Menu anchorEl={profileAnchor} open={Boolean(profileAnchor)} onClose={() => setProfileAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
            <MenuItem onClick={() => setProfileAnchor(null)}>
              <ListItemIcon>
                <PersonIcon fontSize="small" />
              </ListItemIcon>
              Profile
            </MenuItem>
            <MenuItem
              onClick={() => {
                setProfileAnchor(null);
                navigate('/settings');
              }}
            >
              <ListItemIcon>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              Settings
            </MenuItem>
            {user?.role === 'admin' ? (
              <MenuItem
                onClick={() => {
                  setProfileAnchor(null);
                  navigate('/ai-rules');
                }}
              >
                <ListItemIcon>
                  <PsychologyIcon fontSize="small" />
                </ListItemIcon>
                AI Rules
              </MenuItem>
            ) : null}
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

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar sx={{ minHeight: 60 }}>
          <Logo size={34} showText />
        </Toolbar>
        <Divider />
        <Sidebar onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <Drawer
        variant="permanent"
        open
        sx={{
          display: { xs: 'none', md: 'block' },
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            mt: '64px',
            height: 'calc(100% - 64px)',
            overflowX: 'hidden',
            transition: theme.transitions.create('width', { duration: theme.transitions.duration.shorter }),
          },
        }}
      >
        <Sidebar collapsed={!open} />
      </Drawer>

      <Box
        component="main"
        sx={{
          ml: { md: `${drawerWidth}px` },
          pt: { xs: '76px', md: '88px' },
          px: { xs: 1.5, sm: 2, md: 3 },
          pb: { xs: 10, md: 3 },
          minHeight: '100vh',
          transition: theme.transitions.create('margin-left', { duration: theme.transitions.duration.shorter }),
        }}
      >
        {children}
      </Box>

      <PaperBottomNav value={currentMobileValue} onChange={(value) => navigate(value)} />
    </Box>
  );
}

function PaperBottomNav({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Box sx={{ display: { xs: 'block', md: 'none' }, position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: (theme) => theme.zIndex.appBar }}>
      <BottomNavigation showLabels value={value} onChange={(_event, nextValue) => onChange(nextValue)} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        {mobileNav.map((item) => (
          <BottomNavigationAction key={item.value} label={item.label} value={item.value} icon={item.icon} />
        ))}
      </BottomNavigation>
    </Box>
  );
}

export default AuthLayout;
