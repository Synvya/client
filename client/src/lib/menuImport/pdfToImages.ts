import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

// Use the bundled worker from pdfjs-dist
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

/**
 * Renders each page of a PDF to a JPEG base64 string.
 * Returns an array of base64-encoded images (without the data URI prefix).
 */
export async function pdfToImages(
  file: File,
  opts: { scale?: number; quality?: number } = {},
): Promise<string[]> {
  const { scale = 1.5, quality = 0.8 } = opts;

  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;

  const images: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas 2d context");

    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

    // Use JPEG for smaller size
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    // Strip the "data:image/jpeg;base64," prefix
    const base64 = dataUrl.split(",")[1];
    images.push(base64);

    // Clean up
    page.cleanup();
  }

  return images;
}
