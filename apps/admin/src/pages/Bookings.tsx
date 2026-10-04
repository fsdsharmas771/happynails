import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  addIstDays,
  BOOKING_STATUSES,
  daysOfMonth,
  istDateOf,
  istWeekday,
  VISIT_CITIES,
} from "@happynails/shared";
import { useIsOwner } from "../auth";
import { Chip, Field, Message, PageHead } from "../components/ui";
import { api, errorText } from "../lib/api";
import {
  dayHeading,
  formatINR,
  istDate,
  istTime,
  label,
  parseRupees,
  timeOnly,
  toInstant,
  when,
} from "../lib/format";
import type { Booking, Offering, Technician } from "../lib/types";

type Mode = "day" | "week" | "month";

function rangeFor(mode: Mode, anchor: string): { from: string; to: string } {
  if (mode === "day") return { from: anchor, to: anchor };
  if (mode === "week") {
    const monday = addIstDays(anchor, -((istWeekday(anchor) + 6) % 7));
    return { from: monday, to: addIstDays(monday, 6) };
  }
  const days = daysOfMonth(anchor.slice(0, 7));
  return { from: days[0]!, to: days[days.length - 1]! };
}

function shift(mode: Mode, anchor: string, dir: 1 | -1): string {
  if (mode === "day") return addIstDays(anchor, dir);
  if (mode === "week") return addIstDays(anchor, 7 * dir);
  const [y, m] = anchor.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
}

function BookingDetail({
  b,
  techs,
  onDone,
}: {
  b: Booking;
  techs: Technician[];
  onDone: (b: Booking) => void;
}) {
  const owner = useIsOwner();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [date, setDate] = useState(istDate(b.startsAt));
  const [time, setTime] = useState(istTime(b.startsAt));
  const [tech, setTech] = useState(b.technicianId);
  const [note, setNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");

  const act = useMutation({
    mutationFn: (fn: () => Promise<Booking>) => fn(),
    onSuccess: (nb) => {
      setMsg({ ok: true, text: "Saved." });
      onDone(nb);
    },
    onError: (err) => setMsg({ ok: false, text: errorText(err) }),
  });
  const post = (path: string, body: unknown = {}) =>
    act.mutate(() => api.post<Booking>(`/bookings/${b._id}${path}`, body));
  const active = b.status === "confirmed" || b.status === "pending_payment";
  const techName = techs.find((t) => t._id === b.technicianId)?.name ?? "";

  return (
    <section className="panel stack" aria-label={`Booking ${b.number}`}>
      <div className="row">
        <h2 style={{ margin: 0 }}>{b.number}</h2>
        <Chip value={b.status} />
        <Chip value={b.payment.status} />
      </div>
      <dl className="kv">
        <dt>When</dt>
        <dd>
          {when(b.startsAt)} to {timeOnly(b.endsAt)}
        </dd>
        <dt>Where</dt>
        <dd>
          {b.address}, {b.city} {b.pincode}
        </dd>
        <dt>Customer</dt>
        <dd>
          {b.customer.name}, {b.customer.phone}
        </dd>
        <dt>Service</dt>
        <dd>
          {b.serviceName}
          {b.addons.length ? ` + ${b.addons.map((a) => a.name).join(", ")}` : ""}
        </dd>
        <dt>Technician</dt>
        <dd>{techName}</dd>
        <dt>Total</dt>
        <dd>
          {formatINR(b.totalPaise)} &middot; {b.payment.method === "online" ? "Online" : "After the visit"}
        </dd>
        {b.notes && (
          <>
            <dt>Notes</dt>
            <dd>{b.notes}</dd>
          </>
        )}
      </dl>
      <Message ok={msg?.ok}>{msg?.text}</Message>

      {active && (
        <div className="stack">
          <div className="lbl">Reschedule</div>
          <div className="grid2">
            <Field label="Date">
              {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="Time">
              {(id) => <input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
            </Field>
          </div>
          <Field label="Technician">
            {(id) => (
              <select id={id} value={tech} onChange={(e) => setTech(e.target.value)}>
                {techs
                  .filter((t) => t.active && t.cities.includes(b.city))
                  .map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <div>
            <button
              className="btn xs ghost"
              type="button"
              disabled={act.isPending}
              onClick={() => post("/reschedule", { startsAt: toInstant(date, time), technicianId: tech })}
            >
              Move booking
            </button>
          </div>
          <p className="note">
            Travel time between visits is checked: 1 hour, or 4 hours between Noida and Delhi or Gurgaon.
          </p>
        </div>
      )}

      <div className="stack">
        <Field label="Note (optional)">
          {(id) => <input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="row">
          {b.status === "confirmed" && (
            <>
              <button
                className="btn xs"
                type="button"
                disabled={act.isPending}
                onClick={() => post("/complete", { note })}
              >
                Mark done
              </button>
              <button
                className="btn xs ghost"
                type="button"
                disabled={act.isPending}
                onClick={() => post("/no-show", { note })}
              >
                No-show
              </button>
            </>
          )}
          {b.payment.status === "due" && (
            <button
              className="btn xs ghost"
              type="button"
              disabled={act.isPending}
              onClick={() => post("/mark-paid")}
            >
              Payment collected
            </button>
          )}
          {active && (
            <button
              className="btn xs danger"
              type="button"
              disabled={act.isPending}
              onClick={() => post("/cancel", { note })}
            >
              Cancel visit
            </button>
          )}
        </div>
      </div>

      {owner && b.payment.status === "captured" && (
        <div className="stack">
          <div className="lbl">Refund</div>
          <div className="row">
            <Field label="Amount (₹)" hint="Empty for the full amount">
              {(id) => (
                <input
                  id={id}
                  inputMode="decimal"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              )}
            </Field>
            <button
              className="btn xs danger"
              type="button"
              disabled={act.isPending || note.trim().length < 2}
              onClick={() => {
                const amountPaise = refundAmount.trim() ? parseRupees(refundAmount) : undefined;
                if (amountPaise === null) return setMsg({ ok: false, text: "Enter a valid amount." });
                post("/refund", { reason: note, ...(amountPaise ? { amountPaise } : {}) });
              }}
            >
              Refund through Razorpay
            </button>
          </div>
          <p className="note">The note above is used as the refund reason.</p>
        </div>
      )}

      <div className="lbl">History</div>
      <ol className="timeline">
        {b.events.map((e, k) => (
          <li key={k}>
            <Chip value={e.status} /> {when(e.at)}
            {e.note && <small>{e.note}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function NewBooking({ techs, onDone }: { techs: Technician[]; onDone: (b: Booking) => void }) {
  const services = useQuery({ queryKey: ["services"], queryFn: () => api.get<Offering[]>("/services") });
  const addons = useQuery({ queryKey: ["addons"], queryFn: () => api.get<Offering[]>("/addons") });
  const [f, setF] = useState({
    city: "Delhi" as (typeof VISIT_CITIES)[number],
    pincode: "",
    address: "",
    name: "",
    phone: "",
    serviceId: "",
    addonIds: [] as string[],
    date: addIstDays(istDateOf(new Date()), 1),
    time: "10:00",
    technicianId: "",
    notes: "",
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<Booking>("/bookings", {
        city: f.city,
        pincode: f.pincode,
        address: f.address,
        customer: { name: f.name, phone: f.phone },
        serviceId: f.serviceId || services.data?.find((s) => s.active)?._id,
        addonIds: f.addonIds,
        startsAt: toInstant(f.date, f.time),
        ...(f.technicianId ? { technicianId: f.technicianId } : {}),
        notes: f.notes,
      }),
    onSuccess: onDone,
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>New booking</h2>
      <p className="note">For customers who book by phone or WhatsApp. Paid after the visit.</p>
      <div className="grid2">
        <Field label="City">
          {(id) => (
            <select id={id} value={f.city} onChange={(e) => set("city")(e.target.value)}>
              {VISIT_CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Pincode">
          {(id) => (
            <input
              id={id}
              inputMode="numeric"
              maxLength={6}
              value={f.pincode}
              onChange={(e) => set("pincode")(e.target.value.replace(/\D/g, ""))}
            />
          )}
        </Field>
      </div>
      <Field label="Address">
        {(id) => <input id={id} value={f.address} onChange={(e) => set("address")(e.target.value)} />}
      </Field>
      <div className="grid2">
        <Field label="Customer name">
          {(id) => <input id={id} value={f.name} onChange={(e) => set("name")(e.target.value)} />}
        </Field>
        <Field label="Mobile">
          {(id) => (
            <input
              id={id}
              inputMode="tel"
              maxLength={10}
              value={f.phone}
              onChange={(e) => set("phone")(e.target.value.replace(/\D/g, ""))}
            />
          )}
        </Field>
      </div>
      <Field label="Service">
        {(id) => (
          <select id={id} value={f.serviceId} onChange={(e) => set("serviceId")(e.target.value)}>
            {services.data
              ?.filter((s) => s.active)
              .map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name} ({s.minutes} min, {formatINR(s.pricePaise)})
                </option>
              ))}
          </select>
        )}
      </Field>
      <div className="row">
        {addons.data
          ?.filter((a) => a.active)
          .map((a) => (
            <label key={a._id} className="check">
              <input
                type="checkbox"
                checked={f.addonIds.includes(a._id)}
                onChange={(e) =>
                  setF((x) => ({
                    ...x,
                    addonIds: e.target.checked
                      ? [...x.addonIds, a._id]
                      : x.addonIds.filter((i) => i !== a._id),
                  }))
                }
              />
              {a.name}
            </label>
          ))}
      </div>
      <div className="grid2">
        <Field label="Date">
          {(id) => <input id={id} type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} />}
        </Field>
        <Field label="Time">
          {(id) => <input id={id} type="time" value={f.time} onChange={(e) => set("time")(e.target.value)} />}
        </Field>
      </div>
      <Field label="Technician">
        {(id) => (
          <select id={id} value={f.technicianId} onChange={(e) => set("technicianId")(e.target.value)}>
            <option value="">First one free</option>
            {techs
              .filter((t) => t.active && t.cities.includes(f.city))
              .map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
          </select>
        )}
      </Field>
      <Field label="Notes">
        {(id) => <input id={id} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />}
      </Field>
      <Message>{create.isError ? errorText(create.error) : null}</Message>
      <div>
        <button className="btn sm" type="submit" disabled={create.isPending}>
          Book visit
        </button>
      </div>
    </form>
  );
}

export function BookingsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(istDateOf(new Date()));
  const [city, setCity] = useState("");
  const [tech, setTech] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const open = params.get("open");
  const range = rangeFor(mode, anchor);

  const techs = useQuery({ queryKey: ["technicians"], queryFn: () => api.get<Technician[]>("/technicians") });
  const list = useQuery({
    queryKey: ["bookings", range, city, tech, status],
    queryFn: () =>
      api.get<Booking[]>(
        `/bookings?${new URLSearchParams({ ...range, ...(city ? { city } : {}), ...(tech ? { technicianId: tech } : {}), ...(status ? { status } : {}) })}`,
      ),
  });
  const selected = useQuery({
    queryKey: ["booking", open],
    queryFn: () => api.get<Booking>(`/bookings/${open}`),
    enabled: !!open,
  });

  const grouped = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of list.data ?? []) {
      const d = istDate(b.startsAt);
      m.set(d, [...(m.get(d) ?? []), b]);
    }
    return [...m.entries()];
  }, [list.data]);

  const select = (id: string | null) =>
    setParams((p) => {
      if (id) p.set("open", id);
      else p.delete("open");
      return p;
    });

  const refresh = (b: Booking) => {
    qc.setQueryData(["booking", b._id], b);
    void qc.invalidateQueries({ queryKey: ["bookings"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const techName = (id: string) => techs.data?.find((t) => t._id === id)?.name ?? "";

  return (
    <>
      <PageHead title="Bookings">
        <button className="btn sm" type="button" onClick={() => setCreating((c) => !c)}>
          {creating ? "Close" : "New booking"}
        </button>
      </PageHead>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Range">
          {(["day", "week", "month"] as const).map((m) => (
            <button key={m} type="button" className="fb" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {label(m)}
            </button>
          ))}
        </div>
        <div className="row">
          <button
            className="sq prev"
            type="button"
            aria-label="Earlier"
            onClick={() => setAnchor((a) => shift(mode, a, -1))}
          />
          <span className="note">
            {range.from === range.to ? range.from : `${range.from} to ${range.to}`}
          </span>
          <button
            className="sq next"
            type="button"
            aria-label="Later"
            onClick={() => setAnchor((a) => shift(mode, a, 1))}
          />
          <button className="tlink" type="button" onClick={() => setAnchor(istDateOf(new Date()))}>
            Today
          </button>
        </div>
        <Field label="City">
          {(id) => (
            <select id={id} value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">All</option>
              {VISIT_CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Technician">
          {(id) => (
            <select id={id} value={tech} onChange={(e) => setTech(e.target.value)}>
              <option value="">All</option>
              {techs.data?.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {BOOKING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="split">
        <div className="stack">
          {grouped.length === 0 && (
            <div className="panel empty-row">{list.isPending ? "Loading" : "No bookings in this range."}</div>
          )}
          {grouped.map(([day, items]) => (
            <div key={day} className="daygroup">
              <h3>{dayHeading(day)}</h3>
              <div className="tablewrap">
                <table className="t">
                  <tbody>
                    {items.map((b) => (
                      <tr
                        key={b._id}
                        className="click"
                        aria-selected={open === b._id}
                        onClick={() => select(b._id)}
                      >
                        <td>{timeOnly(b.startsAt)}</td>
                        <td>{b.customer.name}</td>
                        <td>{b.serviceName}</td>
                        <td>{b.city}</td>
                        <td>{techName(b.technicianId)}</td>
                        <td>
                          <Chip value={b.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
        <div className="stack">
          {creating && techs.data && (
            <NewBooking
              techs={techs.data}
              onDone={(b) => {
                setCreating(false);
                refresh(b);
                setAnchor(istDate(b.startsAt));
                select(b._id);
              }}
            />
          )}
          {open && selected.data && techs.data && (
            <BookingDetail
              key={selected.data._id + selected.data.events.length}
              b={selected.data}
              techs={techs.data}
              onDone={refresh}
            />
          )}
          {!open && !creating && <p className="note">Choose a booking to see details and actions.</p>}
        </div>
      </div>
    </>
  );
}
