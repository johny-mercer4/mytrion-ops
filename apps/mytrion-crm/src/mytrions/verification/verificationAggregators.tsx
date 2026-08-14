/**
 * Payment aggregators on `dim_company.billing_type` (BANK / DIRECT / MERCHANT_CARD / ZELLE).
 * Icon + label; colour is a secondary cue so the same value is recognisable in light and dark.
 */
import type { CSSProperties, ReactNode } from 'react';
import { ArrowLeftRight, Building2, CreditCard, Landmark, Smartphone, type LucideIcon } from 'lucide-react';

export interface AggregatorMeta {
  label: string;
  tone: string;
  Icon: LucideIcon;
}

const AGGREGATORS: Record<string, AggregatorMeta> = {
  BANK: { label: 'Bank', tone: 'var(--tone-sky)', Icon: Landmark },
  DIRECT: { label: 'Direct', tone: 'var(--tone-emerald)', Icon: ArrowLeftRight },
  MERCHANT_CARD: { label: 'Merchant card', tone: 'var(--tone-amber)', Icon: CreditCard },
  ZELLE: { label: 'Zelle', tone: 'var(--tone-violet)', Icon: Smartphone },
};

export function aggregatorMeta(companyType: string): AggregatorMeta {
  return (
    AGGREGATORS[companyType] ?? {
      label: companyType.replace(/_/g, ' ') || 'Unknown',
      tone: 'var(--tone-slate)',
      Icon: Building2,
    }
  );
}

export function aggregatorTone(companyType: string): string {
  return aggregatorMeta(companyType).tone;
}

/** Compact mark: tinted glyph + visible name. Used on cards, chips, and the modal header. */
export function AggregatorMark({
  companyType,
  size = 12,
}: {
  companyType: string;
  size?: number;
}): ReactNode {
  if (!companyType) return null;
  const { label, tone, Icon } = aggregatorMeta(companyType);
  return (
    <span
      className="vf-agg"
      style={{ ['--vc' as string]: tone } as CSSProperties}
      title={label}
    >
      <span className="vf-agg-ico" aria-hidden="true">
        <Icon size={size} />
      </span>
      <span className="vf-agg-label">{label}</span>
    </span>
  );
}
