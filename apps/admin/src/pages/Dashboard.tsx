import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Chip, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { formatINR, timeOnly, when } from "../lib/format";
import type { Dashboard } from "../lib/types";

export function DashboardPage() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dashboard>("/dashboard"),
    refetchInterval: 60_000,
  });
  const d = q.data;

  return (
    <>
      <PageHead title="Today" />
      {q.isError && <p className="msg no">The dashboard could not be loaded.</p>}
      {d && (
        <>
          <div className="cards">
            <div className="stat">
              <span className="lbl">Visits today</span>
              <b>{d.visits.length}</b>
            </div>
            <Link className="stat" to="/orders?status=placed" style={{ textDecoration: "none" }}>
              <span className="lbl">Orders to pack</span>
              <b>{d.ordersToPack.count}</b>
            </Link>
            <div className="stat">
              <span className="lbl">Revenue this month</span>
              <b>{formatINR(d.revenueThisMonthPaise)}</b>
              <span className="note">Online payments and visits paid, less refunds</span>
            </div>
            <div className={`stat${d.needsRefund ? " alert" : ""}`}>
              <span className="lbl">Need a refund</span>
              <b>{d.needsRefund}</b>
              <span className="note">Cancelled but paid online</span>
            </div>
          </div>

          <section className="stack">
            <h2 className="lbl">Today&rsquo;s visits</h2>
            <div className="tablewrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Customer</th>
                    <th>Service</th>
                    <th>City</th>
                    <th>Technician</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {d.visits.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty-row">
                        No visits today.
                      </td>
                    </tr>
                  )}
                  {d.visits.map((v) => (
                    <tr key={v.id} className="click" onClick={() => navigate(`/bookings?open=${v.id}`)}>
                      <td>{timeOnly(v.startsAt)}</td>
                      <td>{v.customerName}</td>
                      <td>{v.serviceName}</td>
                      <td>{v.city}</td>
                      <td>{v.technician}</td>
                      <td>
                        <Chip value={v.paymentStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {d.ordersToPack.oldest.length > 0 && (
            <section className="stack">
              <h2 className="lbl">Oldest orders to pack</h2>
              <div className="tablewrap">
                <table className="t">
                  <tbody>
                    {d.ordersToPack.oldest.map((o) => (
                      <tr key={o._id} className="click" onClick={() => navigate(`/orders/${o._id}`)}>
                        <td>{o.number}</td>
                        <td>{o.customer.name}</td>
                        <td>{when(o.createdAt)}</td>
                        <td className="num">{formatINR(o.totalPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
