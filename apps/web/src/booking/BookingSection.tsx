import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addIstDays,
  BOOKING_HORIZON_DAYS,
  daysOfMonth,
  FEW_SLOTS_THRESHOLD,
  formatINR,
  formatIstTime,
  indianMobileSchema,
  istDateOf,
  istTimeOf,
  istWeekday,
  VISIT_CITIES,
  type BookingConfirmation,
  type HoldResponse,
  type IstDate,
  type Slot,
  type VisitCity,
} from "@happynails/shared";
import { SITE } from "../config/site";
import { ApiError, api } from "../lib/api";
import { formatIstDate } from "../lib/dates";
import { scrollToSection } from "../lib/motion";
import { normalizeMobile } from "../lib/phone";
import { useReveal } from "../lib/useReveal";
import "./booking.css";

type Step = 0 | 1 | 2 | 3;
const STEP_LABELS = ["Where", "Service", "Day and time", "Your details"] as const;
const MONTH_NAMES = [
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
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthOf = (date: IstDate) => date.slice(0, 7);
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `About ${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""}`;
};

function Field(props: { label: string; error?: string | undefined; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={`field${props.error ? " bad" : ""}`}>
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      <div className="err" aria-live="polite">
        {props.error}
      </div>
    </div>
  );
}

/** The confirmation takes focus once when it appears, so screen readers announce it. */
function DoneView({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div className="done" tabIndex={-1} ref={ref}>
      {children}
    </div>
  );
}

/** Seconds left on a hold, ticking once a second; null when there is no hold. */
function useCountdown(expiresAt: string | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

export function BookingSection() {
  const headRef = useReveal<HTMLDivElement>();
  const bodyRef = useReveal<HTMLDivElement>();
  const panelRef = useRef<HTMLDivElement>(null);
  const today = istDateOf(new Date());

  const services = useQuery({ queryKey: ["services"], queryFn: api.services, staleTime: 5 * 60_000 });

  const [step, setStep] = useState<Step>(0);
  const [city, setCity] = useState<VisitCity>("Delhi");
  const [pincode, setPincode] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string; shop?: boolean } | null>(null);
  const [checkingPin, setCheckingPin] = useState(false);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [addonIds, setAddonIds] = useState<string[]>([]);

  const [month, setMonth] = useState(monthOf(today));
  const [date, setDate] = useState<IstDate | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [holding, setHolding] = useState(false);
  const [slotMsg, setSlotMsg] = useState<string | null>(null);

  const [details, setDetails] = useState({ name: "", phone: "", address: "", notes: "" });
  const [errors, setErrors] = useState<Partial<Record<"name" | "phone" | "address", string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [done, setDone] = useState<BookingConfirmation | null>(null);

  // Default to the first service once the list arrives.
  useEffect(() => {
    if (!serviceId && services.data?.services[0]) setServiceId(services.data.services[0].id);
  }, [services.data, serviceId]);

  const availability = useQuery({
    queryKey: ["availability", city, serviceId, [...addonIds].sort(), month],
    queryFn: () => api.availability({ city, serviceId: serviceId!, addonIds, month }),
    enabled: step >= 2 && !!serviceId && !done,
    staleTime: 0,
  });

  const holdLeft = useCountdown(hold?.expiresAt ?? null);
  useEffect(() => {
    if (holdLeft === 0 && hold) {
      setHold(null);
      setSlotMsg("Your held time expired. Please pick a time again.");
      if (step === 3) setStep(2);
    }
  }, [holdLeft, hold, step]);

  /** Anything that changes what is being booked lets go of the held time. */
  function dropHold() {
    if (hold) void api.releaseHold(hold.holdToken).catch(() => undefined);
    setHold(null);
  }

  function chooseCity(c: VisitCity) {
    if (c === city) return;
    dropHold();
    setCity(c);
    setDate(null);
  }

  const service = services.data?.services.find((s) => s.id === serviceId);
  const addons = services.data?.addons.filter((a) => addonIds.includes(a.id)) ?? [];
  const minutes = (service?.minutes ?? 0) + addons.reduce((m, a) => m + a.minutes, 0);
  // Display only: the server prices the booking from its own records.
  const total = (service?.pricePaise ?? 0) + addons.reduce((t, a) => t + a.pricePaise, 0);

  function goStep(n: Step) {
    setStep(n);
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function nextFromWhere() {
    const pin = pincode.trim();
    setPinMsg(null);
    if (!/^\d{6}$/.test(pin)) {
      setPinError("Enter a 6 digit pincode");
      return;
    }
    setPinError("");
    setCheckingPin(true);
    try {
      const res = await api.checkPincode(pin);
      if (!res.covered || !res.city) {
        setPinMsg({ ok: false, text: "We do not visit this area yet. You can still ", shop: true });
        return;
      }
      if (res.city !== city) {
        chooseCity(res.city);
        setPinMsg({ ok: true, text: `That pincode is in ${res.city}. We switched your city.` });
      } else {
        setPinMsg({ ok: true, text: `We visit ${res.city}. Pincode ${pin} is covered.` });
      }
      goStep(1);
    } catch {
      setPinMsg({ ok: false, text: "We could not check that pincode just now. Please try again." });
    } finally {
      setCheckingPin(false);
    }
  }

  async function pickSlot(slot: Slot) {
    if (holding || !serviceId) return;
    if (hold?.startsAt === slot.startsAt) return;
    setSlotMsg(null);
    setHolding(true);
    // Let go of the previous hold first: it may cover the very time being picked.
    dropHold();
    try {
      setHold(await api.holdSlot({ city, serviceId, addonIds, startsAt: slot.startsAt }));
    } catch (err) {
      setSlotMsg(
        err instanceof ApiError && err.code === "SLOT_TAKEN"
          ? "That time has just been taken. Please pick another."
          : "We could not hold that time. Please try again.",
      );
    } finally {
      setHolding(false);
      void availability.refetch();
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!hold || submitting) return;
    const found: typeof errors = {};
    if (details.name.trim().length < 2) found.name = "Enter your name";
    if (!indianMobileSchema.safeParse(details.phone).success) found.phone = "Enter a 10 digit mobile number";
    if (details.address.trim().length < 9) found.address = "Add the address for the visit";
    setErrors(found);
    if (Object.keys(found).length) return;

    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const booking = await api.createBooking({
        holdToken: hold.holdToken,
        customer: { name: details.name.trim(), phone: details.phone },
        pincode: pincode.trim(),
        address: details.address.trim(),
        notes: details.notes.trim(),
      });
      setHold(null);
      setDone(booking);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      if (code === "HOLD_EXPIRED" || code === "SLOT_TAKEN") {
        setHold(null);
        setSlotMsg(
          code === "SLOT_TAKEN"
            ? "That time has just been taken. Please pick another."
            : "Your held time expired. Please pick a time again.",
        );
        goStep(2);
        void availability.refetch();
      } else if (code === "PINCODE_NOT_COVERED") {
        setPinError(`That pincode is not in ${city}`);
        goStep(0);
      } else {
        setSubmitMsg("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    setDone(null);
    setDate(null);
    setHold(null);
    setSlotMsg(null);
    setSubmitMsg(null);
    setStep(0);
  }

  // ---------- calendar ----------
  const lastDay = addIstDays(today, BOOKING_HORIZON_DAYS);
  const days = availability.data?.month === month ? availability.data.days : null;
  const allDates = daysOfMonth(month);
  const offset = (istWeekday(allDates[0]!) + 6) % 7;
  const selectedDay = days?.find((d) => d.date === date);
  const heldTime = hold ? istTimeOf(new Date(hold.startsAt)) : null;
  const heldDate = hold ? istDateOf(new Date(hold.startsAt)) : null;

  const when = date
    ? `${formatIstDate(date)}${heldTime && heldDate === date ? `, ${formatIstTime(heldTime)}` : ""}`
    : "Not chosen";

  return (
    <section className="sec" id="book" aria-labelledby="bookH">
      <div className="sec-head rv" ref={headRef}>
        <div>
          <p className="eyebrow">At your door</p>
          <h2 className="h2" id="bookH">
            Book a <em>home visit</em>
          </h2>
        </div>
        <p className="sub">
          Four short steps. Open slots are shown for every day of the month, for your city.
        </p>
      </div>
      <div className="book rv" ref={bodyRef}>
        <div className="panel" ref={panelRef}>
          {!done && (
            <div className="stepper" role="tablist" aria-label="Booking steps">
              {STEP_LABELS.map((label, n) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={step === n}
                  aria-current={step === n ? "step" : undefined}
                  disabled={n > step}
                  onClick={() => n <= step && goStep(n as Step)}
                >
                  <i>{n + 1}</i>
                  {label}
                </button>
              ))}
            </div>
          )}

          {!done && step === 0 && (
            <div className="bp">
              <h3>Where should we come?</h3>
              <div className="seg" role="group" aria-label="City">
                {VISIT_CITIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="fb"
                    aria-pressed={c === city}
                    onClick={() => chooseCity(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <Field label="Pincode" error={pinError}>
                {(id) => (
                  <input
                    id={id}
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="postal-code"
                    placeholder="e.g. 110017"
                    value={pincode}
                    onChange={(e) => {
                      setPincode(e.target.value.replace(/\D/g, ""));
                      setPinError("");
                    }}
                  />
                )}
              </Field>
              <div role="status" aria-live="polite">
                {pinMsg && (
                  <p className={`msg ${pinMsg.ok ? "ok" : "no"}`}>
                    {pinMsg.text}
                    {pinMsg.shop && (
                      <>
                        <a
                          href="#shop"
                          onClick={(e) => {
                            e.preventDefault();
                            scrollToSection("shop");
                          }}
                        >
                          order a set to be delivered
                        </a>
                        .
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="nav2">
                <span className="note">Visits cover Delhi, Noida and Gurgaon only.</span>
                <button
                  className="btn"
                  type="button"
                  disabled={checkingPin}
                  onClick={() => void nextFromWhere()}
                >
                  Choose a service <span className="arrow" />
                </button>
              </div>
            </div>
          )}

          {!done && step === 1 && (
            <div className="bp">
              <h3>What would you like?</h3>
              {services.isError && <p className="msg no">Services could not be loaded. Please refresh.</p>}
              <div className="opts" role="radiogroup" aria-label="Service">
                {services.data?.services.map((s) => (
                  <label className="opt" key={s.id}>
                    <input
                      type="radio"
                      name="svc"
                      checked={serviceId === s.id}
                      onChange={() => {
                        dropHold();
                        setServiceId(s.id);
                      }}
                    />
                    <span className="t">
                      <b>{s.name}</b>
                      <span>
                        {s.description} &middot; {s.minutes} min
                      </span>
                    </span>
                    <span className="pr">{formatINR(s.pricePaise)}</span>
                  </label>
                ))}
              </div>
              {!!services.data?.addons.length && <div className="lbl">Add-ons</div>}
              <div className="opts">
                {services.data?.addons.map((a) => (
                  <label className="opt" key={a.id}>
                    <input
                      type="checkbox"
                      checked={addonIds.includes(a.id)}
                      onChange={(e) => {
                        dropHold();
                        setAddonIds((ids) =>
                          e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id),
                        );
                      }}
                    />
                    <span className="t">
                      <b>
                        {a.name}
                        {a.unitNote ? `, ${a.unitNote}` : ""}
                      </b>
                      <span>{a.minutes} min</span>
                    </span>
                    <span className="pr">+{formatINR(a.pricePaise)}</span>
                  </label>
                ))}
              </div>
              <div className="nav2">
                <button className="btn ghost" type="button" onClick={() => goStep(0)}>
                  Back
                </button>
                <button className="btn" type="button" disabled={!serviceId} onClick={() => goStep(2)}>
                  Pick a day <span className="arrow" />
                </button>
              </div>
            </div>
          )}

          {!done && step === 2 && (
            <div className="bp">
              <h3>Pick a day and time</h3>
              <div className="cal-h">
                <h4>
                  {MONTH_NAMES[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
                </h4>
                <div>
                  <button
                    className="sq prev"
                    type="button"
                    aria-label="Previous month"
                    disabled={month <= monthOf(today)}
                    onClick={() => setMonth((m) => shiftMonth(m, -1))}
                  />
                  <button
                    className="sq next"
                    type="button"
                    aria-label="Next month"
                    disabled={month >= monthOf(lastDay)}
                    onClick={() => setMonth((m) => shiftMonth(m, 1))}
                  />
                </div>
              </div>
              <div className="dow" aria-hidden="true">
                {DOW.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="days" aria-busy={availability.isFetching}>
                {Array.from({ length: offset }, (_, i) => (
                  <span key={`b${i}`} className="day blank" />
                ))}
                {allDates.map((d) => {
                  const info = days?.find((x) => x.date === d);
                  const open = info?.openCount ?? 0;
                  const n = Number(d.slice(8));
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`day${open > 0 && open <= FEW_SLOTS_THRESHOLD ? " few" : ""}${d === today ? " today" : ""}`}
                      disabled={!open}
                      aria-pressed={date === d}
                      aria-label={`${formatIstDate(d, true)}, ${open ? `${open} ${open === 1 ? "slot" : "slots"} open` : "unavailable"}`}
                      onClick={() => {
                        setDate(d);
                        setSlotMsg(null);
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              {availability.isError && (
                <p className="msg no">Availability could not be loaded. Please try again.</p>
              )}
              <div className="legend">
                <span>
                  <i />
                  Few slots left
                </span>
                <span>Struck out: fully booked or too soon</span>
              </div>
              <div className={`lbl${slotMsg ? " bad" : ""}`} aria-live="polite">
                {slotMsg ??
                  (date ? `Times on ${formatIstDate(date, true)}, ${city}` : "Choose a day to see times")}
              </div>
              <div className="slots" aria-live="polite">
                {selectedDay?.slots.map((s) => {
                  const mine = hold?.startsAt === s.startsAt;
                  return (
                    <button
                      key={s.startsAt}
                      type="button"
                      className="slot"
                      disabled={(!s.open && !mine) || holding}
                      aria-pressed={mine}
                      onClick={() => void pickSlot(s)}
                    >
                      {formatIstTime(s.time)}
                    </button>
                  );
                })}
              </div>
              {hold && holdLeft !== null && (
                <p className="note" role="status">
                  Held for you for {Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, "0")}.
                </p>
              )}
              <div className="nav2">
                <button className="btn ghost" type="button" onClick={() => goStep(1)}>
                  Back
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => (hold ? goStep(3) : setSlotMsg("Choose a day and a time to continue"))}
                >
                  Your details <span className="arrow" />
                </button>
              </div>
            </div>
          )}

          {!done && step === 3 && (
            <form className="bp" onSubmit={(e) => void confirm(e)} noValidate>
              <h3>Who are we meeting?</h3>
              <div className="frm2">
                <Field label="Name" error={errors.name}>
                  {(id) => (
                    <input
                      id={id}
                      autoComplete="name"
                      value={details.name}
                      onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
                    />
                  )}
                </Field>
                <Field label="Mobile number" error={errors.phone}>
                  {(id) => (
                    <input
                      id={id}
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="10 digits"
                      value={details.phone}
                      onChange={(e) => setDetails((d) => ({ ...d, phone: normalizeMobile(e.target.value) }))}
                    />
                  )}
                </Field>
              </div>
              <Field label="Address for the visit" error={errors.address}>
                {(id) => (
                  <textarea
                    id={id}
                    rows={2}
                    autoComplete="street-address"
                    value={details.address}
                    onChange={(e) => setDetails((d) => ({ ...d, address: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="Notes, if any">
                {(id) => (
                  <input
                    id={id}
                    placeholder="Reference photo, allergies, parking"
                    value={details.notes}
                    onChange={(e) => setDetails((d) => ({ ...d, notes: e.target.value }))}
                  />
                )}
              </Field>
              {hold && holdLeft !== null && (
                <p className="note">
                  Your time is held for {Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, "0")}.
                </p>
              )}
              {submitMsg && (
                <p className="msg no" role="status">
                  {submitMsg}
                </p>
              )}
              <div className="nav2">
                <button className="btn ghost" type="button" onClick={() => goStep(2)}>
                  Back
                </button>
                <button className="btn" type="submit" disabled={submitting}>
                  {submitting ? "Confirming…" : "Confirm booking"}
                </button>
              </div>
            </form>
          )}

          {done && (
            <DoneView>
              <p className="eyebrow">Booking confirmed</p>
              <h3>See you soon, {done.firstName}.</h3>
              <div className="ref">{done.number}</div>
              <p style={{ color: "var(--muted)" }}>
                {done.serviceName}
                {done.addonNames.length ? ` with ${done.addonNames.join(", ")}` : ""} on{" "}
                {formatIstDate(istDateOf(new Date(done.startsAt)), true)} at{" "}
                {formatIstTime(istTimeOf(new Date(done.startsAt)))}, {done.city}. Keep this reference handy.
              </p>
              <button className="btn ghost" type="button" onClick={startOver}>
                Book another visit
              </button>
            </DoneView>
          )}
        </div>

        <aside className="panel sum" aria-label="Booking summary">
          <h4>Your visit</h4>
          <dl>
            <dt>City</dt>
            <dd>
              {city}
              {pincode.length === 6 ? ` ${pincode}` : ""}
            </dd>
            <dt>Service</dt>
            <dd>{service?.name ?? "Not chosen"}</dd>
            {addons.length > 0 && (
              <>
                <dt>Add-ons</dt>
                <dd>{addons.map((a) => a.name).join(", ")}</dd>
              </>
            )}
            <dt>Time needed</dt>
            <dd>{minutes ? duration(minutes) : "–"}</dd>
            <dt>When</dt>
            <dd>
              {done
                ? formatIstDate(istDateOf(new Date(done.startsAt))) +
                  ", " +
                  formatIstTime(istTimeOf(new Date(done.startsAt)))
                : when}
            </dd>
          </dl>
          <div className="total">
            <span className="lbl">Total</span>
            <b>{formatINR(done ? done.totalPaise : total)}</b>
          </div>
          <p className="note">{SITE.bookingPaymentNote}</p>
        </aside>
      </div>
    </section>
  );
}
