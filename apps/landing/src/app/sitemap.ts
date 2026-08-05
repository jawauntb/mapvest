import type { MetadataRoute } from 'next';
import { listDocs } from '../lib/docs';

const SITE_URL = 'https://mapvest.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/docs`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  for (const doc of listDocs()) {
    entries.push({
      url: `${SITE_URL}/docs/${doc.slug}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  return entries;
}
