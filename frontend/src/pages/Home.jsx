import {
  FaArrowRight,
  FaCalendarCheck,
  FaCheck,
  FaClipboardList,
  FaEnvelope,
  FaFlask,
  FaListOl,
  FaMobileAlt,
  FaPhoneAlt,
  FaPrint,
  FaUserClock,
  FaUsers,
  FaWallet,
  FaWhatsapp,
} from "react-icons/fa";
import { PRODUCT_NAME, SALES_EMAIL } from "../config";
import { useLanguage } from "../i18n";
import { ButtonLink, Container, Latin, telUrl, whatsappUrl } from "../components/site";

// What the product looks like, without screenshots: the waiting-room screen and
// the WhatsApp message a patient gets (light to load on mobile data)
const ProductPreview = () => {
  const { t } = useLanguage();
  return (
    <div className="relative" aria-hidden="true">
      <div className="rounded-2xl bg-slate-900 p-5 text-white shadow-lg" dir="ltr">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t("mock.board")}</p>
        <p className="mt-3 text-sm text-slate-300">
          <Latin>{t("mock.doctor")}</Latin>
        </p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-slate-400">{t("mock.now")}</p>
            <p className="font-display text-6xl font-bold tabular-nums leading-none">
              <Latin>12</Latin>
            </p>
          </div>
          <div className="text-end">
            <p className="text-xs text-slate-400">{t("mock.next")}</p>
            <p className="mt-1 flex gap-2 font-display text-2xl font-semibold tabular-nums text-primary-200">
              <Latin>13</Latin>
              <Latin>14</Latin>
              <Latin>15</Latin>
            </p>
          </div>
        </div>
      </div>
      <div className="relative -mt-4 ms-8 max-w-xs rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-4 shadow-lg sm:ms-16">
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-800">
          <FaWhatsapp /> {t("mock.whatsapp")}
        </p>
        <p className="mt-2 text-sm text-slate-900">
          {t("mock.message")}
        </p>
        <p className="mt-2 text-xs font-medium text-primary-800">{t("mock.track")} →</p>
      </div>
    </div>
  );
};

const SectionHeading = ({ title, lead }) => (
  <div className="mb-8 max-w-2xl">
    <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h2>
    {lead && <p className="mt-2 text-slate-600">{lead}</p>}
  </div>
);

const FEATURES = [
  { key: "queue", icon: <FaListOl /> },
  { key: "track", icon: <FaMobileAlt /> },
  { key: "whatsapp", icon: <FaWhatsapp /> },
  { key: "appointments", icon: <FaCalendarCheck /> },
  { key: "lab", icon: <FaFlask /> },
  { key: "earnings", icon: <FaWallet /> },
  { key: "schedule", icon: <FaClipboardList /> },
  { key: "slips", icon: <FaPrint /> },
];

const Home = () => {
  const { t } = useLanguage();
  const demoUrl = whatsappUrl(t("wa.demo", { product: PRODUCT_NAME }));

  return (
    <>
      {/* Hero */}
      <section id="top" className="border-b border-slate-200 bg-white">
        <Container className="grid items-center gap-12 py-12 md:py-16 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="text-sm font-semibold text-primary-800">{t("hero.kicker")}</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">{t("hero.title")}</h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">{t("hero.lead")}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href={demoUrl} external variant="primary" size="lg" icon={<FaWhatsapp />}>
                {t("action.demo")}
              </ButtonLink>
              <ButtonLink href="#features" variant="secondary" size="lg">
                {t("action.see")} <FaArrowRight aria-hidden="true" className="rtl:rotate-180" />
              </ButtonLink>
            </div>
            <ul className="mt-7 space-y-2 text-sm text-slate-700">
              {["hero.point1", "hero.point2", "hero.point3"].map((key) => (
                <li key={key} className="flex items-center gap-2">
                  <FaCheck aria-hidden="true" className="shrink-0 text-primary-700" /> {t(key)}
                </li>
              ))}
            </ul>
          </div>
          <ProductPreview />
        </Container>
      </section>

      {/* Problems */}
      <section className="py-14">
        <Container>
          <SectionHeading title={t("problems.title")} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { key: "problems.p1", icon: <FaUsers /> },
              { key: "problems.p2", icon: <FaUserClock /> },
              { key: "problems.p3", icon: <FaFlask /> },
              { key: "problems.p4", icon: <FaWallet /> },
            ].map((p) => (
              <li key={p.key} className="rounded-xl border border-slate-200 bg-white p-5">
                <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  {p.icon}
                </span>
                <p className="mt-3 text-slate-800">{t(p.key)}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 border-y border-slate-200 bg-white py-14">
        <Container>
          <SectionHeading title={t("features.title")} lead={t("features.lead")} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.key} className="rounded-xl border border-slate-200 p-5">
                <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-lg text-primary-700">
                  {f.icon}
                </span>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">{t(`f.${f.key}.title`)}</h3>
                <p className="mt-1 text-sm text-slate-600">{t(`f.${f.key}.text`)}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Built for Pakistan */}
      <section id="pakistan" className="scroll-mt-20 py-14">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <SectionHeading title={t("pk.title")} />
          <ul className="space-y-3">
            {["pk.p1", "pk.p2", "pk.p3", "pk.p4", "pk.p5"].map((key) => (
              <li key={key} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <FaCheck aria-hidden="true" className="mt-1 shrink-0 text-primary-700" />
                <span className="text-slate-800">{t(key)}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 border-y border-slate-200 bg-white py-14">
        <Container>
          <SectionHeading title={t("how.title")} />
          <ol className="grid gap-4 md:grid-cols-3">
            {["s1", "s2", "s3"].map((step, i) => (
              <li key={step} className="rounded-xl border border-slate-200 p-5">
                <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                  <Latin>{i + 1}</Latin>
                </span>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">{t(`how.${step}.title`)}</h3>
                <p className="mt-1 text-sm text-slate-600">{t(`how.${step}.text`)}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 py-14">
        <Container className="max-w-3xl">
          <SectionHeading title={t("faq.title")} />
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <details key={n} className="group p-5">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-medium text-slate-900">
                  {t(`faq.q${n}`)}
                  <span aria-hidden="true" className="shrink-0 text-xl text-slate-500 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-slate-600">{t(`faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>

      {/* Call to action */}
      <section id="contact" className="scroll-mt-20 bg-primary-900 py-14 text-white">
        <Container className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("cta.title")}</h2>
            <p className="mt-2 text-primary-100">{t("cta.text")}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={demoUrl} external variant="onDark" size="lg" icon={<FaWhatsapp />}>
              {t("action.demo")}
            </ButtonLink>
            <ButtonLink href={telUrl} variant="outlineDark" size="lg" icon={<FaPhoneAlt />}>
              {t("action.call")}
            </ButtonLink>
            {SALES_EMAIL && (
              <ButtonLink href={`mailto:${SALES_EMAIL}`} variant="outlineDark" size="lg" icon={<FaEnvelope />}>
                {t("action.email")}
              </ButtonLink>
            )}
          </div>
        </Container>
      </section>
    </>
  );
};

export default Home;
