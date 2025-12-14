import { describe, expect, it } from "vitest";
import { buildStoredZip, renderSlideBundle, serializeSvgElement } from "./svg-export";

function makeSvg(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 100 50");
  const rect = document.createElementNS(namespace, "rect");
  rect.setAttribute("width", "10");
  rect.setAttribute("height", "10");
  svg.appendChild(rect);
  return svg;
}

describe("SVG export helpers (M-12)", () => {
  it("serializes an SVG element with declared namespaces and an XML prolog", () => {
    const svg = makeSvg();
    const markup = serializeSvgElement(svg);
    expect(markup).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(markup).toContain("<rect");
  });

  it("does not mutate the input element (clones before adding namespaces)", () => {
    const svg = makeSvg();
    serializeSvgElement(svg);
    // xmlns is deliberately not on the source; the clone gets it, the source stays untouched.
    expect(svg.getAttribute("xmlns")).toBeNull();
    expect(svg.getAttribute("xmlns:xlink")).toBeNull();
  });

  it("renderSlideBundle produces a self-contained HTML page with escaped titles", () => {
    const html = renderSlideBundle({
      title: "Q1 <plan>",
      caption: `Owner: "A&B"`,
      slides: [{ heading: "MRR trajectory", svgMarkup: "<svg />", note: "Baseline" }],
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Q1 &lt;plan&gt;");
    expect(html).toContain("&quot;A&amp;B&quot;");
    expect(html).toContain("MRR trajectory");
    expect(html).toContain("<svg />");
    // No external hrefs — sanity check for the privacy scan.
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("renders a zero-slide bundle without throwing", () => {
    const html = renderSlideBundle({ title: "Empty", slides: [] });
    expect(html).toContain("<title>Empty</title>");
  });

  it("packages slide images and their index as a real ZIP archive", () => {
    const zip = buildStoredZip([
      { name: "slide-01.png", data: new Uint8Array([1, 2, 3, 4]) },
      { name: "index.html", data: new TextEncoder().encode("<h1>Deck</h1>") },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const binaryText = new TextDecoder("latin1").decode(zip);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(binaryText).toContain("slide-01.png");
    expect(binaryText).toContain("index.html");
  });
});
