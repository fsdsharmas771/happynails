import { useTheme } from "@happynails/ui";
import { SITE } from "../config/site";
import { SectionLink } from "./Nav";

export function Footer() {
  const { toggle } = useTheme();
  return (
    <footer>
      <div className="wrap">
        <div className="foot">
          <div>
            <p className="big">
              Happy hands, <em>happy days.</em>
            </p>
          </div>
          <div>
            <h4>Shop</h4>
            <ul>
              <li>
                <SectionLink to="shop">Collection</SectionLink>
              </li>
              <li>
                <SectionLink to="fit">Find your size</SectionLink>
              </li>
              <li>
                <SectionLink to="faq">Shipping</SectionLink>
              </li>
            </ul>
          </div>
          <div>
            <h4>Visit</h4>
            <ul>
              {SITE.visitCities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Talk to us</h4>
            <ul>
              <li>WhatsApp {SITE.contact.whatsappDisplay}</li>
              <li>Instagram {SITE.contact.instagramHandle}</li>
            </ul>
          </div>
        </div>
        <div className="legal">
          <span>
            {SITE.name} {SITE.byline}.
          </span>
          <button className="tlink" type="button" onClick={toggle}>
            Switch theme
          </button>
        </div>
      </div>
    </footer>
  );
}

export function MobileBar() {
  return (
    <div className="mbar">
      {/* Opens the bag drawer once the cart lands in phase 4. */}
      <button className="btn ghost" type="button">
        Bag
      </button>
      <SectionLink to="book" className="btn">
        Book a visit
      </SectionLink>
    </div>
  );
}
