// Runs after `vite build` (see package.json "build"). Turns the single-page app into
// real HTML pages so search engines and WhatsApp/Facebook previews see the content:
//   dist/index.html     English home ("/")
//   dist/404.html       not-found page (served with status 404 by the host)
//   dist/app.html       empty shell for the queue screens (not indexed)
//   dist/robots.txt, dist/sitemap.xml
// Absolute addresses (canonical, sitemap, share image) need the site's
// address: VITE_SITE_URL, or Vercel's production address. Without one they are left out.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const ssrDir = path.join(root, "dist-ssr");

const env = { ...loadEnv("production", root, "VITE_"), ...process.env };
const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL || "";
const SITE = (env.VITE_SITE_URL || (vercelHost ? `https://${vercelHost}` : "")).replace(/\/+$/, "");

const ssr = await import(pathToFileURL(path.join(ssrDir, "entry-server.js")).href);
const { render, STRINGS, LANGUAGES, PRODUCT_NAME, PRODUCT_TAGLINE, SALES_EMAIL, SALES_PHONE } = ssr;

const template = fs.readFileSync(path.join(dist, "index.html"), "utf-8");
const abs = (p) => (SITE ? SITE + (p === "/" ? "/" : p) : "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// JSON-LD inside <script>: never let text close the tag
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

const structuredData = (lang) => {
  const t = STRINGS[lang];
  const home = abs(LANGUAGES[lang].path);
  const org = {
    "@type": "Organization",
    "@id": SITE ? `${SITE}/#organization` : undefined,
    name: PRODUCT_NAME,
    slogan: PRODUCT_TAGLINE,
    url: SITE ? `${SITE}/` : undefined,
    logo: SITE ? `${SITE}/icon-192.png` : undefined,
    email: SALES_EMAIL,
    telephone: SALES_PHONE,
    contactPoint: { "@type": "ContactPoint", telephone: SALES_PHONE, email: SALES_EMAIL, contactType: "sales", areaServed: "PK", availableLanguage: ["en", "ur"] },
  };
  const faq = [1, 2, 3, 4, 5, 6].map((n) => ({
    "@type": "Question",
    name: t[`faq.q${n}`],
    acceptedAnswer: { "@type": "Answer", text: t[`faq.a${n}`] },
  }));
  return jsonLd({
    "@context": "https://schema.org",
    "@graph": [
      org,
      { "@type": "WebSite", name: PRODUCT_NAME, url: home || undefined, inLanguage: lang, publisher: SITE ? { "@id": `${SITE}/#organization` } : undefined },
      {
        "@type": "SoftwareApplication",
        name: PRODUCT_NAME,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Hospital and clinic management",
        operatingSystem: "Web browser",
        description: t["meta.description"],
        inLanguage: "en",
        areaServed: "PK",
        publisher: SITE ? { "@id": `${SITE}/#organization` } : org.name,
      },
      { "@type": "FAQPage", inLanguage: lang, mainEntity: faq },
    ],
  });
};

const headFor = ({ lang, url, indexable }) => {
  const t = STRINGS[lang];
  const title = indexable ? t["meta.title"] : `${t["notFound.title"]} | ${PRODUCT_NAME}`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(t["meta.description"])}" />`,
    `<meta name="robots" content="${indexable ? "index, follow, max-image-preview:large" : "noindex, follow"}" />`,
  ];
  if (indexable && SITE) {
    tags.push(
      `<link rel="canonical" href="${abs(url)}" />`
    );
  }
  if (indexable) {
    tags.push(
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${esc(PRODUCT_NAME)}" />`,
      `<meta property="og:title" content="${esc(t["meta.title"])}" />`,
      `<meta property="og:description" content="${esc(t["meta.description"])}" />`,
      `<meta property="og:locale" content="${LANGUAGES[lang].locale}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${esc(t["meta.title"])}" />`,
      `<meta name="twitter:description" content="${esc(t["meta.description"])}" />`
    );
    if (SITE) {
      tags.push(
        `<meta property="og:url" content="${abs(url)}" />`,
        `<meta property="og:image" content="${SITE}/og-image.png" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta property="og:image:alt" content="${esc(`${PRODUCT_NAME}: ${PRODUCT_TAGLINE}`)}" />`,
        `<meta name="twitter:image" content="${SITE}/og-image.png" />`
      );
    }
    tags.push(structuredData(lang));
  }
  return tags.join("\n    ");
};

const SEO_BLOCK = /<!--seo:start[\s\S]*?<!--seo:end-->/;
const URDU_FONT = /<!--urdu-font:start-->([\s\S]*?)<!--urdu-font:end-->/;

const page = ({ url, lang, file, indexable = true }) => {
  let html = template
    .replace(/<html[^>]*>/, `<html lang="${lang}" dir="${LANGUAGES[lang].dir}" class="scroll-smooth">`)
    .replace(SEO_BLOCK, headFor({ lang, url, indexable }))
    .replace('<div id="root"></div>', `<div id="root">${render(url)}</div>`);
  // The marketing pages are English only: the Urdu font is just for the queue screens
  html = html.replace(URDU_FONT, "").replace("&family=Noto+Nastaliq+Urdu:wght@400;600", "");
  const out = path.join(dist, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`prerendered ${url} -> dist/${file}`);
};

page({ url: "/", lang: "en", file: "index.html" });
page({ url: "/404", lang: "en", file: "404.html", indexable: false });

// Queue screens: empty shell, never indexed (vercel.json also sends X-Robots-Tag)
fs.writeFileSync(
  path.join(dist, "app.html"),
  template
    .replace(SEO_BLOCK, `<title>${esc(PRODUCT_NAME)}</title>\n    <meta name="robots" content="noindex, nofollow" />`)
    .replace(URDU_FONT, "$1")
);

const robots = ["User-agent: *", "Allow: /", "Disallow: /queue", "Disallow: /app.html"];
if (SITE) robots.push("", `Sitemap: ${SITE}/sitemap.xml`);
fs.writeFileSync(path.join(dist, "robots.txt"), robots.join("\n") + "\n");

if (SITE) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = `  <url>
    <loc>${abs("/")}</loc>
    <lastmod>${today}</lastmod>
  </url>`;
  fs.writeFileSync(
    path.join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
  console.log(`sitemap.xml and canonical links use ${SITE}`);
} else {
  console.warn(
    "\n⚠ No site address (VITE_SITE_URL, or Vercel's production URL): canonical links,\n" +
      "  sitemap.xml and share-image tags were left out. Set VITE_SITE_URL once there is a domain.\n"
  );
}

fs.rmSync(ssrDir, { recursive: true, force: true });
