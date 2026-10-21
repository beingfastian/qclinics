import { Component } from "react";
import { useLocation } from "react-router-dom";

// Catches a crash while drawing a screen (e.g. a record with a missing field) so the
// staff app shows a message with a way out instead of a blank white page mid-shift.
// resetKey: when it changes (another page opened), the screen is tried again.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidMount() {
    this.reloadIfStale = (error) => {
      // A page's code file from the previous version is gone after a new deploy:
      // reload once (not in a loop) to get the current version.
      if (!/dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(String(error?.message))) return false;
      try {
        const last = Number(sessionStorage.getItem("staleReloadAt") || 0);
        if (Date.now() - last < 30000) return false;
        sessionStorage.setItem("staleReloadAt", String(Date.now()));
      } catch {
        return false;
      }
      window.location.reload();
      return true;
    };
  }

  componentDidCatch(error, info) {
    if (this.reloadIfStale?.(error)) return;
    console.error("Screen crashed:", error, info?.componentStack);
  }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const whole = this.props.whole;
    return (
      <div role="alert" className={whole ? "min-h-screen flex items-center justify-center bg-slate-50 p-6" : "p-6"}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong on this screen</h1>
          <p className="mt-2 text-sm text-slate-600">
            Nothing was lost. Reload to try again{whole ? "" : ", or open another page from the menu"}. If it keeps happening, tell your administrator what you were doing.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => window.location.assign("/")}
              className="rounded-lg border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50"
            >
              Go to the start
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-primary-700 px-4 py-2 font-medium text-white hover:bg-primary-800"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// One screen inside the app: reset when the page changes
export const PageBoundary = ({ children }) => {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
};
