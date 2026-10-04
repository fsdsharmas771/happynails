import "./zod-config";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@happynails/ui/tokens.css";
import "@happynails/ui/base.css";
import "@happynails/ui/forms.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
