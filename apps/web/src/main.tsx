import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ClearanceProvider } from "./state/clearance";
import { ToastProvider } from "./components/ui";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ClearanceProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ClearanceProvider>
    </BrowserRouter>
  </React.StrictMode>
);
