import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Award,
  BookOpenCheck,
  CalendarDays,
  Coins,
  Languages,
  MapPin,
  MonitorSmartphone,
  RefreshCcw,
  ScanSearch,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/features/marketing/Reveal";
import {
  CtaBand,
  DarkAtmosphere,
  MatchCardMock,
  PageHero,
  PhotoPanel,
  SectionHeading,
} from "@/features/marketing/primitives";

export const metadata: Metadata = {
  title: "Universities",
  description:
    "Programmes across the United Kingdom, Canada, Germany, Australia and the Netherlands — with entry requirements, tuition, intakes and deadlines stated on every one.",
};

const DESTINATIONS = [
  {
    country: "United Kingdom",
    cities: ["London", "Manchester", "Bristol"],
    image: "/marketing/city-london.jpg",
    blurb: "Bachelor's and master's programmes, each with its own intakes and deadlines listed.",
  },
  {
    country: "Canada",
    cities: ["Toronto", "Vancouver", "Calgary"],
    image: "/marketing/city-toronto.jpg",
    blurb: "Campus and online programmes; every one lists its own intake and application deadline.",
  },
  {
    country: "Germany",
    cities: ["Berlin", "Munich", "Hamburg"],
    image: "/marketing/city-berlin.jpg",
    blurb: "English-taught programmes with tuition and fees stated per programme.",
  },
  {
    country: "Australia",
    cities: ["Sydney", "Melbourne", "Brisbane"],
    image: "/marketing/city-sydney.jpg",
    blurb: "Every programme states its English minimum and its next open intake.",
  },
  {
    country: "Netherlands",
    cities: ["Amsterdam", "Rotterdam"],
    image: "/marketing/city-amsterdam.jpg",
    blurb: "English-taught degrees with the entry standard published on each programme.",
  },
];

const ON_EVERY_PROGRAMME = [
  { icon: BookOpenCheck, title: "Entry requirements", body: "The academic standard the programme states, in the grading system it uses." },
  { icon: Languages, title: "English requirement", body: "IELTS, TOEFL and equivalent minimums — overall and per band where the programme sets them." },
  { icon: Coins, title: "Tuition", body: "The published fee, its currency and the period it covers." },
  { icon: CalendarDays, title: "Intakes and deadlines", body: "Each upcoming intake, whether it is open, and the application deadline." },
  { icon: Award, title: "Scholarships", body: "Funding the programme or university lists, with eligibility notes." },
  { icon: RefreshCcw, title: "Freshness label", body: "When the data was last verified and where it came from — stale entries are flagged, not hidden." },
];

const LEVELS = ["Bachelor's", "Master's", "Graduate diplomas", "Certificates", "On campus", "Online and distance"];

const SEARCH_TOOLS = [
  { icon: Search, title: "Search by programme, university or field", body: "Type what you want to study and see every programme that matches, across all five countries." },
  { icon: SlidersHorizontal, title: "Filter by level, country, budget and delivery", body: "Narrow to what is realistic for you before you ever look at a score." },
  { icon: ScanSearch, title: "See your fit on every card", body: "Once you have run an assessment, each programme shows your zone and score inline." },
  { icon: MonitorSmartphone, title: "Works on your phone", body: "Every list, card and detail page is built for a small screen first." },
];

export default function UniversitiesPage() {
  return (
    <>
      <PageHero
        eyebrow="Universities"
        title={
          <>
            Five countries.
            <span className="text-shine block animate-gradient-x pb-2">Every requirement stated plainly.</span>
          </>
        }
        lead="Programmes across the United Kingdom, Canada, Germany, Australia and the Netherlands — each with entry requirements, English minimums, tuition, intakes and deadlines on the page, and a label that tells you when they were last verified."
        image="/marketing/campus-2.jpg"
        imagePosition="center 55%"
      >
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/signup">
            <Button size="lg" variant="secondary" className="bg-white text-primary shadow-xl hover:bg-white/90">
              Find your matches
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </PageHero>

      {/* ----------------------------------------------------- destinations -- */}
      <section className="px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeading
            eyebrow="Destinations"
            title="Where you can apply."
            lead="Each destination lists the cities with campuses in the catalog. Programme detail — and your fit — is one tap away once you have an account."
          />
          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {DESTINATIONS.map(({ country, cities, image, blurb }, i) => (
              <Reveal key={country} delay={i * 90} variant="scale">
                <article className="group relative h-full min-h-[22rem] overflow-hidden rounded-xl shadow-md transition-all duration-slow hover:-translate-y-1 hover:shadow-xl">
                  <Image
                    src={image}
                    alt={country}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                    className="object-cover transition-transform duration-[1600ms] group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-primary-900/90 via-primary-900/30 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-7 text-white">
                    <h3 className="text-2xl font-semibold">{country}</h3>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-white/75">{blurb}</p>
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {cities.map((c) => (
                        <li key={c} className="inline-flex items-center gap-1.5 rounded-full glass px-3 py-1 text-xs font-medium">
                          <MapPin className="h-3 w-3 text-secondary-200" aria-hidden />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              </Reveal>
            ))}
            <Reveal delay={450} variant="scale">
              <div className="flex h-full min-h-[22rem] flex-col justify-between rounded-xl border border-border bg-brand-gradient-soft p-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary-700">Levels covered</p>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {LEVELS.map((l) => (
                      <li key={l} className="rounded-full bg-white px-3 py-1 text-sm font-medium text-text-primary shadow-sm ring-1 ring-inset ring-border">
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-sm leading-relaxed text-text-secondary">
                  Not sure which level is right? Your assessment scores programmes at every level you
                  are eligible for, so you can compare them side by side.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- on every card -- */}
      <section className="relative overflow-hidden bg-primary px-5 py-24 text-white sm:px-8 lg:py-32">
        <DarkAtmosphere image="/marketing/library-aisle.jpg" dim={0.88} />
        <div className="relative mx-auto grid w-full max-w-7xl gap-14 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <SectionHeading
              tone="light"
              eyebrow="On every programme"
              title="The facts you would otherwise chase across six websites."
              lead="Everything a consultant would look up for you — written on the programme itself, in one format, for every programme."
            />
            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              {ON_EVERY_PROGRAMME.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={i * 70} variant="up">
                  <div className="h-full rounded-lg glass p-5">
                    <Icon className="h-5 w-5 text-secondary-200" aria-hidden />
                    <p className="mt-3 text-sm font-semibold">{title}</p>
                    <p className="mt-1 text-sm text-white/60">{body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <div className="relative flex justify-center lg:justify-end">
            <Reveal variant="scale" delay={150}>
              <div className="animate-float-slow">
                <MatchCardMock
                  zone="TARGET"
                  score={66}
                  programme="MSc Mechanical Engineering"
                  university="Riverbend Institute of Technology"
                  place="Manchester, United Kingdom"
                  tuition="£21,000 / year"
                  deadline="Intake: September"
                  factors={[
                    { label: "Academic", value: 72 },
                    { label: "English", value: 64 },
                    { label: "Budget", value: 58 },
                    { label: "Programme fit", value: 81 },
                  ]}
                />
              </div>
            </Reveal>
            <div className="pointer-events-none absolute -bottom-10 right-0 hidden w-64 animate-float rounded-lg border border-white/60 bg-white/95 px-4 py-3 text-text-primary shadow-xl backdrop-blur lg:block" aria-hidden>
              <p className="text-xs font-semibold">Data verified 3 weeks ago</p>
              <p className="text-[11px] text-text-secondary">Source: university programme page</p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- explore -- */}
      <section className="px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto grid w-full max-w-7xl items-center gap-14 lg:grid-cols-2">
          <Reveal variant="left">
            <PhotoPanel
              src="/marketing/students-class.jpg"
              alt="Students in a classroom"
              className="aspect-[4/3]"
              caption={<span className="text-sm text-white/85">Search, filter, compare — then see your fit on every card.</span>}
            />
          </Reveal>
          <div>
            <SectionHeading
              eyebrow="Exploring the catalog"
              title="Browse first. Score second. Decide third."
              lead="You do not need an assessment to look around. Once you have one, the catalog turns into a personal shortlist."
            />
            <ul className="mt-10 space-y-6">
              {SEARCH_TOOLS.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={100 + i * 90} variant="right">
                  <li className="flex gap-4">
                    <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-gradient-soft ring-1 ring-inset ring-secondary-200">
                      <Icon className="h-5 w-5 text-secondary-700" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-semibold text-text-primary">{title}</span>
                      <span className="mt-1 block text-sm leading-relaxed text-text-secondary">{body}</span>
                    </span>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <CtaBand
        title="See which of these programmes fit you."
        lead="Run a free assessment and every programme in the catalog gets a score, a zone and a reason."
      />
    </>
  );
}
