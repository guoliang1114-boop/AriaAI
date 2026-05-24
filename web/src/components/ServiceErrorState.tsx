import type { ReactNode } from "react";
import { AlertCircle, ServerCrash } from "lucide-react";

interface ServiceErrorAction {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

interface ServiceErrorLink {
  description: string;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
}

export function ServiceErrorState({
  actions,
  badge,
  description,
  detail,
  detailLabel = "Error detail",
  hintTitle,
  hints,
  links = [],
  linksTitle = "Quick links",
  serviceUnavailable = false,
  title,
}: {
  actions: ServiceErrorAction[];
  badge: string;
  description: string;
  detail?: string | null;
  detailLabel?: string;
  hintTitle: string;
  hints: string[];
  links?: ServiceErrorLink[];
  linksTitle?: string;
  serviceUnavailable?: boolean;
  title: string;
}) {
  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.14),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)]">
      <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl items-center px-6 py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[1.12fr_0.88fr]">
          <section className="rounded-[32px] border border-white/80 bg-white/92 p-8 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.28)] backdrop-blur">
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              serviceUnavailable ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
            }`}>
              {serviceUnavailable ? <ServerCrash className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {badge}
            </div>
            <h1 className="mt-6 text-2xl font-semibold text-slate-950">{title}</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{description}</p>

            {detail ? (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <div className="font-medium text-slate-900">{detailLabel}</div>
                <div className="mt-1 break-words">{detail}</div>
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className={action.variant === "secondary"
                    ? "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    : "inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary/90"}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-[32px] border border-white/80 bg-white/82 p-6 shadow-sm backdrop-blur">
              <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${
                serviceUnavailable ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"
              }`}>
                {serviceUnavailable ? <ServerCrash className="h-6 w-6" /> : <AlertCircle className="h-6 w-6" />}
              </div>
              <h2 className="text-lg font-semibold text-slate-950">{hintTitle}</h2>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                {hints.map((hint) => (
                  <p key={hint}>{hint}</p>
                ))}
              </div>
            </div>

            {links.length ? (
              <div className="rounded-[32px] border border-white/80 bg-white/82 p-6 shadow-sm backdrop-blur">
                <h3 className="text-sm font-semibold text-slate-500">{linksTitle}</h3>
                <div className="mt-4 grid gap-3">
                  {links.map((link) => (
                    <button
                      key={link.label}
                      type="button"
                      onClick={link.onClick}
                      className="rounded-2xl border border-slate-100 bg-white px-4 py-4 text-left transition hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-950">
                        {link.icon}
                        {link.label}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{link.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
