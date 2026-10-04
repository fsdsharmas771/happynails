import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FINISH_LABELS, NAIL_FINISHES, NAIL_SHAPES, OCCASION_LABELS, OCCASIONS } from "@happynails/shared";
import { NailArt } from "@happynails/ui";
import { useIsOwner } from "../auth";
import { Field, Message, PageHead } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatINR, label, parseRupees, rupeesInput } from "../lib/format";
import type { Product } from "../lib/types";

function Thumb({ p }: { p: Pick<Product, "shape" | "finish" | "color" | "color2" | "images"> }) {
  const img = p.images[0];
  return (
    <span className="thumb">
      {img ? (
        <img src={img.url} alt="" />
      ) : (
        <NailArt
          shape={p.shape}
          finish={p.finish}
          color={p.color}
          {...(p.color2 ? { color2: p.color2 } : {})}
        />
      )}
    </span>
  );
}

const BLANK: Omit<Product, "_id" | "sortOrder"> = {
  slug: "",
  name: "",
  description: "",
  shape: "almond",
  finish: "gloss",
  occasion: "everyday",
  color: "#E8B2AA",
  pricePaise: 99900,
  stock: 0,
  images: [],
  active: true,
};

function ProductForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Product | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState(() => (initial ? { ...initial } : { ...BLANK }));
  const [price, setPrice] = useState(rupeesInput(p.pricePaise));
  const [msg, setMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const pricePaise = parseRupees(price);
      if (pricePaise === null) throw new Error("Enter a valid price");
      const body = {
        slug: p.slug,
        name: p.name,
        description: p.description,
        shape: p.shape,
        finish: p.finish,
        occasion: p.occasion,
        color: p.color,
        color2: p.color2 ?? "",
        pricePaise,
        images: p.images,
        active: p.active,
        ...(initial ? {} : { stock: p.stock }),
      };
      return initial ? api.patch(`/products/${initial._id}`, body) : api.post("/products", body);
    },
    onSuccess: onSaved,
    onError: (err) => setMsg(err instanceof Error && !("status" in err) ? err.message : errorText(err)),
  });

  async function addImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      const { url } = await api.upload(file, "image");
      set("images", [...p.images, { url, alt: p.name }]);
    } catch (err) {
      setMsg(errorText(err));
    } finally {
      setUploading(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    save.mutate();
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{initial ? `Edit ${initial.name}` : "New set"}</h2>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ width: 220 }}>
          <NailArt
            shape={p.shape}
            finish={p.finish}
            color={p.color}
            {...(p.color2 ? { color2: p.color2 } : {})}
            label="Preview"
          />
        </div>
        <p className="note" style={{ maxWidth: "32ch" }}>
          The drawn set is used whenever there is no photo, and always for small thumbnails.
        </p>
      </div>
      <div className="grid2">
        <Field label="Name">
          {(id) => <input id={id} value={p.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label="Web address" hint="Lowercase words with dashes, e.g. rose-chrome">
          {(id) => (
            <input
              id={id}
              value={p.slug}
              onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            />
          )}
        </Field>
      </div>
      <Field label="Description">
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={p.description}
            onChange={(e) => set("description", e.target.value)}
          />
        )}
      </Field>
      <div className="grid2">
        <Field label="Shape">
          {(id) => (
            <select
              id={id}
              value={p.shape}
              onChange={(e) => set("shape", e.target.value as Product["shape"])}
            >
              {NAIL_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Finish">
          {(id) => (
            <select
              id={id}
              value={p.finish}
              onChange={(e) => set("finish", e.target.value as Product["finish"])}
            >
              {NAIL_FINISHES.map((f) => (
                <option key={f} value={f}>
                  {FINISH_LABELS[f]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Occasion">
          {(id) => (
            <select
              id={id}
              value={p.occasion}
              onChange={(e) => set("occasion", e.target.value as Product["occasion"])}
            >
              {OCCASIONS.map((o) => (
                <option key={o} value={o}>
                  {OCCASION_LABELS[o]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Price (₹)">
          {(id) => (
            <input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          )}
        </Field>
        <Field label="Colour">
          {(id) => (
            <input
              id={id}
              type="color"
              value={p.color}
              onChange={(e) => set("color", e.target.value.toUpperCase())}
            />
          )}
        </Field>
        <Field label="Second colour (ombre tip)">
          {(id) => (
            <div className="row">
              <input
                id={id}
                type="color"
                value={p.color2 ?? "#FFFFFF"}
                onChange={(e) => set("color2", e.target.value.toUpperCase())}
              />
              {p.color2 && (
                <button className="tlink" type="button" onClick={() => set("color2", undefined)}>
                  Clear
                </button>
              )}
            </div>
          )}
        </Field>
        {!initial && (
          <Field label="Starting stock">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                value={p.stock}
                onChange={(e) => set("stock", Math.max(0, Number(e.target.value)))}
              />
            )}
          </Field>
        )}
      </div>
      <div className="stack">
        <div className="lbl">Photos</div>
        <div className="imgs">
          {p.images.map((img, i) => (
            <figure key={img.url}>
              <img src={img.url} alt={img.alt} />
              <button
                className="tlink"
                type="button"
                onClick={() =>
                  set(
                    "images",
                    p.images.filter((_, k) => k !== i),
                  )
                }
              >
                Remove
              </button>
            </figure>
          ))}
        </div>
        <label className="check">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => void addImage(e.target.files?.[0])}
          />
          {uploading ? "Uploading…" : "JPEG, PNG or WebP, up to 5 MB"}
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={p.active} onChange={(e) => set("active", e.target.checked)} />
        Show in the shop
      </label>
      <Message>{msg}</Message>
      <div className="row">
        <button className="btn sm" type="submit" disabled={save.isPending || uploading}>
          Save
        </button>
        <button className="btn sm ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function StockCell({ p }: { p: Product }) {
  const qc = useQueryClient();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const adjust = useMutation({
    mutationFn: () => api.post(`/products/${p._id}/stock`, { delta: Number(delta), reason }),
    onSuccess: () => {
      setDelta("");
      setReason("");
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <div className="row" style={{ gap: 6 }}>
      <b style={{ minWidth: 28 }}>{p.stock}</b>
      <input
        aria-label={`Stock change for ${p.name}`}
        style={{ width: 64 }}
        placeholder="+/-"
        inputMode="numeric"
        value={delta}
        onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ""))}
      />
      <input
        aria-label="Reason"
        style={{ width: 130 }}
        placeholder="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        className="btn xs ghost"
        type="button"
        disabled={!delta || delta === "-" || reason.trim().length < 2 || adjust.isPending}
        onClick={() => adjust.mutate()}
      >
        Apply
      </button>
      {err && (
        <span className="note" style={{ color: "var(--err)" }}>
          {err}
        </span>
      )}
    </div>
  );
}

export function ProductsPage() {
  const owner = useIsOwner();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["products"], queryFn: () => api.get<Product[]>("/products") });
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post<Product[]>("/products/reorder", { ids }),
    onSuccess: (list) => qc.setQueryData(["products"], list),
  });

  function move(index: number, dir: -1 | 1) {
    const ids = (q.data ?? []).map((p) => p._id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    reorder.mutate(ids);
  }

  const done = () => {
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <>
      <PageHead title="Products">
        {owner && !editing && (
          <button className="btn sm" type="button" onClick={() => setEditing("new")}>
            New set
          </button>
        )}
      </PageHead>
      {editing && (
        <ProductForm
          key={editing === "new" ? "new" : editing._id}
          initial={editing === "new" ? null : editing}
          onSaved={done}
          onCancel={() => setEditing(null)}
        />
      )}
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr>
              <th />
              <th>Set</th>
              <th className="num">Price</th>
              <th>Stock</th>
              <th>Shop</th>
              {owner && <th>Order</th>}
            </tr>
          </thead>
          <tbody>
            {q.data?.map((p, i) => (
              <tr key={p._id}>
                <td>
                  <Thumb p={p} />
                </td>
                <td>
                  {owner ? (
                    <button
                      className="tlink"
                      type="button"
                      onClick={() => setEditing(p)}
                      style={{ color: "var(--fg)" }}
                    >
                      {p.name}
                    </button>
                  ) : (
                    p.name
                  )}
                  <div className="note">
                    {label(p.shape)} &middot; {FINISH_LABELS[p.finish]} &middot; {OCCASION_LABELS[p.occasion]}
                  </div>
                </td>
                <td className="num">{formatINR(p.pricePaise)}</td>
                <td>
                  <StockCell p={p} />
                </td>
                <td>
                  {p.active ? (
                    <span className="chip-s good">Shown</span>
                  ) : (
                    <span className="chip-s muted">Hidden</span>
                  )}
                </td>
                {owner && (
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        className="sq prev up"
                        type="button"
                        aria-label={`Move ${p.name} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      />
                      <button
                        className="sq next down"
                        type="button"
                        aria-label={`Move ${p.name} down`}
                        disabled={i === (q.data?.length ?? 0) - 1}
                        onClick={() => move(i, 1)}
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
