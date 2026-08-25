"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  alt: string;
  /** Suggested download filename, e.g. SBUX-auction-1mo.png */
  filename: string;
  /** Optional caption under the image (levels, provider, …) */
  caption?: string;
};

/**
 * Photo chart figure: scroll/pinch zoom, lightbox expand, Save PNG.
 * Used for every Underlying Analyzer chart PNG on the web app.
 */
export function ChartFigure({ src, alt, filename, caption }: Props) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const openLightbox = useCallback(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setScale(1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      openerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(4, s + 0.25));
      if (e.key === "-") setScale((s) => Math.max(1, s - 0.25));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const safeName = filename.replace(/[^\w.-]+/g, "_");

  return (
    <figure className="app-chart-figure">
      <div className="app-chart-toolbar">
        <span className="app-muted">Scroll / pinch to zoom · Expand for fullscreen</span>
        <div className="app-chart-toolbar-btns">
          <button type="button" className="app-btn app-btn-sm" onClick={openLightbox}>
            Expand
          </button>
          <a className="app-btn app-btn-sm app-btn-robinhood" href={src} download={safeName}>
            Save PNG
          </a>
        </div>
      </div>
      <div className="app-chart-zoom">
        <button
          type="button"
          className="app-chart-zoom-hit"
          onClick={openLightbox}
          aria-label={`Expand ${alt}`}
        >
          <img className="app-chart-img" alt={alt} src={src} />
        </button>
      </div>
      {caption ? <figcaption className="app-muted">{caption}</figcaption> : null}

      {open ? (
        <dialog
          ref={dialogRef}
          className="app-chart-lightbox"
          aria-label={alt}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="app-chart-lightbox-panel">
            <div className="app-chart-lightbox-bar">
              <button type="button" className="app-btn app-btn-sm" onClick={close}>
                Close
              </button>
              <span className="app-muted">{alt}</span>
              <div className="app-chart-toolbar-btns">
                <button
                  type="button"
                  className="app-btn app-btn-sm"
                  onClick={() => setScale((s) => Math.max(1, s - 0.25))}
                >
                  −
                </button>
                <button
                  type="button"
                  className="app-btn app-btn-sm"
                  onClick={() => setScale((s) => Math.min(4, s + 0.25))}
                >
                  +
                </button>
                <a className="app-btn app-btn-sm app-btn-robinhood" href={src} download={safeName}>
                  Save PNG
                </a>
              </div>
            </div>
            <div className="app-chart-lightbox-scroll">
              <img
                className="app-chart-lightbox-img"
                alt={alt}
                src={src}
                style={{ transform: `scale(${scale})` }}
              />
            </div>
            <p className="app-muted" style={{ textAlign: "center", margin: "0.5rem 0 0" }}>
              Scroll to pan · + / − to zoom · Esc to close
            </p>
          </div>
        </dialog>
      ) : null}
    </figure>
  );
}
