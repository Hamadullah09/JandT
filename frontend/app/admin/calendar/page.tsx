'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { OrderDrawer } from '@/components/admin/OrderDrawer';
import { ORDER_COLUMNS, OrderRow, SourceBar } from '@/components/admin/OrderTable';
import {
  CheckCircleIcon,
  ChevronLeftSm,
  ChevronRightSm,
  CloseIcon,
  DownloadIcon,
  RefreshIcon,
  ReturnIcon,
} from '@/components/ui/icons';
import { ApiError, api } from '@/lib/api';
import { mytInputNow } from '@/lib/myt';
import type { AdminOrderPage, CalendarDayOut, CalendarOut } from '@/lib/types.gen';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "2026-09" -> a UTC date on the 1st, so no time zone shifts the day. */
function monthStart(month: string): Date {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1, 1));
}

function shiftMonth(month: string, by: number): string {
  const date = monthStart(month);
  date.setUTCMonth(date.getUTCMonth() + by);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_TITLE = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY_TITLE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function dayTitle(day: string): string {
  return DAY_TITLE.format(new Date(`${day}T00:00:00Z`));
}

function money(value: string | number): string {
  return Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Stat({ value, label, colour }: { value: string | number; label: string; colour: string }) {
  return (
    <div className="rounded-xl border-2 border-line bg-white px-5 py-3">
      <span className="block text-[30px] font-bold leading-tight" style={{ color: colour }}>
        {value}
      </span>
      <span className="block text-[16px] text-text-regular">{label}</span>
    </div>
  );
}

function DayCell({
  day,
  today,
  busiest,
  selected,
  onSelect,
}: {
  day: CalendarDayOut;
  today: boolean;
  busiest: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const number = Number(day.day.slice(8));
  // busier days are a deeper sand colour
  const shade = day.orders ? 0.07 + 0.25 * (day.orders / Math.max(busiest, 1)) : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${dayTitle(day.day)}: ${day.orders} order${day.orders === 1 ? '' : 's'}`}
      className={`flex min-h-[132px] flex-col rounded-xl border-2 p-3 text-left transition-colors hover:border-brand ${
        selected ? 'border-brand shadow-[0_0_0_3px_rgba(3,3,2,0.16)]' : 'border-line'
      }`}
      style={{ background: shade ? `rgba(196, 164, 118, ${shade * 1.4})` : '#ffffff' }}
    >
      <span className="flex items-center justify-between">
        <span className={`text-[18px] font-bold ${today ? 'text-brand' : 'text-text-primary'}`}>{number}</span>
        {today && (
          <span className="rounded-full bg-brand px-2 py-[1px] text-[12px] font-bold text-white">Today</span>
        )}
      </span>
      {day.orders > 0 ? (
        <span className="mt-1 text-text-primary">
          <span className="text-[28px] font-bold leading-none">{day.orders}</span>
          <span className="ml-1 text-[15px]">order{day.orders === 1 ? '' : 's'}</span>
        </span>
      ) : (
        <span className="mt-1 text-[14px] text-text-secondary">No orders</span>
      )}
      <span className="mt-auto space-y-[2px] pt-1 text-[14px] leading-5">
        {day.delivered > 0 && (
          <span className="flex items-center gap-1 font-semibold text-[#3f8f1f]">
            <CheckCircleIcon className="h-4 w-4" /> {day.delivered} delivered
          </span>
        )}
        {day.returned > 0 && (
          <span className="flex items-center gap-1 font-semibold text-danger">
            <ReturnIcon className="h-4 w-4" /> {day.returned} returned
          </span>
        )}
      </span>
    </button>
  );
}

export default function CalendarPage() {
  const todayText = mytInputNow().slice(0, 10);
  const [month, setMonth] = useState(todayText.slice(0, 7));
  const [source, setSource] = useState<string | undefined>(undefined);
  const [calendar, setCalendar] = useState<CalendarOut | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(todayText);
  const [dayOrders, setDayOrders] = useState<AdminOrderPage | null>(null);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCalendar = useCallback(async () => {
    try {
      setCalendar(await api.adminCalendar(month, source));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the calendar.');
    }
  }, [month, source]);

  const loadDay = useCallback(async () => {
    if (!selectedDay) {
      setDayOrders(null);
      return;
    }
    try {
      setDayOrders(await api.adminOrders({ day: selectedDay, source }, 1, 200));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load that day.');
    }
  }, [selectedDay, source]);

  useEffect(() => {
    void loadCalendar();
    const timer = setInterval(() => void loadCalendar(), 30_000);
    return () => clearInterval(timer);
  }, [loadCalendar]);

  useEffect(() => {
    setDayOrders(null);
    void loadDay();
  }, [loadDay]);

  // blank squares before the 1st, so the 1st sits under its weekday (Monday first)
  const leading = useMemo(() => (monthStart(month).getUTCDay() + 6) % 7, [month]);
  const busiest = calendar ? Math.max(0, ...calendar.days.map((day) => day.orders)) : 0;
  const codTotal = calendar ? calendar.days.reduce((sum, day) => sum + Number(day.cod_amount), 0) : 0;
  const selected = calendar?.days.find((day) => day.day === selectedDay) ?? null;

  function goTo(next: string) {
    setMonth(next);
    setSelectedDay(next === todayText.slice(0, 7) ? todayText : null);
  }

  return (
    <div className="space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold leading-tight text-text-primary">Calendar</h1>
          <p className="mt-1 text-[17px] text-text-regular">
            How many orders came in each day. Click a day to see its orders.
          </p>
        </div>
        <button type="button" className="el-btn h-12 gap-2 px-5 text-[16px]" onClick={() => void loadCalendar()}>
          <RefreshIcon className="h-5 w-5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[#fbc4c4] bg-danger-tint px-5 py-3 text-[17px] text-danger" role="alert">
          {error}
        </div>
      )}

      {/* ------------------------------------------------- month bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="el-btn h-12 gap-1 px-4 text-[16px]"
          onClick={() => goTo(shiftMonth(month, -1))}
        >
          <ChevronLeftSm /> Previous month
        </button>
        <h2 className="min-w-[240px] text-center text-[28px] font-bold text-text-primary">
          {MONTH_TITLE.format(monthStart(month))}
        </h2>
        <button
          type="button"
          className="el-btn h-12 gap-1 px-4 text-[16px]"
          onClick={() => goTo(shiftMonth(month, 1))}
        >
          Next month <ChevronRightSm />
        </button>
        {month !== todayText.slice(0, 7) && (
          <button
            type="button"
            className="el-btn el-btn-outline h-12 px-4 text-[16px]"
            onClick={() => goTo(todayText.slice(0, 7))}
          >
            Back to this month
          </button>
        )}
      </div>

      {calendar && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat value={calendar.total_orders} label="orders this month" colour="#303133" />
          <Stat value={calendar.total_delivered} label="delivered" colour="#3f8f1f" />
          <Stat value={calendar.total_returned} label="returned" colour="#c62828" />
          <Stat value={`RM ${money(codTotal)}`} label="cash on delivery to collect" colour="#b86e00" />
        </div>
      )}

      <SourceBar sources={calendar?.sources ?? []} selected={source} onSelect={setSource} />

      {/* ------------------------------------------------------ grid */}
      <section aria-label="Days of the month" className="thin-scroll overflow-x-auto">
        <div className="grid min-w-[840px] grid-cols-7 gap-2">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="pb-1 text-center text-[16px] font-bold text-text-regular">
              {weekday}
            </div>
          ))}
          {Array.from({ length: leading }, (_, index) => (
            <div key={`blank-${index}`} aria-hidden className="min-h-[132px] rounded-xl bg-surface-page" />
          ))}
          {(calendar?.days ?? []).map((day) => (
            <DayCell
              key={day.day}
              day={day}
              today={day.day === calendar?.today}
              busiest={busiest}
              selected={day.day === selectedDay}
              onSelect={() => setSelectedDay(day.day === selectedDay ? null : day.day)}
            />
          ))}
        </div>
        {!calendar && !error && (
          <p className="py-10 text-center text-[18px] text-text-secondary">Loading the calendar...</p>
        )}
      </section>

      {/* ------------------------------------------------ chosen day */}
      {selectedDay && (
        <section className="overflow-hidden rounded-xl border-2 border-line bg-white" aria-label="Orders of the chosen day">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-line bg-surface-head px-5 py-4">
            <div>
              <h2 className="text-[22px] font-bold text-text-primary">{dayTitle(selectedDay)}</h2>
              <p className="text-[16px] text-text-regular">
                {dayOrders ? `${dayOrders.total} order${dayOrders.total === 1 ? '' : 's'} came in` : 'Loading...'}
                {selected && selected.delivered > 0 && ` · ${selected.delivered} delivered`}
                {selected && selected.returned > 0 && ` · ${selected.returned} returned`}
                {selected && Number(selected.cod_amount) > 0 && ` · RM ${money(selected.cod_amount)} COD`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {dayOrders && dayOrders.total > 0 && (
                <a
                  className="el-btn el-btn-outline h-12 gap-2 px-4 text-[16px]"
                  href={api.exportUrl({ day: selectedDay, source })}
                >
                  <DownloadIcon className="h-5 w-5" /> Download this day
                </a>
              )}
              <button
                type="button"
                className="el-btn h-12 gap-2 px-4 text-[16px]"
                onClick={() => setSelectedDay(null)}
              >
                <CloseIcon className="h-5 w-5" /> Close
              </button>
            </div>
          </div>
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-surface-head text-[15px] text-text-regular">
                <tr>
                  {ORDER_COLUMNS.map((heading) => (
                    <th key={heading} className="border-b-2 border-line px-4 py-3 text-left font-semibold">
                      {heading}
                    </th>
                  ))}
                  <th className="border-b-2 border-line px-4 py-3 text-right font-semibold">Edit</th>
                </tr>
              </thead>
              <tbody>
                {(dayOrders?.items ?? []).map((order) => (
                  <OrderRow key={order.id} order={order} onOpen={() => setOpenOrder(order.tracking_no)} />
                ))}
                {dayOrders && dayOrders.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-[18px] text-text-secondary">
                      No orders came in on this day.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {openOrder && (
        <OrderDrawer
          trackingNo={openOrder}
          onClose={() => setOpenOrder(null)}
          onChanged={() => {
            void loadCalendar();
            void loadDay();
          }}
        />
      )}
    </div>
  );
}
