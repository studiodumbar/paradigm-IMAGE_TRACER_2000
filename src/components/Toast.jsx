import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../store/useAppStore.js";

function ToastMessage({ toast }) {
  useEffect(() => {
    const timer = setTimeout(() => useAppStore.getState().dismissToast(toast.id), 1800);
    return () => clearTimeout(timer);
  }, [toast.id]);

  return <div className="toast">{toast.message}</div>;
}

export default function Toast({ children }) {
  const toasts = useAppStore(state => state.toasts);

  return createPortal(
    <div className="canvas-feedback-stack">
      {children}
      <div className="toast-list" role="status" aria-live="polite" aria-relevant="additions" aria-atomic="false">
        {toasts.map(toast => <ToastMessage key={toast.id} toast={toast} />)}
      </div>
    </div>,
    document.body
  );
}
