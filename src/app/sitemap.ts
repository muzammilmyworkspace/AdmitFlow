import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

// Only the public surfaces. A sitemap listing authenticated routes would advertise the
// shape of the private application to anyone who asks for it, and gains nothing —
// those pages redirect to /login for a crawler anyway.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getEnv().NEXT_PUBLIC_APP_URL;
  const now = new Date();
  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
