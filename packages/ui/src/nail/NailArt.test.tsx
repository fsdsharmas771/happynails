import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NAIL_FINISHES } from "@happynails/shared";
import { NailArt } from "./NailArt";

describe("NailArt", () => {
  it.each(NAIL_FINISHES)("renders five nails with the %s finish", (finish) => {
    const html = renderToStaticMarkup(<NailArt shape="almond" finish={finish} color="#D49C8B" label="Set" />);
    expect(html.match(/<clipPath /g)).toHaveLength(5);
    expect(html).not.toContain("NaN");
  });

  it("gives every instance its own gradient and clip ids", () => {
    const html = renderToStaticMarkup(
      <>
        <NailArt shape="coffin" finish="chrome" color="#D49C8B" />
        <NailArt shape="coffin" finish="chrome" color="#D49C8B" />
      </>,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is an image with a name when labelled, and hidden otherwise", () => {
    expect(
      renderToStaticMarkup(<NailArt shape="oval" finish="gloss" color="#EFE6DB" label="Milk Bath" />),
    ).toContain('role="img" aria-label="Milk Bath"');
    expect(renderToStaticMarkup(<NailArt shape="oval" finish="gloss" color="#EFE6DB" />)).toContain(
      'aria-hidden="true"',
    );
  });

  it("draws short square nails without polish effects when bare", () => {
    const html = renderToStaticMarkup(<NailArt shape="stiletto" finish="glitter" color="#E8D3C8" bare />);
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("linearGradient");
  });

  it("uses color2 as the ombre tip", () => {
    const html = renderToStaticMarkup(
      <NailArt shape="almond" finish="ombre" color="#E8B2AA" color2="#F7E4DF" />,
    );
    expect(html).toContain('stop-color="#F7E4DF"');
  });
});
