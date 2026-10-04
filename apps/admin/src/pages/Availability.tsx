import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { daysOfMonth, istDateOf, istWeekday } from "@happynails/shared";
import { useIsOwner } from "../auth";
import { Message, PageHead } from "../components/ui";
import { api, errorText } from "../lib/api";
import { dayHeading, timeOnly } from "../lib/format";
import type { Technician } from "../lib/types";

interface CalendarDay {
  date: string;
  source: "weekly" | "custom" | "blocked" | "off";
  slotTimes: string[];
  note: string;
  bookings: {
    id: string;
    number: string;
    startsAt: string;
    endsAt: string;
    city: string;
    customerName: string;
    serviceName: string;
    status: string;
  }[];
}

const SOURCE_LABEL: Record<CalendarDay["source"], string> = {
  weekly: "Weekly hours",
  custom: "Set for this date",
  blocked: "Leave",
  off: "Day off",
};
const QUICK_TIMES = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "12:30",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "17:30",
  "18:00",
  "19:00",
  "19:30",
  "20:00",
  "21:00",
];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

function DayEditor({ techId, day, onSaved }: { techId: string; day: CalendarDay; onSaved: () => void }) {
  const owner = useIsOwner();
  const [times, setTimes] = useState<string[]>(day.slotTimes);
  const [extra, setExtra] = useState("");
  const [note, setNote] = useState(day.note);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setTimes(day.slotTimes);
    setNote(day.note);
    setMsg(null);
  }, [day]);

  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setMsg({ ok: true, text: "Saved. Customers see the change straight away." });
      onSaved();
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });

  const options = [...new Set([...QUICK_TIMES, ...times])].sort();
  const toggle = (t: string) =>
    setTimes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t].sort()));
  const bookedTimes = new Set(day.bookings.map((b) => timeOnly(b.startsAt)));
  const removedWithBookings =
    day.slotTimes.filter((t) => !times.includes(t)).length > 0 && day.bookings.length > 0;
  const save = (slotTimes: string[]) =>
    run.mutate(() => api.put(`/calendar/${techId}/${day.date}`, { slotTimes, note }));

  return (
    <section className="panel stack" aria-label={`Availability on ${day.date}`}>
      <h2 style={{ margin: 0 }}>{dayHeading(day.date)}</h2>
      <p className="note">
        {SOURCE_LABEL[day.source]}
        {day.note ? ` · ${day.note}` : ""}
      </p>

      <div className="lbl">Start times customers can book</div>
      <div className="seg" role="group" aria-label="Start times">
        {options.map((t) => (
          <button
            key={t}
            type="button"
            className="fb"
            aria-pressed={times.includes(t)}
            disabled={!owner}
            onClick={() => toggle(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {owner && (
        <div className="row" style={{ alignItems: "end" }}>
          <div className="field" style={{ width: 130 }}>
            <label htmlFor="extra-time">Add a time</label>
            <input id="extra-time" type="time" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
          <button
            className="btn xs ghost"
            type="button"
            disabled={!TIME.test(extra)}
            onClick={() => {
              setTimes((cur) => [...new Set([...cur, extra])].sort());
              setExtra("");
            }}
          >
            Add
          </button>
        </div>
      )}
      <p className="note">
        Travel time is kept free automatically: 1 hour between visits, 4 hours between Noida and Delhi or
        Gurgaon.
      </p>
      {owner && (
        <div className="field">
          <label htmlFor="day-note">Note (only you see this)</label>
          <input
            id="day-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Wedding in the family"
          />
        </div>
      )}
      {removedWithBookings && (
        <p className="msg no">
          Removing times does not cancel visits already booked that day. Reschedule or cancel them in
          Bookings.
        </p>
      )}
      <Message ok={msg?.ok}>{msg?.text}</Message>
      {owner && (
        <div className="row">
          <button className="btn xs" type="button" disabled={run.isPending} onClick={() => save(times)}>
            Save this day
          </button>
          <button className="btn xs danger" type="button" disabled={run.isPending} onClick={() => save([])}>
            Close this day
          </button>
          {day.source === "custom" && (
            <button
              className="btn xs ghost"
              type="button"
              disabled={run.isPending}
              onClick={() => run.mutate(() => api.del(`/calendar/${techId}/${day.date}`))}
            >
              Back to weekly hours
            </button>
          )}
        </div>
      )}

      <div className="lbl">Visits this day</div>
      {day.bookings.length === 0 && <p className="note">None.</p>}
      <ul className="timeline">
        {day.bookings.map((b) => (
          <li key={b.id}>
            <b>{timeOnly(b.startsAt)}</b> to {timeOnly(b.endsAt)} · {b.customerName} · {b.serviceName} ·{" "}
            {b.city}
            <small>
              {b.number} · {b.status.replace("_", " ")}
            </small>
          </li>
        ))}
      </ul>
      {bookedTimes.size > 0 && (
        <span className="note">Booked start times are kept even if you remove them from the list.</span>
      )}
    </section>
  );
}

export function AvailabilityPage() {
  const qc = useQueryClient();
  const today = istDateOf(new Date());
  const techs = useQuery({ queryKey: ["technicians"], queryFn: () => api.get<Technician[]>("/technicians") });
  const [techId, setTechId] = useState("");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(today);
  const active = useMemo(() => (techs.data ?? []).filter((t) => t.active), [techs.data]);
  const tech = techId || active[0]?._id || "";

  const cal = useQuery({
    queryKey: ["calendar", tech, month],
    queryFn: () => api.get<CalendarDay[]>(`/calendar?technicianId=${tech}&month=${month}`),
    enabled: !!tech,
  });
  const dates = daysOfMonth(month);
  const offset = (istWeekday(dates[0]!) + 6) % 7;
  const day = cal.data?.find((d) => d.date === selected) ?? null;

  return (
    <>
      <PageHead title="Availability">
        {active.length > 1 && (
          <select aria-label="Technician" value={tech} onChange={(e) => setTechId(e.target.value)}>
            {active.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </PageHead>
      <p className="note">
        Choose a day to change the start times customers can book. Weekly hours and leave are set under
        Technicians; a day set here overrides both.
      </p>
      <div className="split">
        <section className="panel stack">
          <div className="cal-h row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>
              {MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
            </h2>
            <div className="row">
              <button
                className="sq prev"
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
              />
              <button
                className="sq next"
                type="button"
                aria-label="Next month"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
              />
            </div>
          </div>
          <div className="calgrid" aria-hidden="true">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d} className="dow">
                {d}
              </span>
            ))}
          </div>
          <div className="calgrid" aria-busy={cal.isFetching}>
            {Array.from({ length: offset }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {dates.map((date) => {
              const d = cal.data?.find((x) => x.date === date);
              const past = date < today;
              return (
                <button
                  key={date}
                  type="button"
                  className={`calday ${d?.source ?? ""}${date === today ? " today" : ""}${past ? " past" : ""}`}
                  aria-pressed={selected === date}
                  aria-label={`${dayHeading(date)}: ${d ? `${SOURCE_LABEL[d.source]}, ${d.slotTimes.length} start times, ${d.bookings.length} visits` : "loading"}`}
                  onClick={() => setSelected(date)}
                >
                  <b>{Number(date.slice(8))}</b>
                  {d && (
                    <>
                      <span>
                        {d.slotTimes.length
                          ? `${d.slotTimes.length} times`
                          : d.source === "blocked"
                            ? "Leave"
                            : "Closed"}
                      </span>
                      {d.bookings.length > 0 && <i>{d.bookings.length} booked</i>}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="legend-a">
            <span className="calday weekly">Weekly</span>
            <span className="calday custom">Set for date</span>
            <span className="calday blocked">Leave</span>
            <span className="calday off">Off</span>
          </div>
        </section>
        {day && tech && (
          <DayEditor
            techId={tech}
            day={day}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ["calendar"] });
            }}
          />
        )}
      </div>
    </>
  );
}
