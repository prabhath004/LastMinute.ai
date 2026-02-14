"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode, KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ArrowUpIcon,
  BookOpen,
  Brain,
  FileUp,
  GraduationCap,
  Paperclip,
  PlusIcon,
  Sparkles,
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
  const [value, setValue] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 60,
    maxHeight: 200,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus(`Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as {
        error?: string;
        filename?: string;
        chars?: number;
      };

      if (!response.ok) {
        setUploadStatus(data.error ?? "Upload failed.");
        return;
      }

      setUploadStatus(
        `Processed ${data.filename ?? file.name} (${data.chars ?? 0} chars).`
      );
    } catch {
      setUploadStatus("Upload failed.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        setValue("");
        adjustHeight(true);
      }
    }
  };

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-8 px-4 py-12">
      {/* Heading */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-8 w-8 text-foreground" />
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            LastMinute
          </h1>
        </div>
        <p className="max-w-md text-base text-muted-foreground">
          Upload your materials, choose your intensity, and start learning.
        </p>
      </div>

      {/* Chat input area */}
      <div className="w-full">
        <div className="relative rounded-2xl border border-border bg-card shadow-sm transition-shadow focus-within:shadow-md">
          <div className="overflow-y-auto">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                adjustHeight();
              }}
              onKeyDown={handleKeyDown}
              placeholder="What are you studying? Describe your exam or paste a topic..."
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

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openFilePicker}
                disabled={isUploading}
                className="group flex items-center gap-1.5 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Paperclip className="h-4 w-4" />
                <span className="hidden text-xs group-hover:inline">
                  Attach
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Course
              </button>

              <button
                type="button"
                className={cn(
                  "flex items-center justify-center rounded-lg p-2 transition-all",
                  value.trim()
                    ? "bg-foreground text-background shadow-sm hover:bg-foreground/90"
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
            className="hidden"
            onChange={handleUpload}
          />
        </div>

        {/* Quick-action chips */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <ActionButton
            icon={<FileUp className="h-4 w-4" />}
            label="Upload Syllabus"
            onClick={openFilePicker}
          />
          <ActionButton
            icon={<BookOpen className="h-4 w-4" />}
            label="Study Materials"
          />
          <ActionButton
            icon={<Brain className="h-4 w-4" />}
            label="Practice Quiz"
          />
          <ActionButton
            icon={<Sparkles className="h-4 w-4" />}
            label="Start a Mission"
          />
        </div>
        {uploadStatus ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {uploadStatus}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Action button chip                                                */
/* ------------------------------------------------------------------ */

interface ActionButtonProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}

function ActionButton({ icon, label, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
