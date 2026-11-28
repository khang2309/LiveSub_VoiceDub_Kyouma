import React, { useEffect, useRef, useState } from 'react';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function OcrRegionSelector({ open, preview, initialRegion, onApply, onClose }) {
  const surfaceRef = useRef(null);
  const dragRef = useRef(null);
  const [region, setRegion] = useState(initialRegion || { x: 0.05, y: 0.62, width: 0.9, height: 0.34 });

  useEffect(() => {
    if (open) setRegion(initialRegion || { x: 0.05, y: 0.62, width: 0.9, height: 0.34 });
  }, [open, initialRegion]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Enter') onApply(region);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onApply, onClose, region]);

  if (!open) return null;
  const pointFromEvent = (event) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  };
  const begin = (event) => {
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = point;
    setRegion({ x: point.x, y: point.y, width: 0.01, height: 0.01 });
  };
  const move = (event) => {
    if (!dragRef.current) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const start = dragRef.current;
    setRegion({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.max(0.01, Math.abs(point.x - start.x)), height: Math.max(0.01, Math.abs(point.y - start.y)) });
  };

  return (
    <div className="ocr-region-modal" role="dialog" aria-modal="true" aria-label="Chọn vùng quét phụ đề OCR">
      <div className="ocr-region-card">
        <div className="ocr-region-heading">
          <div><strong>Chọn vùng có phụ đề video</strong><span>Kéo khung bao quanh vị trí lời thoại có thể xuất hiện.</span></div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Đóng</button>
        </div>
        <div ref={surfaceRef} className="ocr-region-surface" style={{ backgroundImage: preview ? `url(${preview})` : 'none' }} onPointerDown={begin} onPointerMove={move} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
          <div className="ocr-region-selection" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />
        </div>
        <div className="ocr-region-actions">
          <span>Khung tự ẩn hoàn toàn sau khi áp dụng.</span>
          <button type="button" className="btn btn-secondary" onClick={() => setRegion({ x: 0.05, y: 0.62, width: 0.9, height: 0.34 })}>Đặt lại</button>
          <button type="button" className="btn btn-primary" onClick={() => onApply(region)}>Áp dụng vùng quét</button>
        </div>
      </div>
    </div>
  );
}
