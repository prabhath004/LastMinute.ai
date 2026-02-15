"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { cn } from "@/lib/utils";
import { Pencil, Square, Eraser, Send, X, Loader2 } from "lucide-react";
import { useAnnotationStore } from "@/hooks/use-annotation-store";

type Tool = "pen" | "rect" | "none";

interface Point {
  x: number;
  y: number;
}

interface ImageAnnotatorProps {
  src: string;
  alt: string;
  className?: string;
  /** When true, compact layout for Voxi chat: toolbar always visible, no Analyze button */
  embedInChat?: boolean;
}

export function ImageAnnotator({ src, alt, className, embedInChat }: ImageAnnotatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const annotationStore = useAnnotationStore();

  const [tool, setTool] = useState<Tool>("none");
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Drawing state refs (no re-render needed)
  const pathsRef = useRef<Point[][]>([]);
  const currentPathRef = useRef<Point[]>([]);
  const rectStartRef = useRef<Point | null>(null);
  const rectsRef = useRef<{ start: Point; end: Point }[]>([]);

  // Sync canvas size with image
  const syncCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const rect = img.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    redraw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncCanvas();
    window.addEventListener("resize", syncCanvas);
    return () => window.removeEventListener("resize", syncCanvas);
  }, [syncCanvas, src]);

  const getPos = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent | MouseEvent | TouchEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      let clientX: number, clientY: number;
      if ("touches" in e) {
        const touch = e.touches[0] || (e as TouchEvent).changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
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

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw freehand paths
    ctx.strokeStyle = "rgba(255, 60, 60, 0.7)";
    ctx.lineWidth = 3;
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

    // Draw rectangles
    ctx.strokeStyle = "rgba(255, 200, 0, 0.8)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 3]);
    for (const r of rectsRef.current) {
      const x = Math.min(r.start.x, r.end.x);
      const y = Math.min(r.start.y, r.end.y);
      const w = Math.abs(r.end.x - r.start.x);
      const h = Math.abs(r.end.y - r.start.y);
      ctx.strokeRect(x, y, w, h);
      // Light fill
      ctx.fillStyle = "rgba(255, 200, 0, 0.1)";
      ctx.fillRect(x, y, w, h);
    }
    ctx.setLineDash([]);
  }, []);

  // ---- Drawing handlers ----

  const handlePointerDown = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      if (tool === "none") return;
      e.preventDefault();
      const pos = getPos(e);
      setIsDrawing(true);

      if (tool === "pen") {
        currentPathRef.current = [pos];
      } else if (tool === "rect") {
        rectStartRef.current = pos;
      }
    },
    [tool, getPos]
  );

  const handlePointerMove = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      if (!isDrawing || tool === "none") return;
      e.preventDefault();
      const pos = getPos(e);

      if (tool === "pen") {
        currentPathRef.current.push(pos);
        // Draw current stroke live
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        redraw();
        // Draw current path
        const path = currentPathRef.current;
        if (path.length >= 2) {
          ctx.strokeStyle = "rgba(255, 60, 60, 0.7)";
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(path[0].x, path[0].y);
          for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x, path[i].y);
          }
          ctx.stroke();
        }
      } else if (tool === "rect" && rectStartRef.current) {
        redraw();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const start = rectStartRef.current;
        const x = Math.min(start.x, pos.x);
        const y = Math.min(start.y, pos.y);
        const w = Math.abs(pos.x - start.x);
        const h = Math.abs(pos.y - start.y);
        ctx.strokeStyle = "rgba(255, 200, 0, 0.8)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = "rgba(255, 200, 0, 0.1)";
        ctx.fillRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    },
    [isDrawing, tool, getPos, redraw]
  );

  /** Composite image + annotations and save to shared store so Voxi can access it */
  const saveToAnnotationStore = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const composite = document.createElement("canvas");
    composite.width = canvas.width;
    composite.height = canvas.height;
    const ctx = composite.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(canvas, 0, 0);
    const dataUrl = composite.toDataURL("image/jpeg", 0.85);
    const hasRects = rectsRef.current.length > 0;
    const hasPaths = pathsRef.current.length > 0;
    let annotationType = "drawn on";
    if (hasRects && !hasPaths) annotationType = "highlighted a rectangular area of";
    else if (!hasRects && hasPaths) annotationType = "circled/drawn on parts of";
    else if (hasRects && hasPaths) annotationType = "highlighted and drawn on parts of";
    annotationStore.setAnnotation({ imageDataUrl: dataUrl, annotationType, alt });
  }, [alt, annotationStore]);

  const handlePointerUp = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      if (!isDrawing || tool === "none") return;
      e.preventDefault();
      setIsDrawing(false);

      let didDraw = false;
      if (tool === "pen" && currentPathRef.current.length > 1) {
        pathsRef.current.push([...currentPathRef.current]);
        currentPathRef.current = [];
        setHasDrawing(true);
        didDraw = true;
      } else if (tool === "rect" && rectStartRef.current) {
        const end = getPos(e);
        const w = Math.abs(end.x - rectStartRef.current.x);
        const h = Math.abs(end.y - rectStartRef.current.y);
        if (w > 5 && h > 5) {
          rectsRef.current.push({ start: rectStartRef.current, end });
          setHasDrawing(true);
          didDraw = true;
        }
        rectStartRef.current = null;
      }
      redraw();
      // Save to shared store so Voxi can analyze it
      if (didDraw) {
        requestAnimationFrame(() => saveToAnnotationStore());
      }
    },
    [isDrawing, tool, getPos, redraw, saveToAnnotationStore]
  );

  const clearDrawing = useCallback(() => {
    pathsRef.current = [];
    currentPathRef.current = [];
    rectsRef.current = [];
    rectStartRef.current = null;
    setHasDrawing(false);
    setAnalysis(null);
    setShowAnalysis(false);
    annotationStore.clearAnnotation();
    redraw();
  }, [redraw, annotationStore]);

  // ---- Analyze: composite image + annotations, send to API ----

  const analyzeDrawing = useCallback(async () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    setAnalyzing(true);
    setShowAnalysis(true);
    setAnalysis(null);

    try {
      // Create composite: original image + canvas overlay
      const composite = document.createElement("canvas");
      composite.width = canvas.width;
      composite.height = canvas.height;
      const ctx = composite.getContext("2d");
      if (!ctx) return;

      // Draw the original image scaled to canvas size
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Draw the annotation overlay on top
      ctx.drawImage(canvas, 0, 0);

      // Get composite as base64 (jpeg for smaller size)
      const dataUrl = composite.toDataURL("image/jpeg", 0.85);

      // Describe what was highlighted for better context
      const hasRects = rectsRef.current.length > 0;
      const hasPaths = pathsRef.current.length > 0;
      let annotationType = "drawn on";
      if (hasRects && !hasPaths) annotationType = "highlighted a rectangular area of";
      else if (!hasRects && hasPaths) annotationType = "circled/drawn on parts of";
      else if (hasRects && hasPaths) annotationType = "highlighted and drawn on parts of";

      const resp = await fetch("/api/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: dataUrl,
          annotationType,
          alt,
        }),
      });

      if (!resp.ok) {
        setAnalysis("Analysis unavailable. Please try again.");
        return;
      }

      const data = await resp.json();
      setAnalysis(data.content ?? "Could not analyze this area.");
    } catch {
      setAnalysis("Analysis failed. Check your connection.");
    } finally {
      setAnalyzing(false);
    }
  }, [alt]);

  const isActive = tool !== "none";

  return (
    <div
      className={cn(
        "group relative",
        embedInChat && "max-h-[220px] overflow-hidden rounded-lg border border-border bg-muted/20"
      )}
      ref={containerRef}
    >
      {/* Original image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={cn(
          "h-auto w-full object-contain",
          embedInChat && "max-h-[180px] object-contain",
          className
        )}
        onLoad={syncCanvas}
        draggable={false}
      />

      {/* Canvas overlay — only captures events when a tool is active */}
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute left-0 top-0",
          isActive ? "cursor-crosshair" : "pointer-events-none"
        )}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      />

      {/* Toolbar — inline when embedInChat, else overlay on hover/active */}
      <div
        className={cn(
          "flex items-center gap-1 rounded-lg border border-border bg-background/90 px-1.5 py-1 shadow-sm backdrop-blur-sm",
          embedInChat
            ? "absolute bottom-2 left-2 right-2 flex-wrap"
            : "absolute right-2 top-2 transition-opacity " +
              (isActive || hasDrawing ? "opacity-100" : "opacity-0 group-hover:opacity-100")
        )}
      >
        <button
          type="button"
          onClick={() => setTool(tool === "pen" ? "none" : "pen")}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            tool === "pen"
              ? "bg-red-500/15 text-red-600"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title="Draw / circle"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setTool(tool === "rect" ? "none" : "rect")}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            tool === "rect"
              ? "bg-yellow-500/15 text-yellow-600"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title="Highlight area"
        >
          <Square className="h-3.5 w-3.5" />
        </button>

        {hasDrawing && (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <button
              type="button"
              onClick={clearDrawing}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Clear annotations"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
            {!embedInChat && (
              <button
                type="button"
                onClick={analyzeDrawing}
                disabled={analyzing}
                className="flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                title="Analyze highlighted area"
              >
                {analyzing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Analyze
              </button>
            )}
          </>
        )}
      </div>

      {/* Analysis result (hidden when embedInChat) */}
      {!embedInChat && showAnalysis && (
        <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              {analyzing ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Analyzing your selection...
                  </span>
                </div>
              ) : analysis ? (
                <p className="whitespace-pre-line text-xs leading-relaxed text-foreground">
                  {analysis}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAnalysis(false);
                setAnalysis(null);
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
