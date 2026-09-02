import {
  buildCaptionLines,
  type FitSummaryInput,
  type PlotExportMeta,
} from '../../../lib/kinematics/fitSummary';

export type { PlotExportMeta };

/**
 * Saves the graph as a PNG with the fit printed underneath it.
 *
 * The graph on screen is a live SVG that leans on the page for two things it
 * will not have once it is on its own: theme colours written as
 * `var(--accent-blue)`, and a font inherited from the document. A serialized
 * SVG rendered through an `<img>` gets neither — no stylesheet of the page
 * applies inside it — so an untreated clone comes out as black shapes in Times
 * New Roman on a transparent ground.
 *
 * So the clone is walked alongside the original and every colour is baked in
 * from `getComputedStyle`, which resolves the custom properties for us. That is
 * also why colours are read rather than looked up in a token table: it picks up
 * whichever theme the student is actually using, including any we add later.
 *
 * The whole thing stays same-origin — the SVG goes through a blob URL and holds
 * no external references — so the canvas is never tainted and `toBlob` works.
 */

/** Copied onto the clone so the detached SVG paints like the one on screen. */
const PAINT_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'opacity',
  'font-size',
  'font-weight',
  'text-anchor',
] as const;

const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Rendered at 2x so the text is not soft when the image is opened full size. */
const PIXEL_RATIO = 2;

const MARGIN = 20;
const TITLE_SIZE = 15;
const META_SIZE = 12;
const LINE_SIZE = 12;
const LINE_STEP = 17;

const escapeXml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Bake every painted property onto the clone. Clone and source have identical
 * trees, so one index walks both.
 */
const inlineComputedPaint = (source: SVGSVGElement, clone: SVGSVGElement) => {
  const sourceNodes = [source, ...Array.from(source.querySelectorAll<SVGElement>('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<SVGElement>('*'))];
  sourceNodes.forEach((node, index) => {
    const target = cloneNodes[index];
    if (!target) return;
    const computed = window.getComputedStyle(node);
    PAINT_PROPERTIES.forEach((property) => {
      const value = computed.getPropertyValue(property);
      // `none` on stroke is meaningful and must be kept; an empty string is not.
      if (value) target.setAttribute(property, value);
    });
    target.removeAttribute('class');
    target.removeAttribute('style');
  });
};

interface Palette {
  background: string;
  text: string;
  muted: string;
  border: string;
}

const readPalette = (): Palette => {
  const root = window.getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    root.getPropertyValue(name).trim() || fallback;
  return {
    background: token('--bg-primary', '#ffffff'),
    text: token('--text-primary', '#111827'),
    muted: token('--text-muted', '#4b5563'),
    border: token('--grid-line', '#d1d5db'),
  };
};

/** Builds the standalone SVG document: title, the graph, then the caption. */
const composeDocument = (plot: SVGSVGElement, meta: PlotExportMeta, fit: FitSummaryInput) => {
  const viewBox = plot.viewBox.baseVal;
  const plotWidth = viewBox.width || plot.clientWidth || 720;
  const plotHeight = viewBox.height || plot.clientHeight || 380;
  const palette = readPalette();
  const captions = buildCaptionLines(meta, fit);

  const clone = plot.cloneNode(true) as SVGSVGElement;
  inlineComputedPaint(plot, clone);
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.setAttribute('x', '0');
  clone.setAttribute('y', '0');
  clone.setAttribute('width', String(plotWidth));
  clone.setAttribute('height', String(plotHeight));

  const title = meta.clipName ? `Video analysis — ${meta.clipName}` : 'Video analysis';
  const headerHeight = MARGIN + TITLE_SIZE + 10;
  const captionTop = headerHeight + plotHeight + 12;
  const totalHeight = captionTop + captions.length * LINE_STEP + MARGIN;
  const width = plotWidth + MARGIN * 2;

  const captionText = captions
    .map((line, index) => {
      // The first line is the "what am I looking at" line and carries the
      // weight; everything after it is supporting detail.
      const isLead = index === 0;
      return `<text x="${MARGIN}" y="${captionTop + index * LINE_STEP}" font-size="${
        isLead ? META_SIZE : LINE_SIZE
      }" font-weight="${isLead ? 600 : 400}" fill="${isLead ? palette.text : palette.muted}">${escapeXml(line)}</text>`;
    })
    .join('');

  const serialized = new XMLSerializer().serializeToString(clone);

  return {
    width,
    height: totalHeight,
    markup:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" ` +
      `viewBox="0 0 ${width} ${totalHeight}" font-family="${FONT_STACK}">` +
      `<rect x="0" y="0" width="${width}" height="${totalHeight}" fill="${palette.background}"/>` +
      `<text x="${MARGIN}" y="${MARGIN + TITLE_SIZE - 3}" font-size="${TITLE_SIZE}" font-weight="700" fill="${palette.text}">${escapeXml(title)}</text>` +
      `<line x1="${MARGIN}" y1="${headerHeight - 4}" x2="${width - MARGIN}" y2="${headerHeight - 4}" stroke="${palette.border}" stroke-width="1"/>` +
      `<g transform="translate(${MARGIN}, ${headerHeight})">${serialized}</g>` +
      captionText +
      `</svg>`,
  };
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Render and download. Resolves to the saved file name, or throws if the
 * browser refuses to rasterise the SVG — in which case the caller should say so
 * rather than leave the button looking like it worked.
 */
export const savePlotImage = async (
  plot: SVGSVGElement,
  meta: PlotExportMeta,
  fit: FitSummaryInput,
  fileName: string,
): Promise<string> => {
  const { width, height, markup } = composeDocument(plot, meta, fit);
  const svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The browser could not render the plot.'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * PIXEL_RATIO);
    canvas.height = Math.round(height * PIXEL_RATIO);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not render the plot.');
    context.scale(PIXEL_RATIO, PIXEL_RATIO);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) throw new Error('The browser could not render the plot.');
    downloadBlob(blob, fileName);
    return fileName;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
};
