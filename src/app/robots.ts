import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

// Everything a signed-in student touches is private, and none of it should ever be
// crawled or indexed — the disallow list is the whole authenticated surface plus the
// API. The marketing pages are the only thing a search engine has any business seeing.
export default function robots(): MetadataRoute.Robots {
  const base = getEnv().NEXT_PUBLIC_APP_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard/", "/admin/", "/onboarding", "/billing/", "/verify-email"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
