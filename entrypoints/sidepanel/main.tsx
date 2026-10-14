import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "../../src/ui/theme.css";

const rootEl = document.getElementById("root");
if (rootEl === null) throw new Error("sidepanel: missing #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
