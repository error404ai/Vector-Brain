import { Badge, Box, NavLink, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { IconBrain, IconChartBar, IconDashboard, IconDatabase, IconFolder, IconSettings, IconUsers } from '@tabler/icons-react';
import { Link, useLocation } from '@tanstack/react-router';
import Logo from '../ui/Logo';

const mainNavItems = [
  {
    label: 'Dashboard',
    icon: IconDashboard,
    href: '/dashboard',
    badge: null,
  },
  {
    label: 'Projects',
    icon: IconFolder,
    href: '/projects',
    badge: null,
  },
  {
    label: 'Users',
    icon: IconUsers,
    href: '/users',
    badge: { label: 'NEW', color: 'cyan' },
  },
  {
    label: 'Analytics',
    icon: IconChartBar,
    href: '/analytics',
    badge: null,
  },
  {
    label: 'Knowledge Base',
    icon: IconBrain,
    href: '/knowledge',
    badge: { label: 'AI', color: 'vector' },
  },
  {
    label: 'Database',
    icon: IconDatabase,
    href: '/database',
    badge: null,
  },
];

const systemItems = [
  {
    label: 'Settings',
    icon: IconSettings,
    href: '/settings',
    badge: null,
  },
];

interface SidebarProps {
  collapsed?: boolean;
}

interface NavSectionProps {
  items: Array<{
    label: string;
    icon: React.ComponentType<{ size?: string | number }>;
    href: string;
    badge?: { label: string; color: string } | null;
  }>;
  collapsed: boolean;
}

function NavSection({ items, collapsed }: NavSectionProps) {
  const location = useLocation();

  if (collapsed) {
    return (
      <Stack gap="xs">
        {items.map((item) => (
          <Tooltip key={item.href} label={item.label} position="right" withArrow>
            <NavLink component={Link} to={item.href} leftSection={<item.icon size="1.2rem" />} active={location.pathname === item.href} variant="light" color="vector" />
          </Tooltip>
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      {items.map((item) => (
        <NavLink
          key={item.href}
          component={Link}
          to={item.href}
          label={
            <Box style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{item.label}</span>
              {item.badge && (
                <Badge size="xs" variant="light" color={item.badge.color}>
                  {item.badge.label}
                </Badge>
              )}
            </Box>
          }
          leftSection={<item.icon size="1.2rem" />}
          active={location.pathname === item.href}
          variant="light"
          color="vector"
        />
      ))}
    </Stack>
  );
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#0A2E55',
      }}
    >
      {/* Logo */}
      <Box p="md" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Logo size={28} showText={!collapsed} />
      </Box>

      {/* Navigation */}
      <ScrollArea flex={1} p="md">
        <Stack gap="lg">
          <Box>
            {!collapsed && (
              <Text size="xs" c="dimmed" mb="xs" tt="uppercase" fw={500}>
                Main Menu
              </Text>
            )}
            <NavSection items={mainNavItems} collapsed={collapsed} />
          </Box>

          <Box>
            {!collapsed && (
              <Text size="xs" c="dimmed" mb="xs" tt="uppercase" fw={500}>
                System
              </Text>
            )}
            <NavSection items={systemItems} collapsed={collapsed} />
          </Box>
        </Stack>
      </ScrollArea>

      {/* Footer */}
      <Box p="md" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        {collapsed ? (
          <Tooltip label="Vector Brain v1.0" position="right" withArrow>
            <Box style={{ display: 'flex', justifyContent: 'center' }}>
              <IconBrain size={20} color="#0B69C6" />
            </Box>
          </Tooltip>
        ) : (
          <Text size="xs" c="dimmed" ta="center">
            Vector Brain v1.0
          </Text>
        )}
      </Box>
    </Box>
  );
}

export default Sidebar;
