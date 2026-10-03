export const LOW_SAMPLE_VIEWS = 30;

/** Below this many views a conversion rate is mostly noise: one extra lead moves it by several points. */
export const lowSample = (s) => (s?.views ?? 0) < LOW_SAMPLE_VIEWS;

export const conversionLabel = (s) => (s?.conversionRate == null ? "—" : `${(s.conversionRate * 100).toFixed(1).replace(/\.0$/, "")}%`);
