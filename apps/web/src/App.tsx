import { useApiHealth } from "./useApiHealth";

export function App() {
  const health = useApiHealth();

  return (
    <main className="boot">
      <span className="mono" aria-hidden="true">
        HN
      </span>
      <p className="eyebrow">Storefront</p>
      <h1>Happy Nails</h1>
      <ul className="status" aria-live="polite">
        {health.state === "loading" && <li>Checking the API</li>}
        {health.state === "unreachable" && (
          <li>
            <span className="dot" data-s="down" />
            API unreachable
          </li>
        )}
        {health.state === "ready" &&
          (["mongo", "redis"] as const).map((dep) => (
            <li key={dep}>
              <span className="dot" data-s={health.body.checks[dep]} />
              {dep === "mongo" ? "MongoDB" : "Redis"} {health.body.checks[dep]}
            </li>
          ))}
      </ul>
    </main>
  );
}
