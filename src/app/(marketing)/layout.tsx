import { MarketingNav } from "@/features/marketing/MarketingNav";
import { MarketingFooter } from "@/features/marketing/MarketingFooter";

// The public site: landing page plus the three explainer pages. Everything here is
// signed-out and indexable; the product itself lives under /dashboard and /admin, which
// have their own shells and are never listed in the sitemap.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      {/* Scroll-reveal hides content until JavaScript runs — without JavaScript, show it. */}
      <noscript>
        <style>{`.reveal{opacity:1!important;transform:none!important;filter:none!important}`}</style>
      </noscript>
      <MarketingNav />
      <main id="main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
