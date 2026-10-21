"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, X, Check, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAnalyticsContext } from "@/lib/AnalyticsContext";

type Status = "idle" | "submitting" | "submitted" | "error";

export function FeedbackButton() {
  const { sessionId } = useAnalyticsContext();
  const [open, setOpen] = useState(false);
  const [nps, setNps] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const submission = useRef<{ id: string; payload: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function resetForm() {
    submission.current = null;
    setNps(null);
    setComment("");
    setName("");
    setEmail("");
    setStatus("idle");
    setErrorMessage("");
  }

  function close() {
    setOpen(false);
    setTimeout(resetForm, 200);
  }

  async function submit() {
    if (nps === null) return;
    setStatus("submitting");
    setErrorMessage("");

    const feedback = {
      nps,
      comment,
      name,
      email,
      sessionId: sessionId.current || undefined,
    };
    const payload = JSON.stringify(feedback);
    if (submission.current?.payload !== payload) {
      submission.current = { id: crypto.randomUUID(), payload };
    }

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...feedback,
          id: submission.current.id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus("error");
        setErrorMessage(data.error || "Submission failed");
        return;
      }
      setStatus("submitted");
      setTimeout(close, 1500);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  const overlay = (
    <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
            onClick={close}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-sm my-auto rounded-2xl bg-panel border border-navy-border shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="feedback-title"
            >
              <button
                onClick={close}
                aria-label="Close"
                className="absolute top-3 right-3 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="px-5 pt-5 pb-2 pr-12">
                <h2
                  id="feedback-title"
                  className="text-base font-display font-extrabold text-text-primary"
                >
                  Share Your Feedback
                </h2>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                  How likely are you to recommend this workshop to a colleague?
                </p>
              </div>

              {status === "submitted" ? (
                <div className="px-5 py-10 flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center">
                    <Check className="w-6 h-6 text-success" />
                  </div>
                  <div className="text-sm font-medium text-text-primary">
                    Thanks for the feedback!
                  </div>
                </div>
              ) : (
                <div className="px-5 py-4 space-y-4">
                  <div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: 11 }, (_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setNps(i)}
                          aria-label={`Rate ${i} out of 10`}
                          aria-pressed={nps === i}
                          className={`flex-1 min-w-[28px] h-9 rounded-md text-xs font-bold transition-colors border ${
                            nps === i
                              ? "bg-twilio-red text-white border-twilio-red"
                              : "bg-surface-2 text-text-secondary border-navy-border hover:bg-surface-3"
                          }`}
                        >
                          {i}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-text-muted mt-1.5">
                      <span>Not likely</span>
                      <span>Extremely likely</span>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="feedback-comment"
                      className="block text-xs text-text-muted mb-1"
                    >
                      What stood out, good or bad? (optional)
                    </label>
                    <textarea
                      id="feedback-comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                      maxLength={2000}
                      placeholder="The pacing was…"
                      className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-navy-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-twilio-red/50 resize-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="feedback-name"
                      className="block text-xs text-text-muted mb-1"
                    >
                      Name (optional)
                    </label>
                    <input
                      id="feedback-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={200}
                      className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-navy-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-twilio-red/50"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="feedback-email"
                      className="block text-xs text-text-muted mb-1"
                    >
                      Email (optional)
                    </label>
                    <input
                      id="feedback-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      maxLength={320}
                      className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-navy-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-twilio-red/50"
                    />
                  </div>

                  {status === "error" && (
                    <div className="text-xs text-error">{errorMessage}</div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={close}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-2 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submit}
                      disabled={nps === null || status === "submitting"}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        nps === null || status === "submitting"
                          ? "bg-surface-3 text-text-muted cursor-not-allowed"
                          : "bg-twilio-red text-white hover:bg-twilio-red/90 active:bg-twilio-red/80"
                      }`}
                    >
                      {status === "submitting" ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending…
                        </>
                      ) : (
                        "Submit"
                      )}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Share feedback"
        title="Click to share feedback"
        className="shrink-0 ml-2 flex items-center justify-center w-8 h-8 rounded-lg bg-surface-2 border border-navy-border hover:bg-surface-3 transition-colors"
      >
        <MessageSquarePlus className="w-4 h-4 text-text-secondary" />
      </button>
      {typeof document !== "undefined" && createPortal(overlay, document.body)}
    </>
  );
}
