import Link from 'next/link';
import { AUTH_LINK_BUTTON } from '@/components/auth/AuthShell';

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-5 text-center">
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[1.5px] text-brand">Forgot password</h1>
      <p className="text-[17px] leading-7 text-[#55544f]">
        Ask the admin to set a new password for you. The admin can do it in
        <strong className="text-brand"> Admin Portal → Users</strong>.
      </p>
      <Link href="/login" className={AUTH_LINK_BUTTON}>
        Back to Login
      </Link>
    </div>
  );
}
