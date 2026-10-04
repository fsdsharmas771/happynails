import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsOwner } from "../auth";
import { Field, Message, PageHead } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatINR, parseRupees, rupeesInput } from "../lib/format";
import type { Offering, Testimonial } from "../lib/types";

function OfferingRow({
  o,
  path,
  onSaved,
}: {
  o: Offering | null;
  path: "services" | "addons";
  onSaved: () => void;
}) {
  const owner = useIsOwner();
  const [f, setF] = useState({
    name: o?.name ?? "",
    description: o?.description ?? "",
    minutes: String(o?.minutes ?? 30),
    price: o ? rupeesInput(o.pricePaise) : "",
    active: o?.active ?? true,
    unitNote: o?.unitNote ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const pricePaise = parseRupees(f.price);
      if (pricePaise === null) throw new Error("Enter a valid price");
      const body = {
        name: f.name,
        description: f.description,
        minutes: Number(f.minutes),
        pricePaise,
        active: f.active,
        ...(path === "addons" ? { unitNote: f.unitNote } : {}),
      };
      return o ? api.patch(`/${path}/${o._id}`, body) : api.post(`/${path}`, body);
    },
    onSuccess: () => {
      setErr(null);
      onSaved();
    },
    onError: (e) => setErr(e instanceof Error && !("status" in e) ? e.message : errorText(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <div className="grid2">
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              disabled={!owner}
              value={f.name}
              onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Description">
          {(id) => (
            <input
              id={id}
              disabled={!owner}
              value={f.description}
              onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Minutes">
          {(id) => (
            <input
              id={id}
              disabled={!owner}
              type="number"
              min={5}
              value={f.minutes}
              onChange={(e) => setF((x) => ({ ...x, minutes: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Price (₹)">
          {(id) => (
            <input
              id={id}
              disabled={!owner}
              inputMode="decimal"
              value={f.price}
              onChange={(e) => setF((x) => ({ ...x, price: e.target.value }))}
            />
          )}
        </Field>
        {path === "addons" && (
          <Field label="Price note" hint='e.g. "per hand"'>
            {(id) => (
              <input
                id={id}
                disabled={!owner}
                value={f.unitNote}
                onChange={(e) => setF((x) => ({ ...x, unitNote: e.target.value }))}
              />
            )}
          </Field>
        )}
      </div>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            disabled={!owner}
            checked={f.active}
            onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))}
          />
          Offered
        </label>
        {owner && (
          <button className="btn xs" type="submit" disabled={save.isPending}>
            {o ? "Save" : "Add"}
          </button>
        )}
        {o && (
          <span className="note">
            Now {formatINR(o.pricePaise)}, {o.minutes} min
          </span>
        )}
      </div>
      <Message>{err}</Message>
    </form>
  );
}

export function ServicesPage() {
  const qc = useQueryClient();
  const owner = useIsOwner();
  const services = useQuery({ queryKey: ["services"], queryFn: () => api.get<Offering[]>("/services") });
  const addons = useQuery({ queryKey: ["addons"], queryFn: () => api.get<Offering[]>("/addons") });
  // Blank "add" forms get a fresh key only after a successful add, never when data loads.
  const [added, setAdded] = useState(0);
  const refresh = () => void qc.invalidateQueries();
  const addedOne = () => {
    setAdded((n) => n + 1);
    refresh();
  };

  return (
    <>
      <PageHead title="Services and add-ons" />
      <p className="note">
        Prices shown on the website and charged for bookings come from here. Changes do not affect visits
        already booked.
      </p>
      <h2 className="lbl">Services</h2>
      {services.data?.map((s) => (
        <OfferingRow key={s._id + s.pricePaise + s.minutes} o={s} path="services" onSaved={refresh} />
      ))}
      {owner && <OfferingRow key={`new-s-${added}`} o={null} path="services" onSaved={addedOne} />}
      <h2 className="lbl">Add-ons</h2>
      {addons.data?.map((a) => (
        <OfferingRow key={a._id + a.pricePaise + a.minutes} o={a} path="addons" onSaved={refresh} />
      ))}
      {owner && <OfferingRow key={`new-a-${added}`} o={null} path="addons" onSaved={addedOne} />}
    </>
  );
}

function TestimonialForm({ t, onSaved }: { t: Testimonial | null; onSaved: () => void }) {
  const owner = useIsOwner();
  const [f, setF] = useState(() => ({
    name: t?.name ?? "",
    city: t?.city ?? "",
    setName: t?.setName ?? "",
    quote: t?.quote ?? "",
    videoUrl: t?.videoUrl ?? "",
    posterUrl: t?.posterUrl ?? "",
    published: t?.published ?? false,
  }));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const save = useMutation({
    mutationFn: () => (t ? api.patch(`/testimonials/${t._id}`, f) : api.post("/testimonials", f)),
    onSuccess: () => {
      setMsg({ ok: true, text: "Saved." });
      onSaved();
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const remove = useMutation({ mutationFn: () => api.del(`/testimonials/${t!._id}`), onSuccess: onSaved });

  async function upload(file: File | undefined, kind: "image" | "video") {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.upload(file, kind);
      setF((x) => ({ ...x, [kind === "video" ? "videoUrl" : "posterUrl"]: url }));
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid2">
        <Field label="Client name">
          {(id) => (
            <input
              id={id}
              disabled={!owner}
              value={f.name}
              onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
            />
          )}
        </Field>
        <Field label="City">
          {(id) => (
            <input
              id={id}
              disabled={!owner}
              value={f.city}
              onChange={(e) => setF((x) => ({ ...x, city: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Set worn">
          {(id) => (
            <input
              id={id}
              disabled={!owner}
              value={f.setName}
              onChange={(e) => setF((x) => ({ ...x, setName: e.target.value }))}
            />
          )}
        </Field>
      </div>
      <Field label="What they said">
        {(id) => (
          <textarea
            id={id}
            rows={2}
            disabled={!owner}
            value={f.quote}
            onChange={(e) => setF((x) => ({ ...x, quote: e.target.value }))}
          />
        )}
      </Field>
      <div className="row">
        {f.posterUrl && (
          <img src={f.posterUrl} alt="" style={{ width: 72, height: 128, objectFit: "cover" }} />
        )}
        {f.videoUrl && (
          <video src={f.videoUrl} style={{ width: 72, height: 128, objectFit: "cover" }} muted />
        )}
      </div>
      {owner && (
        <div className="row">
          <label className="check">
            Video (MP4 or WebM, up to 50 MB)
            <input
              type="file"
              accept="video/mp4,video/webm"
              disabled={uploading}
              onChange={(e) => void upload(e.target.files?.[0], "video")}
            />
          </label>
          <label className="check">
            Poster image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(e) => void upload(e.target.files?.[0], "image")}
            />
          </label>
        </div>
      )}
      <label className="check">
        <input
          type="checkbox"
          disabled={!owner}
          checked={f.published}
          onChange={(e) => setF((x) => ({ ...x, published: e.target.checked }))}
        />
        Published on the website (only real clients, with their permission)
      </label>
      <Message ok={msg?.ok}>{msg?.text}</Message>
      {owner && (
        <div className="row">
          <button className="btn xs" type="submit" disabled={save.isPending || uploading}>
            {t ? "Save" : "Add"}
          </button>
          {t && (
            <button className="btn xs danger" type="button" onClick={() => remove.mutate()}>
              Delete
            </button>
          )}
        </div>
      )}
    </form>
  );
}

export function TestimonialsPage() {
  const qc = useQueryClient();
  const owner = useIsOwner();
  const q = useQuery({ queryKey: ["testimonials"], queryFn: () => api.get<Testimonial[]>("/testimonials") });
  const [added, setAdded] = useState(0);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["testimonials"] });
  return (
    <>
      <PageHead title="Testimonials" />
      <p className="note">
        The Stories section on the website shows only published testimonials. Nothing appears until you add a
        real one.
      </p>
      {q.data?.map((t) => (
        <TestimonialForm key={t._id + t.published + t.videoUrl} t={t} onSaved={refresh} />
      ))}
      {owner && (
        <TestimonialForm
          key={`new-${added}`}
          t={null}
          onSaved={() => {
            setAdded((n) => n + 1);
            refresh();
          }}
        />
      )}
    </>
  );
}
