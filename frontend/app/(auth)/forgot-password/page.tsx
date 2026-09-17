import Link from 'next/link';

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-5 text-center">
      <h1 className="text-[32px] font-normal leading-tight text-[#333]">Forgot password</h1>
      <p className="text-[14px] leading-6 text-[#555]">
        Ask the admin to set a new password for you. The admin can do it in
        <strong className="text-[#333]"> Admin Portal → Users</strong>.
      </p>
      <Link
        href="/login"
        className="inline-block rounded-[3px] px-4 py-[8px] text-[15px] text-white"
        style={{ background: '#e60012' }}
      >
        Back to Login
      </Link>
    </div>
  );
}
