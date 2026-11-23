import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Hoja inferior para acciones rápidas: se cierra tocando afuera o con Escape. */
export default function Drawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  );
}
