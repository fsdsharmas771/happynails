import { BUSINESS } from "@happynails/shared";
import { useTheme } from "@happynails/ui";
import { useBagDrawer } from "../cart/store";
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
              <li>
                WhatsApp or call{" "}
                <a href={SITE.contact.whatsappLink} target="_blank" rel="noopener noreferrer">
                  {SITE.contact.whatsappDisplay}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="legal">
          <span>
            &copy; {new Date().getFullYear()} {BUSINESS.legalName}. All rights reserved. {SITE.name} is a
            brand of {BUSINESS.legalName}. GSTIN {BUSINESS.gstin}.
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
  const showBag = useBagDrawer((s) => s.show);
  return (
    <div className="mbar">
      <button className="btn ghost" type="button" onClick={showBag}>
        Bag
      </button>
      <SectionLink to="book" className="btn">
        Book a visit
      </SectionLink>
    </div>
  );
}
