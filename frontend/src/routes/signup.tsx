import {
  Anchor,
  Button,
  Checkbox,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { createFileRoute, useRouter } from "@tanstack/react-router";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();

  const form = useForm({
    initialValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      terms: false,
    },
    validate: {
      name: (value) =>
        value.length >= 2 ? null : "Name must be at least 2 characters",
      email: (value) => (/^\S+@\S+$/.test(value) ? null : "Invalid email"),
      password: (value) =>
        value.length >= 6 ? null : "Password must be at least 6 characters",
      confirmPassword: (value, values) =>
        value === values.password ? null : "Passwords do not match",
      terms: (value) => (value ? null : "You must accept the terms"),
    },
  });

  const handleSubmit = (values: typeof form.values) => {
    console.log("Signup attempt:", values);
    router.navigate({ to: "/login" });
  };

  return (
    <Stack gap="lg">
      <Stack gap="xs" align="center">
        <Title order={2} c="white">
          Create Account
        </Title>
        <Text c="dimmed" size="sm">
          Get started with Vector Brain today
        </Text>
      </Stack>

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Full Name"
            placeholder="John Doe"
            required
            {...form.getInputProps("name")}
            styles={{
              input: {
                backgroundColor: "rgba(9, 30, 56, 0.5)",
                borderColor: "rgba(255,255,255,0.2)",
                color: "white",
              },
              label: { color: "rgba(255,255,255,0.7)" },
            }}
          />

          <TextInput
            label="Email"
            placeholder="your@email.com"
            required
            {...form.getInputProps("email")}
            styles={{
              input: {
                backgroundColor: "rgba(9, 30, 56, 0.5)",
                borderColor: "rgba(255,255,255,0.2)",
                color: "white",
              },
              label: { color: "rgba(255,255,255,0.7)" },
            }}
          />

          <PasswordInput
            label="Password"
            placeholder="Create a password"
            required
            {...form.getInputProps("password")}
            styles={{
              input: {
                backgroundColor: "rgba(9, 30, 56, 0.5)",
                borderColor: "rgba(255,255,255,0.2)",
                color: "white",
              },
              label: { color: "rgba(255,255,255,0.7)" },
            }}
          />

          <PasswordInput
            label="Confirm Password"
            placeholder="Confirm your password"
            required
            {...form.getInputProps("confirmPassword")}
            styles={{
              input: {
                backgroundColor: "rgba(9, 30, 56, 0.5)",
                borderColor: "rgba(255,255,255,0.2)",
                color: "white",
              },
              label: { color: "rgba(255,255,255,0.7)" },
            }}
          />

          <Checkbox
            label="I agree to the terms and conditions"
            {...form.getInputProps("terms", { type: "checkbox" })}
            styles={{
              label: { color: "rgba(255,255,255,0.7)" },
            }}
          />

          <Button type="submit" fullWidth color="vector" mt="md">
            Create Account
          </Button>
        </Stack>
      </form>

      <Text c="dimmed" size="sm" ta="center">
        Already have an account?{" "}
        <Anchor c="vector" href="/login">
          Sign in
        </Anchor>
      </Text>
    </Stack>
  );
}
