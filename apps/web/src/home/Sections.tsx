import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicTestimonial } from "@happynails/shared";
import { NailArt } from "@happynails/ui";
import { BEFORE_AFTER, FAQ, PROMISES } from "../config/content";
import { SITE } from "../config/site";
import { api } from "../lib/api";
import { useDialog } from "../lib/useDialog";
import { useReveal } from "../lib/useReveal";
import "./content.css";

/** Published testimonials; shared by the Stories section and the nav link to it. */
export function useTestimonials() {
  return useQuery({ queryKey: ["testimonials"], queryFn: api.testimonials, staleTime: 5 * 60_000 });
}

function StoryLightbox({ story, onClose }: { story: PublicTestimonial; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(true, ref, onClose);
  const who = [story.name, story.city, story.setName].filter(Boolean).join(" · ");
  return (
    <div
      className="lightbox"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`${story.name}'s story`}
      tabIndex={-1}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="lb">
        {story.videoUrl ? (
          // Sound is allowed because the visitor pressed play; controls let them pause or mute.
          <video src={story.videoUrl} poster={story.posterUrl || undefined} controls autoPlay playsInline />
        ) : (
          story.posterUrl && <img src={story.posterUrl} alt="" />
        )}
        {!story.videoUrl && story.quote && <p className="tx">{story.quote}</p>}
        <div className="who">{who}</div>
        <button className="x" type="button" aria-label="Close story" onClick={onClose} />
      </div>
    </div>
  );
}

/** Real client stories only. With none published, the section is not rendered at all. */
export function Stories() {
  const stories = useTestimonials();
  const [open, setOpen] = useState<PublicTestimonial | null>(null);
  const headRef = useReveal<HTMLDivElement>();
  const list = stories.data ?? [];
  if (!list.length) return null;

  return (
    <section className="sec" id="stories" aria-labelledby="stH">
      <div className="sec-head rv" ref={headRef}>
        <div>
          <p className="eyebrow">Stories</p>
          <h2 className="h2" id="stH">
            Hear it from <em>her hands</em>
          </h2>
        </div>
        <p className="sub">Short videos and notes from clients, shared with their permission.</p>
      </div>
      <div className="reel" tabIndex={0} aria-label="Client stories, scroll sideways">
        {list.map((s) => (
          <button
            key={s.id}
            className="vid"
            type="button"
            aria-label={`${s.videoUrl ? "Play" : "Read"} ${s.name}'s story`}
            onClick={() => setOpen(s)}
          >
            <span className="poster">
              {s.posterUrl && <img src={s.posterUrl} alt="" loading="lazy" decoding="async" />}
            </span>
            {!s.posterUrl && s.quote && <span className="quote">&ldquo;{s.quote}&rdquo;</span>}
            {s.videoUrl && <span className="play" aria-hidden="true" />}
            <span className="cap">
              <b>{s.name}</b>
              <span>{[s.city, s.setName].filter(Boolean).join(" · ")}</span>
            </span>
          </button>
        ))}
      </div>
      {open && <StoryLightbox story={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

export function BeforeAfter() {
  const [p, setP] = useState(50);
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="sec" aria-labelledby="baH">
      <div className="ba rv" ref={ref}>
        <div className="ba-box" style={{ ["--p" as string]: `${p}%` }}>
          <NailArt shape="almond" finish="french" color="#EBCFC4" label="After: gold leaf french set" />
          <div className="before">
            <NailArt shape="square" finish="matte" color="#E8D3C8" bare label="Before: natural short nails" />
          </div>
          <div className="handle" />
          <span className="lab a">Before</span>
          <span className="lab b">After</span>
          <input
            type="range"
            min={2}
            max={98}
            value={p}
            aria-label="Drag to compare before and after"
            onChange={(e) => setP(Number(e.target.value))}
          />
        </div>
        <div className="ba-copy">
          <p className="eyebrow">Before and after</p>
          <h2 className="h2" id="baH">
            Short, uneven, <em>done.</em>
          </h2>
          <p>{BEFORE_AFTER.body}</p>
        </div>
      </div>
    </section>
  );
}

export function Promises() {
  const head = useReveal<HTMLDivElement>();
  const body = useReveal<HTMLDivElement>();
  return (
    <section className="sec" aria-labelledby="prH">
      <div className="sec-head rv" ref={head}>
        <div>
          <p className="eyebrow">Our promises</p>
          <h2 className="h2" id="prH">
            Small details that <em>earn trust</em>
          </h2>
        </div>
      </div>
      <div className="prom rv" ref={body}>
        {PROMISES.map((p) => (
          <div key={p.title}>
            <span className="dot" aria-hidden="true" />
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Faq() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="sec" id="faq" aria-labelledby="fqH">
      <div className="faq rv" ref={ref}>
        <div className="faq-intro">
          <p className="eyebrow">Questions</p>
          <h2 className="h2" id="fqH">
            Before you <em>order</em>
          </h2>
          <p>
            Cannot find your answer? Message us on WhatsApp ({SITE.contact.whatsappDisplay}) and a real person
            replies.
          </p>
        </div>
        <div>
          {FAQ.map((f, i) => (
            <details key={f.q} open={i === 0}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
