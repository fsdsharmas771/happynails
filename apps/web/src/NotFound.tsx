import { Link } from "react-router";

export function NotFound() {
  return (
    <section className="sec" aria-labelledby="nfH">
      <div className="sec-head">
        <div>
          <p className="eyebrow">Not found</p>
          <h1 className="h2" id="nfH">
            This page has <em>wandered off.</em>
          </h1>
        </div>
      </div>
      <div>
        <Link className="btn" to="/">
          Back to the collection <span className="arrow" />
        </Link>
      </div>
    </section>
  );
}
