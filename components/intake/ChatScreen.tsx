"use client";

import { useIntakeChat } from "@/components/intake/useIntakeChat";
import { ChatHeader } from "@/components/intake/ChatHeader";
import { Transcript } from "@/components/intake/Transcript";
import { Composer } from "@/components/intake/Composer";
import { IntroCard } from "@/components/intake/IntroCard";
import { SubmitConsent } from "@/components/intake/SubmitConsent";
import { DossierPanel } from "@/components/intake/DossierPanel";

/**
 * Het intakegesprek.
 *
 * Volle schermhoogte met dvh en niet vh: op mobiel telt vh de adresbalk mee, en
 * dan valt de invoerbalk net onder de vouw. De kop en de invoerbalk staan sticky
 * zodat alleen de berichten scrollen.
 *
 * Vanaf lg staat het dossier ernaast. Onder die breedte is dit precies wat het
 * was: één kolom, de pagina scrollt. Erboven krijgen de twee kolommen elk hun
 * eigen scroll (h-dvh met overflow-hidden op de omhulling), want een
 * gespreksvenster dat met de pagina meescrollt terwijl er een paneel naast
 * staat laat de invoerbalk uit beeld lopen.
 */
export function ChatScreen({
  onSubmit,
  externalError,
  submitting = false,
}: {
  onSubmit: (share: boolean) => void;
  /** Fout uit een actie buiten het gesprek, zoals het indienen. */
  externalError?: string | null;
  submitting?: boolean;
}) {
  const state = useIntakeChat();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col bg-canvas lg:h-dvh lg:min-h-0 lg:max-w-[68rem] lg:flex-row lg:overflow-hidden lg:shadow-card lg:ring-1 lg:ring-hairline">
      <div className="flex min-h-dvh flex-1 flex-col lg:h-full lg:min-h-0 lg:border-r lg:border-hairline">
        <ChatHeader
          backHref="/home"
          title={state.title}
          collecting={state.collecting?.label ?? null}
          ready={state.completeness?.readyToSubmit ?? false}
          reportHref={state.intakeId ? `/report/${state.intakeId}` : null}
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
          intro={<IntroCard />}
          onConfirm={state.confirmField}
          onEdit={state.editField}
          onRead={(documentId) => void state.readFile(documentId)}
        />

        {state.notice && (
          <p className="mx-4 mb-2 rounded-card bg-canvas px-3 py-2 text-xs text-ink-muted ring-1 ring-hairline ring-inset">
            {state.notice}
          </p>
        )}

        {/* Klaar om in te dienen: dan de deelvraag, en die IS de indienknop. Een
            losse "Finish"-knop ernaast zou een pad geven waarop de vraag
            overgeslagen wordt, en dan is er geen keuze vastgelegd. */}
        {state.completeness?.readyToSubmit && (
          <SubmitConsent busy={state.busy || submitting} onSubmit={onSubmit} />
        )}

        <Composer
          value={state.draft}
          onChange={state.setDraft}
          onSubmit={state.send}
          onFilesPicked={(files) => void state.uploadFiles(files)}
          disabled={state.busy || state.loading}
        />
      </div>

      {/* De sleutel is de voortgang zelf: verandert die, dan kan er iets in het
          dossier zijn bijgekomen. Geen timer en geen abonnement. */}
      <DossierPanel
        refreshKey={state.progress.requiredFilled + state.items.length}
        className="hidden shrink-0 overflow-y-auto bg-surface lg:block lg:h-full lg:w-[22rem]"
      />
    </div>
  );
}
