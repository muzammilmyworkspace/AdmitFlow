import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/StatusScreen";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StatusScreen
      icon={Compass}
      eyebrow="404"
      title="We couldn't find that page"
      description="The link may be out of date, or the page may have moved. Nothing is wrong with your account."
    >
      <Link href="/dashboard">
        <Button>Back to your dashboard</Button>
      </Link>
      <Link href="/">
        <Button variant="ghost">Go to the homepage</Button>
      </Link>
    </StatusScreen>
  );
}
