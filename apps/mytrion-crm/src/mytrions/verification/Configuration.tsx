import { useState } from 'react';
import { Layers, ShieldCheck, SlidersHorizontal } from 'lucide-react';

import { ToastViewport, useToast } from './Toast';
import { FINANCIAL_HARD_STOPS, LIMIT_POLICY_RULES, TIERS, VENDOR_TOGGLES, type VendorToggle } from './data';

export function Configuration() {
  const [vendors, setVendors] = useState<VendorToggle[]>(VENDOR_TOGGLES);
  const { toast, show } = useToast();

  function toggleVendor(id: string) {
    setVendors((prev) =>
      prev.map((v) => {
        if (v.id !== id) return v;
        const next = { ...v, on: !v.on };
        show(next.on ? 'success' : 'info', `${v.name} ${next.on ? 'enabled' : 'disabled'}.`);
        return next;
      }),
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h2 className="font-heading text-2xl font-bold">Configuration</h2>
        <p className="text-sm text-muted-foreground">Vendor integrations, hard-stop thresholds & policy rules from SOP v3.3</p>
      </div>

      <section>
        <SectionHeader icon={ShieldCheck} title="Vendor Integrations" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((v) => (
            <VendorCard key={v.id} vendor={v} onToggle={() => toggleVendor(v.id)} />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ThresholdTable icon={SlidersHorizontal} title="Financial Hard-Stops" rows={FINANCIAL_HARD_STOPS} />
        <ThresholdTable icon={Layers} title="Limit & Policy Rules" rows={LIMIT_POLICY_RULES} />
      </div>

      <section>
        <SectionHeader icon={ShieldCheck} title="Tier Classification" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.id} className="rounded-xs border bg-card p-4" style={{ borderTopWidth: 3, borderTopColor: t.color }}>
              <div className="font-heading text-sm font-bold">{t.label}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <ToastViewport toast={toast} />
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: typeof ShieldCheck; title: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <Icon className="size-4 text-primary" />
      <span className="font-heading text-sm font-bold">{title}</span>
    </div>
  );
}

function VendorCard({ vendor, onToggle }: { vendor: VendorToggle; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xs border bg-card p-3.5">
      <div className="flex items-center gap-2.5">
        <span className={`size-2 flex-none rounded-full ${vendor.on ? 'bg-good' : 'bg-muted-foreground/40'}`} />
        <div>
          <div className="text-sm font-semibold">{vendor.name}</div>
          <div className="text-[11px] text-muted-foreground">{vendor.desc}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={vendor.on}
        aria-label={`Toggle ${vendor.name}`}
        className={`relative h-5 w-9 flex-none rounded-full transition-colors ${vendor.on ? 'bg-good' : 'bg-muted-foreground/30'}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${
            vendor.on ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function ThresholdTable({
  icon: Icon,
  title,
  rows,
}: {
  icon: typeof ShieldCheck;
  title: string;
  rows: { label: string; value: string; hint: string }[];
}) {
  return (
    <div className="rounded-xs border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Icon className="size-4 text-primary" />
        <span className="font-heading text-sm font-bold">{title}</span>
      </div>
      <div>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-b-0">
            <div className="min-w-0">
              <div className="font-medium">{r.label}</div>
              {r.hint ? <div className="text-[11px] text-muted-foreground">{r.hint}</div> : null}
            </div>
            <span className="flex-none rounded-xs border bg-secondary px-2 py-0.5 font-mono text-xs font-semibold text-secondary-foreground">
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
