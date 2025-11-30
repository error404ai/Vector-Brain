import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});

function Dashboard() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <p>Welcome to your dashboard!</p>
      <div className="mt-4 p-4 border rounded">
        <p>This is a demo dashboard page. Customize as needed.</p>
      </div>
    </div>
  );
}
