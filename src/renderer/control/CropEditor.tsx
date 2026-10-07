import { useEffect, useRef, useState } from 'react';
import { normalizeCrop, placeImage, type Box, type CropRect } from '@shared/geometry';

const api = window.projectorDesk;

/** Low-rate capture of the source currently on the projector (main grants the same source). */
export function useProjectedStream(active: boolean, token: number, maxW: number, maxH: number) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getDisplayMedia({
        video: { frameRate: { max: 10 }, width: { max: maxW }, height: { max: maxH } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        stream = s;
        el.srcObject = s;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (stream) for (const t of stream.getTracks()) t.stop();
      el.srcObject = null;
    };
  }, [active, token, maxW, maxH]);
  return ref;
}

/** Where the video's picture actually is inside its (object-fit: contain) element. */
export function useContentBox(ref: React.RefObject<HTMLVideoElement | null>): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setBox(
        el.videoWidth > 0
          ? placeImage(el.videoWidth, el.videoHeight, el.clientWidth, el.clientHeight, 'fit')
          : null,
      );
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('loadedmetadata', update);
    el.addEventListener('resize', update);
    update();
    return () => {
      ro.disconnect();
      el.removeEventListener('loadedmetadata', update);
      el.removeEventListener('resize', update);
    };
  }, [ref]);
  return box;
}

/** Outline of a crop on top of a contain-fitted video; outside is dimmed. */
export function CropOutline({ box, crop }: { box: Box; crop: CropRect }) {
  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      <div
        className="absolute border-2 border-sky-400"
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.width * 100}%`,
          height: `${crop.height * 100}%`,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
        }}
      />
    </div>
  );
}

export function CropEditor({
  token,
  crop,
  onClose,
}: {
  token: number;
  crop: CropRect | null;
  onClose: () => void;
}) {
  const videoRef = useProjectedStream(true, token, 1280, 720);
  const box = useContentBox(videoRef);
  const [draft, setDraft] = useState<CropRect | null>(crop);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const toNorm = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    };
  };

  const apply = async (c: CropRect | null) => {
    await api.setCrop(c);
    onClose();
  };

  const shown = draft ? normalizeCrop(draft) : null;

  return (
    <div
      role="dialog"
      aria-label="Crop"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6"
    >
      <p className="text-sm text-slate-300">
        Drag over the picture to choose what the projector shows. The crop keeps its shape and is
        placed using the current fill mode.
      </p>
      <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-md bg-black ring-1 ring-slate-700">
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
        {box && (
          <div
            className="absolute cursor-crosshair touch-none"
            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = toNorm(e);
              drag.current = p;
              setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
            }}
            onPointerMove={(e) => {
              const start = drag.current;
              if (!start) return;
              const p = toNorm(e);
              setDraft({ x: start.x, y: start.y, width: p.x - start.x, height: p.y - start.y });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
        )}
        {box && shown && <CropOutline box={box} crop={shown} />}
        {!box && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            Waiting for the picture…
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          disabled={!shown}
          onClick={() => void apply(shown)}
        >
          Apply crop
        </button>
        <button
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm ring-1 ring-slate-700 hover:bg-slate-700"
          onClick={() => void apply(null)}
        >
          Whole frame
        </button>
        <button
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm ring-1 ring-slate-700 hover:bg-slate-700"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
