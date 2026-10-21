import { useEffect } from "react";
import { FaTimes } from "react-icons/fa";

// A simple modal frame (Escape and the backdrop close it)
const Modal = ({ title, onClose, children, footer, wide = false }) => {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-xl" : "max-w-md"} max-h-[92vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
            <FaTimes />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

export default Modal;
