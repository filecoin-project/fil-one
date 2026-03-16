import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ToastProvider } from '../components/primitives/Toast/ToastProvider';

function RootLayout() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

export const Route = createRootRoute({ component: RootLayout });
