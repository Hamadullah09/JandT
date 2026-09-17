import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';

export const metadata: Metadata = {
  title: 'Login | J&T Express Malaysia',
  description: 'Log in to the J&T Express merchant and admin portals.',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
