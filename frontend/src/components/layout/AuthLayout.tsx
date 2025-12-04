import { useLogoutMutation } from '@/RTKService/authService/authService';
import type { RootState } from '@/store/store';
import { ActionIcon, AppShell, Avatar, Badge, Burger, Group, Menu, rem, Skeleton, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconLogout, IconMenu2, IconMenuDeep, IconSettings, IconUser } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useSelector } from 'react-redux';
import Logo from '../ui/Logo';
import { Sidebar } from './Sidebar';

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const [opened, { toggle }] = useDisclosure();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const user = useSelector((state: RootState) => state.auth.user);
  const [logout] = useLogoutMutation();

  const handleLogout = async () => {
    console.log('logging out');
    try {
      await logout().unwrap();
      console.log('logout successful, navigation will be handled by useAuthRedirect');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: sidebarCollapsed ? 80 : 280,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
      layout="default"
      styles={{
        main: {
          backgroundColor: '#f8fafc',
          minHeight: '100vh',
        },
        header: {
          backgroundColor: '#ffffff',
          borderBottom: '1px solid rgba(0,0,0,0.1)',
        },
        navbar: {
          backgroundColor: '#f1f5f9',
          borderRight: '1px solid rgba(0,0,0,0.1)',
        },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <ActionIcon variant="subtle" size="lg" visibleFrom="sm" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} color="gray">
              {sidebarCollapsed ? <IconMenu2 size="1.2rem" /> : <IconMenuDeep size="1.2rem" />}
            </ActionIcon>
            <Logo size={28} showText={true} />
          </Group>

          <Menu shadow="md" width={200}>
            <Menu.Target>
              <UnstyledButton>
                <Group gap={7}>
                  {user ? (
                    <Avatar src={undefined} alt={user.name} size={32} radius="xl" color="vector">
                      {user.name
                        .split(' ')
                        .map((s: string) => s[0])
                        .slice(0, 2)
                        .join('')}
                    </Avatar>
                  ) : (
                    <Avatar size={32} radius="xl" color="vector" />
                  )}
                  {user ? (
                    <Group gap="xs" align="center" visibleFrom="sm">
                      <Text fw={500} size="sm" lh={1}>
                        {user.name}
                      </Text>
                      <Badge size="xs" variant="light" color="vector">
                        Admin
                      </Badge>
                    </Group>
                  ) : (
                    <Skeleton height={16} width={80} radius="sm" />
                  )}
                </Group>
              </UnstyledButton>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item leftSection={<IconUser style={{ width: rem(16), height: rem(16) }} />}>Profile</Menu.Item>
              <Menu.Item leftSection={<IconSettings style={{ width: rem(16), height: rem(16) }} />}>Settings</Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<IconLogout style={{ width: rem(16), height: rem(16) }} />} onClick={handleLogout} color="red">
                Logout
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar>
        <Sidebar collapsed={sidebarCollapsed} />
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

export default AuthLayout;
