import { useEffect, useState } from "react";
import { FaBars, FaPhoneAlt, FaTimes, FaWhatsapp } from "react-icons/fa";
import { PRODUCT_NAME, STAFF_APP_URL } from "../config";
import { useLanguage } from "../i18n";
import { ButtonLink, Container, Logo, cx, telUrl, whatsappUrl } from "./site";

export const SECTIONS = [
  { id: "features", key: "nav.features" },
  { id: "pakistan", key: "nav.pakistan" },
  { id: "how", key: "nav.how" },
  { id: "faq", key: "nav.faq" },
];

const Navbar = () => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const link = "rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <Container className="flex h-16 items-center justify-between gap-3">
        <a href="#top" aria-label={PRODUCT_NAME} className="py-1">
          <Logo />
        </a>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={link}>
                  {t(s.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          {STAFF_APP_URL && (
            <a href={STAFF_APP_URL} className={cx(link, "hidden xl:inline-flex")}>
              {t("nav.staff")}
            </a>
          )}
          <ButtonLink href={whatsappUrl(t("wa.demo", { product: PRODUCT_NAME }))} external variant="primary" icon={<FaWhatsapp />} className="hidden md:inline-flex h-10">
            {t("action.demoShort")}
          </ButtonLink>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? t("nav.close") : t("nav.menu")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden"
          >
            {open ? <FaTimes aria-hidden="true" /> : <FaBars aria-hidden="true" />}
          </button>
        </div>
      </Container>

      {open && (
        <div id="site-menu" className="border-t border-slate-200 bg-white lg:hidden">
          <Container className="py-3">
            <ul className="flex flex-col gap-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} onClick={() => setOpen(false)} className={cx(link, "block px-4 py-3 text-base")}>
                    {t(s.key)}
                  </a>
                </li>
              ))}
              {STAFF_APP_URL && (
                <li>
                  <a href={STAFF_APP_URL} className={cx(link, "block px-4 py-3 text-base")}>
                    {t("nav.staff")}
                  </a>
                </li>
              )}
            </ul>
          </Container>
        </div>
      )}
    </header>
  );
};

// Phones: Call and Book a demo always one tap away at the bottom of the screen
export const MobileActionBar = () => {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white p-3 md:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <div className="grid grid-cols-2 gap-2">
        <ButtonLink href={telUrl} variant="secondary" icon={<FaPhoneAlt />}>
          {t("action.callShort")}
        </ButtonLink>
        <ButtonLink href={whatsappUrl(t("wa.demo", { product: PRODUCT_NAME }))} external variant="primary" icon={<FaWhatsapp />}>
          {t("action.demoShort")}
        </ButtonLink>
      </div>
    </div>
  );
};

export default Navbar;
