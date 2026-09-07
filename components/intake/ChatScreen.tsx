"use client";

import { chat } from "@/lib/intake/copy";
import { useIntakeChat } from "@/components/intake/useIntakeChat";
import { ChatHeader } from "@/components/intake/ChatHeader";
import { Transcript } from "@/components/intake/Transcript";
import { Composer } from "@/components/intake/Composer";

/**
 * Het intakegesprek.
 *
 * Volle schermhoogte met dvh en niet vh: op mobiel telt vh de adresbalk mee, en
 * dan valt de invoerbalk net onder de vouw. De kop en de invoerbalk staan sticky
 * zodat alleen de berichten scrollen.
 */
export function ChatScreen({
  onSubmit,
  externalError,
  submitting = false,
}: {
  onSubmit: () => void;
  /** Fout uit een actie buiten het gesprek, zoals het indienen. */
  externalError?: string | null;
  submitting?: boolean;
}) {
  const state = useIntakeChat();

  return (
    <div className="mx-auto flex min-h-dvh max-w-[30rem] flex-col bg-canvas">
      <ChatHeader
        collecting={state.collecting?.label ?? null}
        sectionsDone={state.progress.sectionsDone}
        sectionsTotal={state.progress.sectionsTotal}
        requiredFilled={state.progress.requiredFilled}
        requiredTotal={state.progress.requiredTotal}
      />

      {(state.error ?? externalError) && (
        <p className="mx-4 mt-3 rounded-card border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {state.error ?? externalError}
        </p>
      )}

      <Transcript
        items={state.items}
        busy={state.busy}
        onConfirm={state.confirmField}
        onEdit={state.editField}
      />

      {state.notice && (
        <p className="mx-4 mb-2 rounded-card bg-canvas px-3 py-2 text-xs text-ink-muted ring-1 ring-hairline ring-inset">
          {state.notice}
        </p>
      )}

      {state.completeness?.readyToSubmit && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={state.busy || submitting}
            className="w-full rounded-card bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            {chat.finish}
          </button>
        </div>
      )}

      <Composer
        value={state.draft}
        onChange={state.setDraft}
        onSubmit={state.send}
        onFilesPicked={(files) => void state.uploadFiles(files)}
        disabled={state.busy || state.loading}
      />
    </div>
  );
}
