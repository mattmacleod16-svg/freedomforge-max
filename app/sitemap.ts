import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://freedomforge.one';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    // ── Core ───────────────────────────────────────────────────────────────────
    { url: SITE_URL,                          lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${SITE_URL}/advisor`,             lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${SITE_URL}/intelligence`,        lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${SITE_URL}/ai-models`,           lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE_URL}/token`,               lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },

    // ── Finance & Trading ─────────────────────────────────────────────────────
    { url: `${SITE_URL}/trading`,             lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${SITE_URL}/vault`,               lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${SITE_URL}/dashboard`,           lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${SITE_URL}/autonomy`,            lastModified: now, changeFrequency: 'daily',   priority: 0.8 },

    // ── AI & Intelligence ──────────────────────────────────────────────────────
    { url: `${SITE_URL}/genie`,               lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/discover`,            lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/skills`,              lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/marketing`,           lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },

    // ── Specialized Tools ──────────────────────────────────────────────────────
    { url: `${SITE_URL}/life`,                lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/industrial`,          lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/watchdog`,            lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/cipher-lab`,          lastModified: now, changeFrequency: 'monthly', priority: 0.7 },

    // ── Auth ───────────────────────────────────────────────────────────────────
    { url: `${SITE_URL}/login`,               lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];
}
