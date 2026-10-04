import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VISIT_CITIES, type VisitCity } from "@happynails/shared";
import { useIsOwner } from "../auth";
import { Field, Message, PageHead } from "../components/ui";
import { api, errorText } from "../lib/api";
import type { Technician } from "../lib/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function TechnicianEditor({ t, onSaved }: { t: Technician | null; onSaved: () => void }) {
  const owner = useIsOwner();
  const [info, setInfo] = useState({
    name: t?.name ?? "",
    phone: t?.phone ?? "",
    cities: (t?.cities ?? []) as VisitCity[],
    active: t?.active ?? true,
  });
  const [week, setWeek] = useState(() =>
    DAYS.map((_, weekday) => t?.week.find((d) => d.weekday === weekday)?.slotTimes.join(", ") ?? ""),
  );
  const [block, setBlock] = useState({ fromDate: "", toDate: "", reason: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setMsg({ ok: true, text: "Saved." });
      onSaved();
    },
    onError: (err) => setMsg({ ok: false, text: errorText(err) }),
  });

  function saveInfo(e: FormEvent) {
    e.preventDefault();
    run.mutate(() => (t ? api.patch(`/technicians/${t._id}`, info) : api.post("/technicians", info)));
  }

  function saveWeek() {
    const days: { weekday: number; slotTimes: string[] }[] = [];
    for (const [weekday, text] of week.entries()) {
      const times = text
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (/^\d:\d\d$/.test(s) ? `0${s}` : s));
      const bad = times.find((x) => !TIME.test(x));
      if (bad)
        return setMsg({
          ok: false,
          text: `${DAYS[weekday]}: "${bad}" is not a 24-hour time like 10:00 or 17:30`,
        });
      if (times.length) days.push({ weekday, slotTimes: times });
    }
    // Show exactly what is saved: padded, sorted, de-duplicated.
    setWeek(
      DAYS.map((_, wd) =>
        [...new Set(days.find((d) => d.weekday === wd)?.slotTimes ?? [])].sort().join(", "),
      ),
    );
    run.mutate(() => api.put(`/technicians/${t!._id}/hours`, { days }));
  }

  return (
    <section className="panel stack">
      <h2>{t ? t.name : "New technician"}</h2>
      <form className="stack" onSubmit={saveInfo}>
        <div className="grid2">
          <Field label="Name">
            {(id) => (
              <input
                id={id}
                value={info.name}
                disabled={!owner}
                onChange={(e) => setInfo((x) => ({ ...x, name: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Mobile">
            {(id) => (
              <input
                id={id}
                inputMode="tel"
                maxLength={10}
                value={info.phone}
                disabled={!owner}
                onChange={(e) => setInfo((x) => ({ ...x, phone: e.target.value.replace(/\D/g, "") }))}
              />
            )}
          </Field>
        </div>
        <div className="row" role="group" aria-label="Cities covered">
          <span className="lbl">Covers</span>
          {VISIT_CITIES.map((c) => (
            <label key={c} className="check">
              <input
                type="checkbox"
                disabled={!owner}
                checked={info.cities.includes(c)}
                onChange={(e) =>
                  setInfo((x) => ({
                    ...x,
                    cities: e.target.checked ? [...x.cities, c] : x.cities.filter((y) => y !== c),
                  }))
                }
              />
              {c}
            </label>
          ))}
          <label className="check">
            <input
              type="checkbox"
              disabled={!owner}
              checked={info.active}
              onChange={(e) => setInfo((x) => ({ ...x, active: e.target.checked }))}
            />
            Taking bookings
          </label>
        </div>
        {owner && (
          <div>
            <button className="btn xs" type="submit" disabled={run.isPending}>
              Save details
            </button>
          </div>
        )}
      </form>

      {t && (
        <>
          <div className="lbl">Weekly slot start times</div>
          <p className="note">
            24-hour times, separated by commas. Leave a day empty for a day off. Travel time between visits is
            added automatically.
          </p>
          <div className="week">
            {DAYS.map((d, i) => (
              <label key={d} style={{ display: "contents" }}>
                <span>{d}</span>
                <input
                  type="text"
                  disabled={!owner}
                  value={week[i]}
                  placeholder="Day off"
                  onChange={(e) => setWeek((w) => w.map((x, k) => (k === i ? e.target.value : x)))}
                />
              </label>
            ))}
          </div>
          {owner && (
            <div>
              <button className="btn xs" type="button" disabled={run.isPending} onClick={saveWeek}>
                Save hours
              </button>
            </div>
          )}

          <div className="lbl">Leave and blocked days</div>
          {t.blocks.length === 0 && <p className="note">None coming up.</p>}
          <ul className="timeline">
            {t.blocks.map((b) => (
              <li key={b._id} className="row">
                {b.fromDate === b.toDate ? b.fromDate : `${b.fromDate} to ${b.toDate}`}{" "}
                {b.reason && `· ${b.reason}`}
                {owner && (
                  <button
                    className="tlink"
                    type="button"
                    onClick={() => run.mutate(() => api.del(`/technicians/${t._id}/blocks/${b._id}`))}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {owner && (
            <div className="row" style={{ alignItems: "end" }}>
              <Field label="From">
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    value={block.fromDate}
                    onChange={(e) => setBlock((b) => ({ ...b, fromDate: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="To">
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    value={block.toDate}
                    onChange={(e) => setBlock((b) => ({ ...b, toDate: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="Reason">
                {(id) => (
                  <input
                    id={id}
                    value={block.reason}
                    onChange={(e) => setBlock((b) => ({ ...b, reason: e.target.value }))}
                  />
                )}
              </Field>
              <button
                className="btn xs ghost"
                type="button"
                disabled={!block.fromDate || !block.toDate || run.isPending}
                onClick={() => run.mutate(() => api.post(`/technicians/${t._id}/blocks`, block))}
              >
                Block days
              </button>
            </div>
          )}
        </>
      )}
      <Message ok={msg?.ok}>{msg?.text}</Message>
    </section>
  );
}

export function TechniciansPage() {
  const owner = useIsOwner();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["technicians"], queryFn: () => api.get<Technician[]>("/technicians") });
  const [open, setOpen] = useState<string | "new" | null>(null);
  const selected = open && open !== "new" ? (q.data?.find((t) => t._id === open) ?? null) : null;

  return (
    <>
      <PageHead title="Technicians">
        {owner && (
          <button className="btn sm" type="button" onClick={() => setOpen("new")}>
            Add technician
          </button>
        )}
      </PageHead>
      <div className="split">
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>Name</th>
                <th>Covers</th>
                <th>Days worked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((t) => (
                <tr
                  key={t._id}
                  className="click"
                  aria-selected={open === t._id}
                  onClick={() => setOpen(t._id)}
                >
                  <td>{t.name}</td>
                  <td>{t.cities.join(", ")}</td>
                  <td>{t.week.length}</td>
                  <td>
                    {t.active ? (
                      <span className="chip-s good">Active</span>
                    ) : (
                      <span className="chip-s muted">Off</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {open && (
          <TechnicianEditor
            key={open + (selected?.week.length ?? 0) + (selected?.blocks.length ?? 0)}
            t={selected}
            onSaved={() => void qc.invalidateQueries({ queryKey: ["technicians"] })}
          />
        )}
      </div>
    </>
  );
}
