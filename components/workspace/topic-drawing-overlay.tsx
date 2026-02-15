"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { Eraser, X } from "lucide-react";
import { useAnnotationStore } from "@/hooks/use-annotation-store";

interface Point {
  x: number;
  y: number;
}

interface TopicDrawingOverlayProps {
  /** When we have a slide image, we composite drawing on top for "explain this" */
  currentSlideImage: { src: string; alt: string } | null;
  /** Call when user wants to exit draw mode (scroll, Done button) */
  onExit?: () => void;
}

/**
 * Full-size overlay on the lesson/topic area. User can draw anywhere on the topic.
 * On stroke end, we composite the drawing on top of currentSlideImage and save to annotation store.
 */
export function TopicDrawingOverlay({ currentSlideImage, onExit }: TopicDrawingOverlayProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annotationStore = useAnnotationStore();

  const [isDrawing, setIsDrawing] = useState(false);
  const pathsRef = useRef<Point[][]>([]);
  const currentPathRef = useRef<Point[]>([]);

  const syncCanvas = useCallback(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const rect = wrapper.getBoundingClientRect();
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    redraw();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255, 60, 60, 0.8)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of pathsRef.current) {
      if (path.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    syncCanvas();
    const ro = new ResizeObserver(syncCanvas);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    window.addEventListener("resize", syncCanvas);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncCanvas);
    };
  }, [syncCanvas]);

  const getPos = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent | MouseEvent | TouchEvent): Point => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return { x: 0, y: 0 };
      const rect = wrapper.getBoundingClientRect();
      let clientX: number, clientY: number;
      if ("touches" in e) {
        const touch = e.touches[0] || (e as TouchEvent).changedTouches?.[0];
        clientX = touch?.clientX ?? 0;
        clientY = touch?.clientY ?? 0;
      } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    []
  );

  const saveToStore = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hasDrawing = pathsRef.current.some((p) => p.length >= 2);
    if (!hasDrawing) return;

    const w = canvas.width;
    const h = canvas.height;

    if (currentSlideImage?.src) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const out = document.createElement("canvas");
        out.width = img.naturalWidth;
        out.height = img.naturalHeight;
        const ctx = out.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const scaleX = out.width / w;
        const scaleY = out.height / h;
        ctx.strokeStyle = "rgba(255, 60, 60, 0.9)";
        ctx.lineWidth = Math.max(2, (4 * Math.min(scaleX, scaleY)));
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const path of pathsRef.current) {
          if (path.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(path[0].x * scaleX, path[0].y * scaleY);
          for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x * scaleX, path[i].y * scaleY);
          }
          ctx.stroke();
        }
        const dataUrl = out.toDataURL("image/png");
        annotationStore.setAnnotation({
          imageDataUrl: dataUrl,
          annotationType: "drawn on",
          alt: currentSlideImage.alt,
        });
      };
      img.src = currentSlideImage.src;
    } else {
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255, 60, 60, 0.9)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const path of pathsRef.current) {
        if (path.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
      }
      annotationStore.setAnnotation({
        imageDataUrl: out.toDataURL("image/png"),
        annotationType: "drawn on",
        alt: "Topic",
      });
    }
  }, [currentSlideImage, annotationStore]);

  const handlePointerDown = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      e.preventDefault();
      const pos = getPos(e);
      setIsDrawing(true);
      currentPathRef.current = [pos];
    },
    [getPos]
  );

  const handlePointerMove = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);
      currentPathRef.current.push(pos);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      redraw();
      const path = currentPathRef.current;
      if (path.length >= 2) {
        ctx.strokeStyle = "rgba(255, 60, 60, 0.8)";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
      }
    },
    [isDrawing, getPos, redraw]
  );

  const handlePointerUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentPathRef.current.length >= 2) {
      pathsRef.current.push([...currentPathRef.current]);
    }
    currentPathRef.current = [];
    saveToStore();
  }, [isDrawing, saveToStore]);

  /** Scroll exits draw mode so the topic can scroll */
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      onExit?.();
    },
    [onExit]
  );

  const clearAll = useCallback(() => {
    pathsRef.current = [];
    currentPathRef.current = [];
    redraw();
    annotationStore.clearAnnotation();
  }, [redraw, annotationStore]);

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 z-10 cursor-crosshair"
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerUp}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
      onWheel={handleWheel}
    >
      <canvas
        ref={canvasRef}
        className="absolute left-0 top-0 pointer-events-none"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Toolbar: Done (exit) + Eraser (clear) */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg border border-border bg-background/95 px-2 py-1.5 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          onClick={clearAll}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Clear drawing"
        >
          <Eraser className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onExit}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Done (exit draw mode)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Hint: scroll to exit */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-border bg-background/90 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
        Scroll to exit · Or tap Done
      </div>
    </div>
  );
}
