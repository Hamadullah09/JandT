import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';

export const metadata: Metadata = {
  title: 'Login | Inaaya Store Order Portal',
  description: 'Log in to the Inaaya Store order portal.',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
