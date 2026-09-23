import ErrorModal from '@/components/ui/ErrorModal';
import { store, useAppSelector } from '@/store';
import { Toaster } from 'react-hot-toast';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { AuthLayout } from './components/layout/AuthLayout';
import { GuestLayout } from './components/layout/GuestLayout';
import GlobalLoader from './components/loaders/GlobalLoader';
import useAuthRedirect from './hooks/useAuthRedirect';
import AgentTasksPage from './pages/AgentTasksPage';
import AiRulesPage from './pages/AiRulesPage';
import AndroidAgentPage from './pages/AndroidAgentPage';
import FlowsPage from './pages/FlowsPage';
import SchedulesPage from './pages/SchedulesPage';
import MissionControlPage from './pages/MissionControlPage';
import AndroidDevicesPage from './pages/AndroidDevicesPage';
import AndroidFleetPage from './pages/AndroidFleetPage';
import BrowserWorkerErrorsPage from './pages/BrowserWorkerErrorsPage';
import DashboardPage from './pages/DashboardPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import MyRulesPage from './pages/MyRulesPage';
import SettingsPage from './pages/SettingsPage';
import SignupPage from './pages/SignupPage';
import UsersPage from './pages/UsersPage';

function RootShell() {
  const loading = useAuthRedirect();

  return (
    <>
      {loading ? <GlobalLoader /> : null}
      <Outlet />
      <ErrorModal />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            borderRadius: 10,
            fontFamily: '"Inter", sans-serif',
            fontSize: 14,
          },
        }}
      />
    </>
  );
}

function GuestShell() {
  return (
    <GuestLayout>
      <Outlet />
    </GuestLayout>
  );
}

function ProtectedShell() {
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const user = useAppSelector((state) => state.auth.user);
  const fallbackUser = store.getState().auth.user;
  const role = user?.role ?? fallbackUser?.role;

  if (role && role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

const router = createBrowserRouter([
  {
    Component: RootShell,
    children: [
      // The landing page is full-bleed and dark, so it must not sit inside
      // GuestShell — that wraps its children in the narrow light card the
      // sign-in and sign-up forms are built around.
      { path: '/', Component: HomePage },
      {
        Component: GuestShell,
        children: [
          { path: '/login', Component: LoginPage },
          { path: '/signup', Component: SignupPage },
        ],
      },
      {
        Component: ProtectedShell,
        children: [
          { path: '/dashboard', Component: DashboardPage },
          { path: '/android-agent', Component: AndroidAgentPage },
          { path: '/android-devices', Component: AndroidDevicesPage },
          { path: '/android-fleet', Component: AndroidFleetPage },
          { path: '/agent-tasks', Component: AgentTasksPage },
          { path: '/my-rules', Component: MyRulesPage },
          { path: '/schedules', Component: SchedulesPage },
          { path: '/mission-control', Component: MissionControlPage },
          { path: '/flows', Component: FlowsPage },
          { path: '/settings', Component: SettingsPage },
          {
            path: '/users',
            element: (
              <AdminOnly>
                <UsersPage />
              </AdminOnly>
            ),
          },
          {
            path: '/ai-rules',
            element: (
              <AdminOnly>
                <AiRulesPage />
              </AdminOnly>
            ),
          },
          {
            path: '/browserworker-errors',
            element: (
              <AdminOnly>
                <BrowserWorkerErrorsPage />
              </AdminOnly>
            ),
          },
        ],
      },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
