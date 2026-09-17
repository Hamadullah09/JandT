import Link from 'next/link';

const IMPLEMENTED = [
  { href: '/order/normal', label: 'Normal order' },
  { href: '/order/quick', label: 'Quick Order' },
  { href: '/order/bulk-import', label: 'Bulk Import Orders' },
];

/**
 * Shown for the sidebar entries this build does not implement.
 *
 * The sidebar has to list them - it is matched against the reference
 * screenshot - but the route should say plainly what it is rather than pretend
 * to be a working form.
 */
export function OutOfScope({ title }: { title: string }) {
  return (
    <div className="p-5">
      <div className="el-card p-5">
        <h1 className="mb-2 text-title font-semibold text-text-primary">{title}</h1>
        <p className="text-base text-text-regular">
          This module is outside the scope of this build. The implemented order paths are{' '}
          {IMPLEMENTED.map((entry, index) => (
            <span key={entry.href}>
              <Link className="text-brand hover:underline" href={entry.href}>
                {entry.label}
              </Link>
              {index < IMPLEMENTED.length - 2
                ? ', '
                : index === IMPLEMENTED.length - 2
                  ? ' and '
                  : '.'}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
