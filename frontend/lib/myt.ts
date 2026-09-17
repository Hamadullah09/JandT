/** Malaysia time (UTC+8), which every time in the admin portal is shown in. */
export const MY_TIMEZONE = 'Asia/Kuala_Lumpur';

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: MY_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: MY_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

/** `17 Sep 2026, 02:08 PM` */
export function mytDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return DATE_TIME.format(new Date(iso)).replace(' am', ' AM').replace(' pm', ' PM');
}

/** `03:42:05 PM` */
export function mytClock(date: Date): string {
  return TIME.format(date).replace(' am', ' AM').replace(' pm', ' PM');
}

/** Now as a `datetime-local` value in Malaysia time: `2026-09-17T15:40`. */
export function mytInputNow(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: MY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
