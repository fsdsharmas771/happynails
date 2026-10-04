import { useEffect } from "react";
import { SEO } from "../config/content";

function setMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * Sets the page title and description (and their social-sharing twins) while a view is shown,
 * restoring the site defaults afterwards.
 */
export function useDocumentMeta(meta: { title?: string | undefined; description?: string | undefined } = {}) {
  const title = meta.title ?? SEO.title;
  const description = meta.description ?? SEO.description;
  useEffect(() => {
    document.title = title;
    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    return () => {
      document.title = SEO.title;
      setMeta('meta[name="description"]', "name", "description", SEO.description);
      setMeta('meta[property="og:title"]', "property", "og:title", SEO.title);
      setMeta('meta[property="og:description"]', "property", "og:description", SEO.description);
    };
  }, [title, description]);
}
