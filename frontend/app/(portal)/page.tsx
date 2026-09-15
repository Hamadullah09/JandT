import Link from 'next/link';

const LINKS = [
  { href: '/order/normal', label: 'Normal order', hint: 'Create a single shipment' },
  { href: '/order/bulk-import', label: 'Bulk Import Orders', hint: 'Upload a CSV, create many' },
  { href: '/order/management', label: 'Order Management', hint: 'Browse created orders' },
  { href: '/settings/sender', label: 'Sender Profile', hint: 'The fixed sender used on every order' },
];

export default function Homepage() {
  return (
    <div className="p-5">
      <div className="el-card p-5">
        <h1 className="mb-1 text-title font-semibold text-text-primary">Homepage</h1>
        <p className="mb-5 text-base text-text-regular">
          Merchant portal for LINKED INTERNATIONAL SDN BHD (JTMY027288).
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded border border-line p-4 transition-colors hover:border-jt-red"
            >
              <div className="text-base font-semibold text-text-primary">{l.label}</div>
              <div className="mt-1 text-base text-text-secondary">{l.hint}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
