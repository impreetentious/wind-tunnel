/**
 * @spec §15 M-12 PNG/slide exports.
 *
 * A tiny helper that serializes an inline `<svg>` element to a Blob suitable
 * for download. Renders via an Image → Canvas pipeline so the output stays
 * pixel-accurate at any DPR without pulling in an external SVG-to-PNG library
 * (ledger D-42: keeps the production dependency budget at 7).
 *
 * The functions in this module rely on `Image`, `URL.createObjectURL`, and
 * `HTMLCanvasElement.toBlob` — i.e., they only work in a browser. Callers are
 * responsible for guarding SSR paths; there is no jsdom test coverage for the
 * PNG pipeline because jsdom does not implement canvas image decoding. The
 * pure `serializeSvgElement` helper is testable in isolation and is what most
 * of the download flow leans on.
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * Serialize an SVG element to a UTF-8 XML string. Injects the XML declaration
 * and, when absent, the SVG namespace attribute — otherwise Blob URLs of the
 * output display as raw markup in some browsers.
 */
export function serializeSvgElement(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("xmlns:xlink"))
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const markup = new XMLSerializer().serializeToString(clone);
  return `${XML_HEADER}\n${markup}`;
}

export interface SvgToPngOptions {
  /** Device-pixel-ratio scaling factor (default 2 for retina crispness). */
  scale?: number;
  /** Optional background color; defaults to transparent. */
  background?: string;
  /** Canvas pixel dimensions; defaults to the SVG's own `viewBox` size. */
  width?: number;
  height?: number;
}

function svgSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 600, height: rect.height || 400 };
}

/**
 * Rasterize an SVG element to a PNG Blob at the given scale. Rejects if the
 * browser cannot decode the SVG (mostly a foreignObject-with-cross-origin
 * concern), if canvas contexts are unavailable, or if `toBlob` returns null.
 * Browser-only: `document`, `Image`, and `URL` must exist.
 */
export function svgElementToPngBlob(
  svg: SVGSVGElement,
  options: SvgToPngOptions = {},
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined" || typeof Image === "undefined") {
      reject(new Error("PNG export requires a browser environment."));
      return;
    }
    const scale = options.scale ?? 2;
    const { width: fallbackW, height: fallbackH } = svgSize(svg);
    const width = options.width ?? fallbackW;
    const height = options.height ?? fallbackH;

    const markup = serializeSvgElement(svg);
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error("2D canvas context is unavailable."));
          return;
        }
        if (options.background) {
          context.fillStyle = options.background;
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((result) => {
          URL.revokeObjectURL(url);
          if (!result) {
            reject(new Error("Canvas failed to encode a PNG."));
            return;
          }
          resolve(result);
        }, "image/png");
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Browser could not decode the SVG for PNG export."));
    };
    image.src = url;
  });
}

/**
 * Trigger a download of a Blob under the given filename. Uses a hidden anchor
 * that we remove after the click — the same pattern used elsewhere in the app
 * for the JSON export.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") {
    throw new Error("Downloads require a browser environment.");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Delay the revoke so slower browsers actually flush the download.
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

/**
 * A minimal HTML slide-bundle exporter. Produces a single self-contained HTML
 * page (no assets) with the given title, a caption, and any inline SVG markup
 * from the app. The output loads in any browser and prints cleanly to PDF via
 * the built-in print dialog — the M-12 "slide export" is deliberately a
 * static bundle so it stays inside the dependency cap.
 */
export function renderSlideBundle(input: {
  title: string;
  caption?: string;
  slides: readonly { heading: string; svgMarkup: string; note?: string }[];
}): string {
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (character) => {
      switch (character) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  const slides = input.slides
    .map(
      (slide) =>
        `<section class="slide"><h2>${escape(slide.heading)}</h2><div class="art">${slide.svgMarkup}</div>${slide.note ? `<p class="note">${escape(slide.note)}</p>` : ""}</section>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(input.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, sans-serif; background: white; color: #111; }
  header { padding: 32px; border-bottom: 1px solid #ddd; }
  .slide { padding: 32px; page-break-after: always; }
  .slide h2 { margin: 0 0 16px; font-size: 20px; }
  .slide .art { max-width: 100%; }
  .slide .note { font-size: 14px; color: #555; margin-top: 16px; }
  @media print { header { page-break-after: always; } }
</style>
</head>
<body>
<header>
  <h1>${escape(input.title)}</h1>
  ${input.caption ? `<p>${escape(input.caption)}</p>` : ""}
</header>
${slides}
</body>
</html>`;
}
