import {
  Button,
  Card,
  Divider,
  Group,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconBell, IconKey, IconPalette, IconUser } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const profileForm = useForm({
    initialValues: {
      name: "John Doe",
      email: "john@example.com",
      company: "Vector Software",
    },
  });

  const passwordForm = useForm({
    initialValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const inputStyles = {
    input: {
      backgroundColor: "rgba(9, 30, 56, 0.5)",
      borderColor: "rgba(255,255,255,0.2)",
      color: "white",
    },
    label: { color: "rgba(255,255,255,0.7)" },
  };

  const cardStyle = {
    backgroundColor: "#1A3A5C",
    border: "1px solid rgba(255,255,255,0.1)",
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2} c="white">Settings</Title>
        <Text c="dimmed" size="sm">Manage your account settings</Text>
      </div>

      <Tabs defaultValue="profile" color="vector">
        <Tabs.List>
          <Tabs.Tab value="profile" leftSection={<IconUser size="1rem" />}>Profile</Tabs.Tab>
          <Tabs.Tab value="security" leftSection={<IconKey size="1rem" />}>Security</Tabs.Tab>
          <Tabs.Tab value="notifications" leftSection={<IconBell size="1rem" />}>Notifications</Tabs.Tab>
          <Tabs.Tab value="appearance" leftSection={<IconPalette size="1rem" />}>Appearance</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profile" pt="xl">
          <Card padding="lg" radius="md" style={cardStyle}>
            <Stack gap="md">
              <TextInput label="Full Name" {...profileForm.getInputProps("name")} styles={inputStyles} />
              <TextInput label="Email" {...profileForm.getInputProps("email")} styles={inputStyles} />
              <TextInput label="Company" {...profileForm.getInputProps("company")} styles={inputStyles} />
              <Group justify="flex-end"><Button color="vector">Save</Button></Group>
            </Stack>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="security" pt="xl">
          <Card padding="lg" radius="md" style={cardStyle}>
            <Title order={4} c="white" mb="md">Change Password</Title>
            <Stack gap="md">
              <PasswordInput label="Current Password" {...passwordForm.getInputProps("currentPassword")} styles={inputStyles} />
              <PasswordInput label="New Password" {...passwordForm.getInputProps("newPassword")} styles={inputStyles} />
              <PasswordInput label="Confirm Password" {...passwordForm.getInputProps("confirmPassword")} styles={inputStyles} />
              <Group justify="flex-end"><Button color="vector">Update</Button></Group>
            </Stack>
            <Divider my="xl" color="rgba(255,255,255,0.1)" />
            <Group justify="space-between">
              <div><Text c="white" size="sm">Enable 2FA</Text></div>
              <Switch color="vector" />
            </Group>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="notifications" pt="xl">
          <Card padding="lg" radius="md" style={cardStyle}>
            <Stack gap="lg">
              <Group justify="space-between">
                <Text c="white" size="sm">Email Notifications</Text>
                <Switch color="vector" defaultChecked />
              </Group>
              <Group justify="space-between">
                <Text c="white" size="sm">Push Notifications</Text>
                <Switch color="vector" defaultChecked />
              </Group>
            </Stack>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="appearance" pt="xl">
          <Card padding="lg" radius="md" style={cardStyle}>
            <Stack gap="lg">
              <Select label="Theme" defaultValue="dark" data={[{value:"dark",label:"Dark"},{value:"light",label:"Light"}]} styles={inputStyles} />
              <Select label="Language" defaultValue="en" data={[{value:"en",label:"English"},{value:"es",label:"Spanish"}]} styles={inputStyles} />
            </Stack>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
