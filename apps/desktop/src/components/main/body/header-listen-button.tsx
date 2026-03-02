import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { downloadDir } from "@tauri-apps/api/path";
import { open as selectFile } from "@tauri-apps/plugin-dialog";
import { Effect, pipe } from "effect";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { commands as analyticsCommands } from "@hypr/plugin-analytics";
import { commands as fsSyncCommands } from "@hypr/plugin-fs-sync";
import { commands as listener2Commands } from "@hypr/plugin-listener2";
import { md2json } from "@hypr/tiptap/shared";
import { Button } from "@hypr/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@hypr/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@hypr/ui/components/ui/tooltip";
import { cn } from "@hypr/utils";

import { useAITask } from "../../../contexts/ai-task";
import { useListener } from "../../../contexts/listener";
import { fromResult } from "../../../effect";
import { getEligibility } from "../../../hooks/autoEnhance/eligibility";
import { useCreateEnhancedNote } from "../../../hooks/useEnhancedNotes";
import { useLanguageModel } from "../../../hooks/useLLMConnection";
import { useRunBatch } from "../../../hooks/useRunBatch";
import * as main from "../../../store/tinybase/store/main";
import * as settings from "../../../store/tinybase/store/settings";
import { createTaskId } from "../../../store/zustand/ai-task/task-configs";
import { type Tab, useTabs } from "../../../store/zustand/tabs";
import { id } from "../../../utils";
import { ChannelProfile } from "../../../utils/segment";
import { useNewNoteAndListen } from "../shared";
import { RecordingIcon } from "./sessions/shared";

type UploadKind = "audio" | "transcript";
type UploadState = { kind: UploadKind; sessionId: string } | null;

export function HeaderListenButton({
  isListening,
  listeningTab,
  hasOverflow,
}: {
  isListening: boolean;
  listeningTab: Tab | null | undefined;
  hasOverflow: boolean;
}) {
  const handleNewNoteAndListen = useNewNoteAndListen();
  const select = useTabs((state) => state.select);
  const stop = useListener((state) => state.stop);
  const finalizing = useListener((state) => state.live.status === "finalizing");

  const handleStopAndFocus = useCallback(() => {
    if (listeningTab) {
      select(listeningTab);
    }
    stop();
  }, [listeningTab, select, stop]);

  if (isListening && listeningTab) {
    return (
      <HeaderStopButton
        compact={hasOverflow}
        finalizing={finalizing}
        onStop={handleStopAndFocus}
      />
    );
  }

  return (
    <HeaderStartButton compact={hasOverflow} onStart={handleNewNoteAndListen} />
  );
}

function HeaderStopButton({
  compact,
  finalizing,
  onStop,
}: {
  compact: boolean;
  finalizing: boolean;
  onStop: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={finalizing ? undefined : onStop}
          disabled={finalizing}
          className={cn([
            "inline-flex items-center justify-center rounded-full text-sm font-medium",
            "gap-1 h-8 shrink-0",
            compact ? "px-3" : "pl-3 pr-4",
            finalizing
              ? ["text-neutral-500", "bg-neutral-100", "cursor-wait"]
              : ["text-white", "bg-red-500 hover:bg-red-300"],
            "disabled:pointer-events-none disabled:opacity-50",
          ])}
        >
          {finalizing ? (
            <span className="animate-pulse text-xs">...</span>
          ) : (
            <>
              <span className="size-2 bg-white rounded-none shrink-0" />
              <AnimatePresence initial={false}>
                {!compact && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.18, ease: "easeInOut" }}
                    className="overflow-hidden whitespace-nowrap text-sm inline-flex"
                  >
                    Stop
                  </motion.span>
                )}
              </AnimatePresence>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {finalizing ? "Finalizing..." : "Stop listening"}
      </TooltipContent>
    </Tooltip>
  );
}

function HeaderStartButton({
  compact,
  onStart,
}: {
  compact: boolean;
  onStart: () => void;
}) {
  const [uploadState, setUploadState] = useState<UploadState>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const { persistedStore, internalStore } = useRouteContext({
    from: "__root__",
  });
  const openNew = useTabs((state) => state.openNew);

  const createNoteAndUpload = useCallback(
    (kind: UploadKind) => {
      setPopoverOpen(false);
      const user_id = internalStore?.getValue("user_id");
      const sessionId = id();
      persistedStore?.setRow("sessions", sessionId, {
        user_id,
        created_at: new Date().toISOString(),
        title: "",
      });
      openNew({ type: "sessions", id: sessionId });
      setUploadState({ kind, sessionId });
    },
    [persistedStore, internalStore, openNew],
  );

  return (
    <>
      {uploadState && (
        <UploadWorker
          sessionId={uploadState.sessionId}
          kind={uploadState.kind}
          onDone={() => setUploadState(null)}
        />
      )}
      <div className="relative flex items-center">
        <Button
          onClick={onStart}
          variant="default"
          size="sm"
          className={cn([
            "gap-2 h-8 text-neutral-100 shrink-0 rounded-full py-1.5",
            compact ? "px-2 pr-7" : "pl-3 pr-7",
          ])}
        >
          <RecordingIcon />
          <AnimatePresence initial={false}>
            {!compact && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18, ease: "easeInOut" }}
                className="overflow-hidden whitespace-nowrap text-sm inline-flex"
              >
                New recording
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 cursor-pointer text-white/70 hover:text-white transition-colors"
            >
              <ChevronDown className="size-4" />
              <span className="sr-only">More options</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            sideOffset={8}
            className="w-43 p-1.5 rounded-xl"
          >
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                className="justify-center h-9 px-3 whitespace-nowrap"
                onClick={() => createNoteAndUpload("audio")}
              >
                <span className="text-sm">Upload audio</span>
              </Button>
              <Button
                variant="ghost"
                className="justify-center h-9 px-3 whitespace-nowrap"
                onClick={() => createNoteAndUpload("transcript")}
              >
                <span className="text-sm">Upload transcript</span>
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}

function UploadWorker({
  sessionId,
  kind,
  onDone,
}: {
  sessionId: string;
  kind: UploadKind;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const handleBatchStarted = useListener((state) => state.handleBatchStarted);
  const handleBatchFailed = useListener((state) => state.handleBatchFailed);
  const clearBatchSession = useListener((state) => state.clearBatchSession);

  const store = main.UI.useStore(main.STORE_ID) as main.Store | undefined;
  const indexes = main.UI.useIndexes(main.STORE_ID);
  const { user_id } = main.UI.useValues(main.STORE_ID);

  const updateSessionTabState = useTabs((state) => state.updateSessionTabState);
  const createEnhancedNote = useCreateEnhancedNote();
  const model = useLanguageModel("enhance");
  const generate = useAITask((state) => state.generate);
  const selectedTemplateId = settings.UI.useValue(
    "selected_template_id",
    settings.STORE_ID,
  ) as string | undefined;

  const sessionTab = useTabs((state) => {
    const found = state.tabs.find(
      (tab): tab is Extract<Tab, { type: "sessions" }> =>
        tab.type === "sessions" && tab.id === sessionId,
    );
    return found ?? null;
  });

  const runBatch = useRunBatch(sessionId);

  const sessionTabRef = useRef(sessionTab);
  sessionTabRef.current = sessionTab;

  const runBatchRef = useRef(runBatch);
  runBatchRef.current = runBatch;

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const storeRef = useRef(store);
  storeRef.current = store;

  const triggerEnhance = useCallback(() => {
    if (!storeRef.current || !indexes || !model) {
      return;
    }

    const transcriptIds = indexes.getSliceRowIds(
      main.INDEXES.transcriptBySession,
      sessionId,
    );
    const hasTranscript = transcriptIds.length > 0;
    const eligibility = getEligibility(
      hasTranscript,
      transcriptIds,
      storeRef.current,
    );

    if (!eligibility.eligible) {
      return;
    }

    const templateId = selectedTemplateId || undefined;
    const enhancedNoteId = createEnhancedNote(sessionId, templateId);
    if (!enhancedNoteId) {
      return;
    }

    const tab = sessionTabRef.current;
    if (tab) {
      updateSessionTabState(tab, {
        ...tab.state,
        view: { type: "enhanced", id: enhancedNoteId },
      });
    }

    const enhanceTaskId = createTaskId(enhancedNoteId, "enhance");
    void generate(enhanceTaskId, {
      model,
      taskType: "enhance",
      args: { sessionId, enhancedNoteId, templateId },
      onComplete: (text) => {
        if (!text || !storeRef.current) {
          return;
        }
        try {
          const jsonContent = md2json(text);
          storeRef.current.setPartialRow("enhanced_notes", enhancedNoteId, {
            content: JSON.stringify(jsonContent),
          });
          const currentTitle = storeRef.current.getCell(
            "sessions",
            sessionId,
            "title",
          );
          const trimmedTitle =
            typeof currentTitle === "string" ? currentTitle.trim() : "";
          if (!trimmedTitle && model) {
            const titleTaskId = createTaskId(sessionId, "title");
            void generate(titleTaskId, {
              model,
              taskType: "title",
              args: { sessionId },
              onComplete: (titleText) => {
                if (titleText && storeRef.current) {
                  const trimmed = titleText.trim();
                  if (trimmed && trimmed !== "<EMPTY>") {
                    storeRef.current.setPartialRow("sessions", sessionId, {
                      title: trimmed,
                    });
                  }
                }
              },
            });
          }
        } catch (error) {
          console.error("Failed to convert markdown to JSON:", error);
        }
      },
    });
  }, [
    indexes,
    model,
    sessionId,
    createEnhancedNote,
    selectedTemplateId,
    updateSessionTabState,
    generate,
  ]);

  useEffect(() => {
    const program = pipe(
      Effect.promise(() => downloadDir()),
      Effect.flatMap((defaultPath) =>
        Effect.promise(() =>
          selectFile({
            title: kind === "audio" ? "Upload Audio" : "Upload Transcript",
            multiple: false,
            directory: false,
            defaultPath,
            filters:
              kind === "audio"
                ? [
                    {
                      name: "Audio",
                      extensions: ["wav", "mp3", "ogg", "mp4", "m4a", "flac"],
                    },
                  ]
                : [{ name: "Transcript", extensions: ["vtt", "srt"] }],
          }),
        ),
      ),
      Effect.tap(() => Effect.sync(() => onDoneRef.current())),
      Effect.flatMap((selection) => {
        if (!selection) {
          return Effect.void;
        }
        const path = Array.isArray(selection) ? selection[0] : selection;
        if (!path) {
          return Effect.void;
        }

        if (kind === "transcript") {
          return pipe(
            fromResult(listener2Commands.parseSubtitle(path)),
            Effect.tap((subtitle) =>
              Effect.sync(() => {
                const store = storeRef.current;
                if (!store || subtitle.tokens.length === 0) {
                  return;
                }
                const tab = sessionTabRef.current;
                if (tab) {
                  updateSessionTabState(tab, {
                    ...tab.state,
                    view: { type: "transcript" },
                  });
                }
                const transcriptId = crypto.randomUUID();
                const createdAt = new Date().toISOString();
                const words = subtitle.tokens.map((token) => ({
                  id: crypto.randomUUID(),
                  transcript_id: transcriptId,
                  text: token.text,
                  start_ms: token.start_time,
                  end_ms: token.end_time,
                  channel: ChannelProfile.MixedCapture,
                  user_id: user_id ?? "",
                  created_at: new Date().toISOString(),
                }));
                store.setRow("transcripts", transcriptId, {
                  session_id: sessionId,
                  user_id: user_id ?? "",
                  created_at: createdAt,
                  started_at: Date.now(),
                  words: JSON.stringify(words),
                  speaker_hints: "[]",
                });
                void analyticsCommands.event({
                  event: "file_uploaded",
                  file_type: "transcript",
                  token_count: subtitle.tokens.length,
                });
                triggerEnhance();
              }),
            ),
          );
        }

        return pipe(
          Effect.sync(() => {
            const tab = sessionTabRef.current;
            if (tab) {
              updateSessionTabState(tab, {
                ...tab.state,
                view: { type: "transcript" },
              });
            }
            handleBatchStarted(sessionId);
          }),
          Effect.flatMap(() =>
            fromResult(fsSyncCommands.audioImport(sessionId, path)),
          ),
          Effect.tap(() =>
            Effect.sync(() => {
              void analyticsCommands.event({
                event: "file_uploaded",
                file_type: "audio",
              });
              void queryClient.invalidateQueries({
                queryKey: ["audio", sessionId, "exist"],
              });
              void queryClient.invalidateQueries({
                queryKey: ["audio", sessionId, "url"],
              });
            }),
          ),
          Effect.tap(() => Effect.sync(() => clearBatchSession(sessionId))),
          Effect.flatMap((importedPath) =>
            Effect.tryPromise({
              try: () => runBatchRef.current(importedPath),
              catch: (error) => error,
            }),
          ),
          Effect.tap(() => Effect.sync(() => triggerEnhance())),
          Effect.catchAll((error: unknown) =>
            Effect.sync(() => {
              const msg =
                error instanceof Error ? error.message : String(error);
              handleBatchFailed(sessionId, msg);
            }),
          ),
        );
      }),
    );

    Effect.runPromise(program).catch((error) => {
      console.error("[header-upload] failed:", error);
      onDoneRef.current();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
