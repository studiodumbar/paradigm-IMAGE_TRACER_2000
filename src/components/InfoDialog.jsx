import { useRef } from "react";
import { releases } from "../lib/releases.js";
import { IconClose, IconInfo } from "./icons.jsx";

export default function InfoDialog() {
  const dialogRef = useRef(null);

  return (
    <>
      <button
        className="icon-button"
        type="button"
        aria-label="About and updates"
        aria-haspopup="dialog"
        aria-controls="info-dialog"
        title="About and updates"
        onClick={() => dialogRef.current.showModal()}
      ><IconInfo /></button>
      <dialog className="info-dialog" id="info-dialog" ref={dialogRef} aria-labelledby="info-title">
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
      </dialog>
    </>
  );
}
