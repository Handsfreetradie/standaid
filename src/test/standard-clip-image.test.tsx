import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { StandardClipImage } from "../components/StandardClipImage";

// Regression coverage for the "don't fetch the PDF until the user asks"
// change: previously every cited table/figure loaded and rendered
// automatically, which pulled PDF bytes for citations most users never open.

vi.mock("@/lib/pdfDocCache", () => ({
  getPdfDoc: vi.fn(),
}));
vi.mock("@/lib/pdf-text", () => ({
  assemblePositionedLines: vi.fn(() => []),
  findLabelLine: vi.fn(() => -1),
  computeCropRect: vi.fn(() => null),
}));

import { getPdfDoc } from "@/lib/pdfDocCache";

function makeFakePage() {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      convertToViewportRectangle: (r: number[]) => r,
    }),
    getTextContent: async () => ({ items: [] }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
}

function makeFakeDoc() {
  return { numPages: 500, getPage: vi.fn(async () => makeFakePage()) };
}

describe("StandardClipImage — lazy load", () => {
  beforeEach(() => {
    vi.mocked(getPdfDoc).mockReset();
    // jsdom has no real canvas backend; the component only needs a context
    // object it can call fillRect-style methods on without throwing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({}));
  });
  afterEach(cleanup);

  it("does not touch the PDF until the user taps View", () => {
    const doc = makeFakeDoc();
    vi.mocked(getPdfDoc).mockResolvedValue(doc);

    render(
      <StandardClipImage
        standardId="std-1"
        kind="Table"
        refNumber="3"
        caption="Current ratings"
        pageNumber={42}
        onOpenFull={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /View Table 3/i })).toBeInTheDocument();
    expect(getPdfDoc).not.toHaveBeenCalled();
  });

  it("fetches and renders only after the View button is tapped", async () => {
    const doc = makeFakeDoc();
    vi.mocked(getPdfDoc).mockResolvedValue(doc);

    render(
      <StandardClipImage
        standardId="std-1"
        kind="Figure"
        refNumber="2.3"
        pageNumber={7}
        onOpenFull={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /View Figure 2.3/i }));

    await waitFor(() => expect(getPdfDoc).toHaveBeenCalledWith("std-1"));
    await waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(7));
    // Once rendered, the surface becomes "open the full page" — the crop
    // preview and the full-PDF open are two distinct actions.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Open Figure 2.3/i })).toBeInTheDocument(),
    );
  });

  it("falls back to an Open button (not a retry loop) when loading fails", async () => {
    vi.mocked(getPdfDoc).mockRejectedValue(new Error("network down"));
    const onOpenFull = vi.fn();

    render(
      <StandardClipImage
        standardId="std-1"
        kind="Table"
        refNumber="5.1"
        pageNumber={12}
        onOpenFull={onOpenFull}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /View Table 5.1/i }));

    const openButton = await screen.findByRole("button", { name: /Open Table 5.1/i });
    fireEvent.click(openButton);
    expect(onOpenFull).toHaveBeenCalledTimes(1);
  });

  it("can be closed back to the View prompt after it's shown", async () => {
    const doc = makeFakeDoc();
    vi.mocked(getPdfDoc).mockResolvedValue(doc);

    render(
      <StandardClipImage
        standardId="std-1"
        kind="Table"
        refNumber="3"
        pageNumber={42}
        onOpenFull={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /View Table 3/i }));
    await waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(42));
    await screen.findByRole("button", { name: /Open Table 3/i });

    fireEvent.click(screen.getByRole("button", { name: /Hide Table 3/i }));

    expect(screen.getByRole("button", { name: /View Table 3/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Table 3/i })).not.toBeInTheDocument();
  });

  it("resets to collapsed (and re-fetches) if the cited page changes under it", async () => {
    const doc = makeFakeDoc();
    vi.mocked(getPdfDoc).mockResolvedValue(doc);

    const { rerender } = render(
      <StandardClipImage
        standardId="std-1"
        kind="Table"
        refNumber="3"
        pageNumber={42}
        onOpenFull={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /View Table 3/i }));
    await waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(42));

    rerender(
      <StandardClipImage
        standardId="std-1"
        kind="Table"
        refNumber="3"
        pageNumber={99}
        onOpenFull={() => {}}
      />,
    );

    // Back to the collapsed prompt for the new page — not stuck showing the
    // old page's crop under the new caption.
    expect(screen.getByRole("button", { name: /View Table 3/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /View Table 3/i }));
    await waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(99));
  });
});
