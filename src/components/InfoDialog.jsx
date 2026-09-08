import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { releases } from "../lib/releases.js";
import { IconClose, IconInfo } from "./icons.jsx";

export default function InfoDialog() {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key !== "Escape" || !dialogRef.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      dialogRef.current.close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        className="icon-button"
        ref={triggerRef}
        type="button"
        aria-label="About and updates"
        aria-haspopup="dialog"
        aria-controls="info-dialog"
        aria-expanded={open}
        title="About and updates"
        onClick={() => {
          if (dialogRef.current.open) dialogRef.current.close();
          else { dialogRef.current.show(); setOpen(true); }
        }}
      ><IconInfo /></button>
      {createPortal(<dialog className="info-dialog" id="info-dialog" ref={dialogRef} aria-labelledby="info-title" onClose={() => {
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }}>
        <header className="info-header">
          <h2 id="info-title">IMAGE TRACER 2000</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close info window"
            autoFocus
            onClick={() => dialogRef.current.close()}
          ><IconClose /></button>
        </header>
        <div className="info-body" tabIndex={0} role="region" aria-label="About and version history">
          <p className="info-intro">Imagine if Image Tracer from Illustrator and Posterize Filter from Photoshop had a baby. This is that.</p>
          <section className="info-updates" aria-labelledby="updates-title">
            <h3 id="updates-title">Updates</h3>
            {releases.map(release => (
              <article className="info-release" key={release.version}>
                <h4>{release.version}</h4>
                <ul>
                  {release.updates.map(update => <li key={update}>{update}</li>)}
                </ul>
              </article>
            ))}
          </section>
        </div>
      </dialog>, document.body)}
    </>
  );
}
