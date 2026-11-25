import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

const root = document.getElementById("root");
const app = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

// "/" and the 404 page arrive already rendered (scripts/prerender.mjs):
// take them over instead of drawing them again. Other screens start empty.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
