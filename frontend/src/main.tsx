import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import { APP_NAME } from "./config";
document.title = APP_NAME;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
