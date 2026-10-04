import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { useTheme } from "@happynails/ui";
import { useMe } from "./auth";
import { api } from "./lib/api";

const LINKS = [
  { to: "/", label: "Today", end: true },
  { to: "/orders", label: "Orders" },
  { to: "/bookings", label: "Bookings" },
  { to: "/products", label: "Products" },
  { to: "/technicians", label: "Technicians" },
  { to: "/services", label: "Services" },
  { to: "/testimonials", label: "Testimonials" },
];

export function Shell() {
  const me = useMe();
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();

  async function signOut() {
    await api.post("/auth/logout").catch(() => undefined);
    // Show the sign-in form, then drop everything cached from the session.
    qc.setQueryData(["me"], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="mono">HN</span>
          <span className="bn">
            Happy Nails<small>admin</small>
          </span>
        </div>
        <nav aria-label="Admin">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end ?? false}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <span>
            <b>{me.name || me.email}</b>
            <br />
            {me.role === "owner" ? "Owner" : "Staff"}
          </span>
          <div className="row">
            <button className="tlink" type="button" onClick={toggle}>
              {theme === "dark" ? "Light theme" : "Dark theme"}
            </button>
            <button className="tlink" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
