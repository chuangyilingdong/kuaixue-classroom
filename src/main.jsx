import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App.jsx";
import "./ui/desktop.css";
import "./ui/workshop.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

