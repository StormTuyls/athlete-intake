"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { SectionLabel } from "@/components/intake/SectionLabel";
import { ChevronLeftIcon, CheckIcon } from "@/components/intake/icons";
import { ChangePassword } from "@/components/auth/ChangePassword";
import type {
  AthleteProfileValues,
  PractitionerOption,
  ProfileData,
} from "@/lib/intake/profile";

/**
 * Het profielscherm van de atleet.
 *
 * Eén formulier en één opslaan-knop, geen veld dat bij het verlaten stilletjes
 * wegschrijft. Een adres en een behandelaar zijn geen chatantwoorden: je vult ze
 * in, je kijkt ze na, en dan pas sla je op. Automatisch opslaan per veld
 * betekent hier vier verzoeken voor één handeling en een halve wijziging als er
 * eentje faalt.
 *
 * Het e-mailadres staat er wel, maar niet als invoerveld. Dat is de inlog, en
 * die veranderen is een bevestigingsmail en een herstelpad, geen tekstvak. Hem
 * weglaten zou erger zijn: dan zoekt de atleet op de enige plek waar hij hem
 * verwacht en vindt hij niets.
 */

const label = "text-label uppercase text-ink-muted";
const field =
  "mt-1.5 w-full rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-base text-ink outline-none placeholder:text-ink-faint focus-visible:border-brand-600";

function Field({
  id,
  labelText,
  value,
  onChange,
  autoComplete,
  maxLength,
  inputMode,
  placeholder,
  className,
}: {
  id: string;
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  maxLength?: number;
  inputMode?: "text" | "numeric";
  placeholder?: string;
  className?: string;
}) {
  return (
    <label htmlFor={id} className={cn("block", className)}>
      <span className={label}>{labelText}</span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        maxLength={maxLength}
        inputMode={inputMode}
        placeholder={placeholder}
        className={field}
      />
    </label>
  );
}

/**
 * Eén behandelaar als keuze.
 *
 * Een radiogroep en geen dropdown: het zijn er een handvol, en een naam met een
 * vakgebied eronder is meer dan in een `<option>` past. De echte radio blijft
 * bestaan maar is onzichtbaar, zodat pijltjestoetsen, tab en een screenreader
 * doen wat ze horen te doen.
 */
function Choice({
  name,
  checked,
  onSelect,
  initials,
  title,
  subtitle,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  initials: string | null;
  title: string;
  subtitle: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
        checked ? "bg-brand-600/5" : "hover:bg-canvas",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-chip text-xs font-semibold",
          checked ? "bg-brand-600 text-white" : "bg-canvas text-ink-muted",
        )}
        aria-hidden
      >
        {initials ?? "—"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">{subtitle}</span>
      </span>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-chip ring-1 ring-inset peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600",
          checked ? "bg-brand-600 text-white ring-brand-600" : "ring-hairline",
        )}
        aria-hidden
      >
        {checked && <CheckIcon className="size-3.5" />}
      </span>
    </label>
  );
}

type Draft = {
  fullName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  practitionerId: string;
};

function toDraft(values: AthleteProfileValues): Draft {
  return {
    fullName: values.fullName ?? "",
    street: values.street ?? "",
    postalCode: values.postalCode ?? "",
    city: values.city ?? "",
    country: values.country ?? "",
    practitionerId: values.practitionerId ?? "",
  };
}

export function ProfileScreen({ data }: { data: ProfileData }) {
  const t = useTranslations("profile");
  const router = useRouter();

  const [draft, setDraft] = useState<Draft>(() => toDraft(data.values));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    // Een bevestiging die na een wijziging blijft staan gaat over de vorige
    // versie en liegt dus binnen een seconde.
    setSaved(false);
    setError(null);
  };

  // Dezelfde regel als de check-constraint op de kolom, hier alleen eerder en
  // vriendelijker. De server keurt af, dit voorkomt de rondgang.
  const countryValid = draft.country === "" || /^[A-Za-z]{2}$/.test(draft.country.trim());

  const kindLabel = (kind: PractitionerOption["kind"]) =>
    kind === "physio" ? t("kindPhysio") : t("kindCoach");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/athlete/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? t("saveFailed"));
      }
      setSaved(true);
      // De naam staat ook in de kop van het thuisscherm, dat een server
      // component is. Zonder refresh groet dat scherm je straks nog met je
      // oude naam.
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[30rem] bg-canvas px-4 pt-6 pb-10 lg:shadow-card lg:ring-1 lg:ring-hairline">
      <header className="flex items-center gap-2 px-1">
        <Link
          href="/home"
          aria-label={t("back")}
          className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-chip text-ink-muted transition-colors hover:bg-surface"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("title")}</h1>
      </header>

      <p className="mt-2 px-1 text-sm text-ink-muted">{t("intro")}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && countryValid) void save();
        }}
      >
        <section className="mt-6">
          <SectionLabel>{t("detailsTitle")}</SectionLabel>
          <div className="mt-2 rounded-card bg-surface p-4 shadow-card ring-1 ring-hairline ring-inset">
            <Field
              id="profile-full-name"
              labelText={t("fullName")}
              value={draft.fullName}
              onChange={(value) => set("fullName", value)}
              autoComplete="name"
              maxLength={120}
            />

            <div className="mt-4">
              <span className={label}>{t("email")}</span>
              <p className="mt-1.5 truncate text-base text-ink">{data.email ?? "—"}</p>
              <p className="mt-1 text-xs text-ink-faint">{t("emailNote")}</p>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <SectionLabel>{t("addressTitle")}</SectionLabel>
          <div className="mt-2 rounded-card bg-surface p-4 shadow-card ring-1 ring-hairline ring-inset">
            <Field
              id="profile-street"
              labelText={t("street")}
              value={draft.street}
              onChange={(value) => set("street", value)}
              autoComplete="street-address"
              maxLength={200}
            />

            {/* Postcode en gemeente naast elkaar: ze horen bij elkaar en een
                postcode die de volle breedte krijgt ziet eruit als een veld
                waar meer in moet. */}
            <div className="mt-4 flex gap-3">
              <Field
                id="profile-postal-code"
                labelText={t("postalCode")}
                value={draft.postalCode}
                onChange={(value) => set("postalCode", value)}
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={20}
                className="w-28 shrink-0"
              />
              <Field
                id="profile-city"
                labelText={t("city")}
                value={draft.city}
                onChange={(value) => set("city", value)}
                autoComplete="address-level2"
                maxLength={120}
                className="min-w-0 flex-1"
              />
            </div>

            <Field
              id="profile-country"
              labelText={t("country")}
              value={draft.country}
              onChange={(value) => set("country", value.toUpperCase())}
              autoComplete="country"
              maxLength={2}
              placeholder="BE"
              className="mt-4 w-28"
            />
            <p
              className={cn(
                "mt-1 text-xs",
                countryValid ? "text-ink-faint" : "text-danger",
              )}
            >
              {countryValid ? t("countryHint") : t("countryInvalid")}
            </p>
          </div>
        </section>

        <section className="mt-6">
          <SectionLabel>{t("practitionerTitle")}</SectionLabel>
          <p className="mt-1.5 px-1 text-xs text-ink-muted">{t("practitionerIntro")}</p>

          {data.practitioners.length === 0 ? (
            <p className="mt-2 rounded-card bg-surface p-4 text-sm text-ink-faint shadow-card ring-1 ring-hairline ring-inset">
              {t("noPractitioners")}
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label={t("practitionerTitle")}
              className="mt-2 divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-hairline ring-inset"
            >
              {data.practitioners.map((practitioner) => (
                <Choice
                  key={practitioner.id}
                  name="practitioner"
                  checked={draft.practitionerId === practitioner.id}
                  onSelect={() => set("practitionerId", practitioner.id)}
                  initials={practitioner.initials}
                  title={practitioner.name}
                  subtitle={kindLabel(practitioner.kind)}
                />
              ))}

              {/* Een expliciete "nog niet gekozen" en geen kruisje bij de
                  gekozen naam: niemand kiezen is een geldige toestand, en dan
                  hoort er een knop voor te zijn in plaats van een manier om
                  iets ongedaan te maken. */}
              <Choice
                name="practitioner"
                checked={draft.practitionerId === ""}
                onSelect={() => set("practitionerId", "")}
                initials={null}
                title={t("noneLabel")}
                subtitle={t("noneHint")}
              />
            </div>
          )}
        </section>

        {error && (
          <p className="mt-4 rounded-card border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !countryValid}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
        >
          {busy ? t("saving") : saved ? t("saved") : t("save")}
          {saved && !busy && <CheckIcon className="size-4" />}
        </button>
      </form>

      {/* Buiten het formulier hierboven, met opzet. Het wachtwoord gaat naar
          Auth en niet naar het profiel-endpoint, en het heeft zijn eigen knop:
          één knop die twee dingen half kan doen is hier de verkeerde vorm. */}
      <ChangePassword email={data.email} />
    </main>
  );
}
