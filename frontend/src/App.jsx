import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home.jsx";
import NotFound from "./pages/NotFound.jsx";
import Navbar, { MobileActionBar } from "./components/Navbar.jsx";
import Footer from "./components/Footer.jsx";
import { LanguageProvider, langFromPath } from "./i18n.jsx";

// Queue screens (waiting-room TV, a patient's token link) are only for the
// running hospital: loaded on demand, so the marketing page stays light
const QueueBoard = lazy(() => import("./pages/queue/QueueBoard.jsx"));
const QueueTrack = lazy(() => import("./pages/queue/QueueTrack.jsx"));

const App = () => {
  const { pathname } = useLocation();

  if (pathname === "/queue" || pathname.startsWith("/queue/")) {
    // These screens are bilingual already (Urdu lines carry their own dir/lang),
    // so they keep their own layout
    return (
      <div dir="ltr" lang="en" className="font-sans leading-normal">
        <Suspense fallback={null}>
          <Routes>
            <Route path="/queue" element={<QueueBoard />} />
            <Route path="/queue/t/:publicId" element={<QueueTrack />} />
            <Route path="*" element={<QueueBoard />} />
          </Routes>
        </Suspense>
      </div>
    );
  }

  const lang = langFromPath(pathname);
  return (
    <LanguageProvider lang={lang}>
      <div className="flex min-h-screen flex-col pb-20 md:pb-0">
        <Navbar />
        <main id="main" className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            {/* Old patient-site pages: the host sends a permanent redirect (vercel.json);
                this covers local development */}
            {["/ur", "/ur/*", "/doctors", "/doctors/*", "/about", "/contact"].map((path) => (
              <Route key={path} path={path} element={<Navigate to="/" replace />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
        <MobileActionBar />
      </div>
    </LanguageProvider>
  );
};

export default App;
