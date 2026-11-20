/* Karlo's plans for clients (each client is a workspace). Prices are per person per month, in USD. */

export type PlanId = 'trial' | 'starter' | 'pro' | 'business';
export type Feature =
  | 'timeline'
  | 'dashboard'
  | 'map'
  | 'time'
  | 'automation'
  | 'smartHelp'
  | 'calendarSync'
  | 'money'
  | 'whiteLabel';

export const PLANS: Record<PlanId, { label: string; price: number; storageGb: number; features: Feature[]; color: string }> = {
  trial: { label: 'Trial', price: 0, storageGb: 2, features: ['timeline', 'dashboard', 'map', 'time', 'automation', 'smartHelp', 'calendarSync', 'money'], color: '#8f5af7' },
  starter: { label: 'Starter', price: 3, storageGb: 2, features: [], color: '#0891b2' },
  pro: { label: 'Pro', price: 6, storageGb: 20, features: ['timeline', 'dashboard', 'map', 'time', 'automation', 'smartHelp', 'calendarSync', 'money'], color: '#0c66e4' },
  business: {
    label: 'Business',
    price: 10,
    storageGb: 100,
    features: ['timeline', 'dashboard', 'map', 'time', 'automation', 'smartHelp', 'calendarSync', 'money', 'whiteLabel'],
    color: '#1f845a',
  },
};
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export const FEATURE_LABEL: Record<Feature, string> = {
  timeline: 'Timeline view',
  dashboard: 'Dashboard view',
  map: 'Map view',
  time: 'Time tracking',
  automation: 'Automation',
  smartHelp: 'Smart help',
  calendarSync: 'Google Calendar sync',
  money: 'Money tool',
  whiteLabel: 'Your own name & logo',
};

export const hasFeature = (plan: PlanId | undefined, f: Feature) => (plan ? PLANS[plan].features.includes(f) : true);

export interface Billing {
  plan: PlanId;
  status: 'active' | 'suspended';
  trial_ends_at: string | null;
  paid_until: string | null;
}

const DAY = 86_400_000;
const GRACE_DAYS = 3;

/** What people in the workspace can do right now, and a short line to show about it. */
export function access(b: Billing, now = Date.now()): { state: 'ok' | 'ending' | 'readonly' | 'suspended'; daysLeft: number | null; label: string } {
  if (b.status === 'suspended') return { state: 'suspended', daysLeft: null, label: 'Suspended' };
  const end = b.plan === 'trial' ? b.trial_ends_at : b.paid_until;
  if (!end) return { state: 'ok', daysLeft: null, label: b.plan === 'trial' ? 'Trial' : 'No end date' };
  const t = new Date(end).getTime() + (b.plan === 'trial' ? 0 : GRACE_DAYS * DAY);
  const days = Math.ceil((new Date(end).getTime() - now) / DAY);
  if (t <= now) return { state: 'readonly', daysLeft: days, label: b.plan === 'trial' ? 'Trial ended' : 'Payment overdue' };
  if (days <= 0) return { state: 'ending', daysLeft: 0, label: 'Overdue — grace period' };
  const what = b.plan === 'trial' ? 'trial left' : 'left';
  return { state: days <= 7 ? 'ending' : 'ok', daysLeft: days, label: `${days} day${days === 1 ? '' : 's'} ${what}` };
}

export const formatBytes = (n: number) =>
  n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`;
