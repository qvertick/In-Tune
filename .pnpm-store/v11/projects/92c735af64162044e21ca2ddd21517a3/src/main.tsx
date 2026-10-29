import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";
import "./style.css";
import { NAV_KEYS, readSetting } from "./navigation";
document.documentElement.dataset.theme =
  readSetting(NAV_KEYS.theme) === "light" ? "light" : "dark";
document.title = "In Tune / В Лад";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
