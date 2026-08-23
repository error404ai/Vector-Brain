import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BugReportIcon from '@mui/icons-material/BugReport';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupIcon from '@mui/icons-material/Group';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { alpha, Box, Chip, Divider, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography, useTheme } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/store/hooks';
import type { RootState } from '@/store';

interface SidebarProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  href: string;
  roles: string[];
  badge?: string;
  color: string;
}

const mainItems: NavItem[] = [
  { label: 'Dashboard', icon: <DashboardIcon />, href: '/dashboard', roles: ['admin', 'user', 'guest'], color: '#2563eb' },
  { label: 'Android Agent', icon: <SmartToyIcon />, href: '/android-agent', roles: ['admin', 'user', 'guest'], badge: 'Live', color: '#6366f1' },
  { label: 'Android Devices', icon: <PhoneAndroidIcon />, href: '/android-devices', roles: ['admin', 'user', 'guest'], color: '#10b981' },
  { label: 'Users', icon: <GroupIcon />, href: '/users', roles: ['admin'], badge: 'Admin', color: '#7c3aed' },
  { label: 'Agent Tasks', icon: <SmartToyIcon />, href: '/agent-tasks', roles: ['admin', 'user', 'guest'], color: '#0f766e' },
  { label: 'AI Rules', icon: <PsychologyIcon />, href: '/ai-rules', roles: ['admin'], color: '#d97706' },
  { label: 'BrowserWorker Errors', icon: <BugReportIcon />, href: '/browserworker-errors', roles: ['admin'], badge: 'Admin', color: '#dc2626' },
  { label: 'My Rules', icon: <ManageAccountsIcon />, href: '/my-rules', roles: ['admin', 'user', 'guest'], badge: 'New', color: '#059669' },
];

const systemItems: NavItem[] = [{ label: 'Settings', icon: <SettingsIcon />, href: '/settings', roles: ['admin', 'user', 'guest'], color: '#475569' }];

function NavSection({ title, items, collapsed, onNavigate }: { title: string; items: NavItem[]; collapsed: boolean; onNavigate?: () => void }) {
  const theme = useTheme();
  const location = useLocation();

  return (
    <Box sx={{ px: 1.25, py: 1 }}>
      {!collapsed ? (
        <Typography variant="caption" sx={{ display: 'block', px: 1.25, pb: 0.75, color: 'text.secondary', fontWeight: 800, textTransform: 'uppercase' }}>
          {title}
        </Typography>
      ) : null}
      <List disablePadding sx={{ display: 'grid', gap: 0.5 }}>
        {items.map((item) => {
          const active = location.pathname === item.href;
          const button = (
            <ListItemButton
              key={item.href}
              component={Link}
              to={item.href}
              onClick={onNavigate}
              selected={active}
              sx={{
                minHeight: 42,
                borderRadius: 2,
                px: collapsed ? 1.25 : 1.5,
                justifyContent: collapsed ? 'center' : 'flex-start',
                color: active ? 'primary.main' : 'text.secondary',
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: 'primary.main',
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.14) },
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: collapsed ? 0 : 36,
                  color: active ? 'primary.main' : item.color,
                  justifyContent: 'center',
                  '& svg': { fontSize: 21 },
                }}
              >
                {item.icon}
              </ListItemIcon>
              {!collapsed ? (
                <>
                  <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: active ? 800 : 650 }} />
                  {item.badge ? <Chip label={item.badge} size="small" sx={{ height: 20, fontSize: 10 }} /> : null}
                </>
              ) : null}
            </ListItemButton>
          );

          return collapsed ? (
            <Tooltip key={item.href} title={item.label} placement="right">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </List>
    </Box>
  );
}

export function Sidebar({ collapsed = false, onNavigate }: SidebarProps) {
  const user = useAppSelector((state: RootState) => state.auth.user);
  const role = user?.role ?? 'guest';
  const visibleMain = mainItems.filter((item) => item.roles.includes(role));
  const visibleSystem = systemItems.filter((item) => item.roles.includes(role));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.paper' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', py: 1 }}>
        <NavSection title="Main" items={visibleMain} collapsed={collapsed} onNavigate={onNavigate} />
        <Divider sx={{ my: 1.25 }} />
        <NavSection title="System" items={visibleSystem} collapsed={collapsed} onNavigate={onNavigate} />
      </Box>
      <Box sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
        {collapsed ? (
          <Tooltip title="Vector Brain v1.0" placement="right">
            <Box sx={{ display: 'grid', placeItems: 'center', color: 'primary.main' }}>
              <AutoAwesomeIcon fontSize="small" />
            </Box>
          </Tooltip>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', fontWeight: 700 }}>
            Vector Brain v1.0
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default Sidebar;
