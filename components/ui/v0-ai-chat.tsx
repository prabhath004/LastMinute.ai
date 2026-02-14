"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode, KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { UploadResult } from "@/types";
import {
  ArrowUpIcon,
  BookOpen,
  Brain,
  FileUp,
  Loader2,
  Paperclip,
  PlusIcon,
  Sparkles,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Auto-resize textarea hook                                         */
/* ------------------------------------------------------------------ */

interface UseAutoResizeTextareaProps {
  minHeight: number;
  maxHeight?: number;
}

function useAutoResizeTextarea({ minHeight, maxHeight }: UseAutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }

      textarea.style.height = `${minHeight}px`;
      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY)
      );
      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight]
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) textarea.style.height = `${minHeight}px`;
  }, [minHeight]);

  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export function VercelV0Chat() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 60,
    maxHeight: 200,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files ? Array.from(event.target.files) : [];
    if (picked.length === 0) return;
    setStagedFiles((prev) => [...prev, ...picked]);
    event.target.value = "";
  };

  const removeStaged = (index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /** Upload files → store result in sessionStorage → navigate to /workspace */
  const handleSubmit = async () => {
    if (stagedFiles.length === 0 && !value.trim()) return;

    const filesToUpload = [...stagedFiles];
    setStagedFiles([]);
    setValue("");
    adjustHeight(true);
    setUploadError("");

    if (filesToUpload.length === 0) return;

    setIsUploading(true);

    try {
      const results = await Promise.all(
        filesToUpload.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);
          const response = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          const data = await response.json();
          return { file, ok: response.ok, data };
        })
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setUploadError(failed[0].data.error ?? "Upload failed. Try again.");
        setIsUploading(false);
        return;
      }

      // Store full API responses in sessionStorage
      const uploadResults: UploadResult[] = results
        .filter((r) => r.ok)
        .map((r) => ({
          filename: r.data.filename ?? r.file.name,
          chars: r.data.chars ?? 0,
          concepts: r.data.concepts ?? [],
          checklist: r.data.checklist ?? [],
          interactive_story: r.data.interactive_story ?? {
            title: "",
            opening: "",
            checkpoint: "",
            boss_level: "",
          },
          final_storytelling: r.data.final_storytelling ?? "",
          llm_used: Boolean(r.data.llm_used),
          llm_status: r.data.llm_status ?? "",
        }));

      sessionStorage.setItem("lastminute_upload", JSON.stringify(uploadResults));
      router.push("/workspace");
    } catch {
      setUploadError("Upload failed. Check your connection.");
      setIsUploading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /* ---- uploading overlay ---- */
  if (isUploading) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-32">
        <Loader2 className="h-8 w-8 animate-spin text-foreground" />
        <p className="text-sm text-muted-foreground">
          Processing your materials...
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-12 px-4 py-20">
      {/* Logo */}
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="font-mono text-4xl font-bold tracking-tighter text-foreground">
          lastminute<span className="text-muted-foreground">.ai</span>
        </h1>
        <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          Upload your study materials. We turn them into interactive missions.
        </p>
      </div>

      {/* Input area */}
      <div className="w-full">
        <div className="rounded-xl border border-border bg-background transition-shadow focus-within:border-foreground/20">
          {/* Staged file chips */}
          {stagedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {stagedFiles.map((file, idx) => (
                <span
                  key={`${file.name}-${idx}`}
                  className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs text-foreground"
                >
                  <FileUp className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="max-w-[160px] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeStaged(idx)}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="overflow-y-auto">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                adjustHeight();
              }}
              onKeyDown={handleKeyDown}
              placeholder="What are you studying?"
              className={cn(
                "w-full px-4 py-3",
                "resize-none",
                "bg-transparent",
                "border-none",
                "text-foreground text-sm",
                "focus:outline-none",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
                "placeholder:text-muted-foreground placeholder:text-sm",
                "min-h-[60px]"
              )}
              style={{ overflow: "hidden" }}
            />
          </div>

          <div className="flex items-center justify-between px-3 pb-3">
            <button
              type="button"
              onClick={openFilePicker}
              className="group flex items-center gap-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Paperclip className="h-4 w-4" />
              <span className="hidden text-xs group-hover:inline">Attach</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Course
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                className={cn(
                  "flex items-center justify-center rounded-md p-1.5 transition-all",
                  value.trim() || stagedFiles.length > 0
                    ? "bg-foreground text-background"
                    : "text-muted-foreground"
                )}
              >
                <ArrowUpIcon className="h-4 w-4" />
                <span className="sr-only">Send</span>
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.pptx,.png,.jpg,.jpeg"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Action chips */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <ActionButton
            icon={<FileUp className="h-3.5 w-3.5" />}
            label="Upload Syllabus"
            onClick={openFilePicker}
          />
          <ActionButton icon={<BookOpen className="h-3.5 w-3.5" />} label="Study Materials" />
          <ActionButton icon={<Brain className="h-3.5 w-3.5" />} label="Practice Quiz" />
          <ActionButton
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="Start a Mission"
            href="/workspace"
          />
        </div>

        {/* Error */}
        {uploadError && (
          <p className="mt-3 text-center text-xs text-foreground/60">
            {uploadError}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Action chip                                                       */
/* ------------------------------------------------------------------ */

interface ActionButtonProps {
  icon: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
}

function ActionButton({ icon, label, href, onClick }: ActionButtonProps) {
  const cls =
    "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground";

  if (href) {
    return (
      <Link href={href} className={cls}>
        {icon}
        {label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cls}>
      {icon}
      {label}
    </button>
  );
}
