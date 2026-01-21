import { Badge, Box, NavLink, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { IconBrain, IconDashboard, IconRobot, IconSettings, IconUsers, IconUserStar } from '@tabler/icons-react';
import { Link, useLocation } from '@tanstack/react-router';
import { useAppSelector } from '@/store/hooks';
import type { RootState } from '@/store';

const mainNavItems = [
  {
    label: 'Dashboard',
    icon: IconDashboard,
    href: '/dashboard',
    badge: null,
    roles: ['admin', 'user', 'guest'], // All users can see dashboard
  },
  {
    label: 'Users',
    icon: IconUsers,
    href: '/users',
    badge: { label: 'NEW', color: 'cyan' },
    roles: ['admin'], // Only admins can see users
  },
  {
    label: 'Agent Tasks',
    icon: IconRobot,
    href: '/agent-tasks',
    badge: null,
    roles: ['admin', 'user', 'guest'], // All users can see agent tasks
  },
  {
    label: 'AI Rules',
    icon: IconBrain,
    href: '/ai-rules',
    badge: null,
    roles: ['admin'], // Only admins can see AI rules (global + all rules)
  },
  {
    label: 'My Rules',
    icon: IconUserStar,
    href: '/my-rules',
    badge: { label: 'NEW', color: 'teal' },
    roles: ['admin', 'user', 'guest'], // All users can see their own rules
  },
];

const systemItems = [
  {
    label: 'Settings',
    icon: IconSettings,
    href: '/settings',
    badge: null,
    roles: ['admin', 'user', 'guest'], // All users can see settings
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
    roles: string[];
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
  const user = useAppSelector((state: RootState) => state.auth.user);
  const userRole = user?.role || 'guest';

  // Filter menu items based on user role
  const filteredMainNavItems = mainNavItems.filter((item) => item.roles.includes(userRole));
  const filteredSystemItems = systemItems.filter((item) => item.roles.includes(userRole));

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#f1f5f9',
      }}
    >
      {/* Navigation */}
      <ScrollArea flex={1} p="md">
        <Stack gap="lg">
          <Box>
            {!collapsed && (
              <Text size="xs" c="dimmed" mb="xs" tt="uppercase" fw={500}>
                Main Menu
              </Text>
            )}
            <NavSection items={filteredMainNavItems} collapsed={collapsed} />
          </Box>

          <Box>
            {!collapsed && (
              <Text size="xs" c="dimmed" mb="xs" tt="uppercase" fw={500}>
                System
              </Text>
            )}
            <NavSection items={filteredSystemItems} collapsed={collapsed} />
          </Box>
        </Stack>
      </ScrollArea>

      {/* Footer */}
      <Box p="md" style={{ borderTop: '1px solid rgba(0,0,0,0.1)' }}>
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
