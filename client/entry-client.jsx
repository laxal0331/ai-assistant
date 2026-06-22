import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./components/App";
import MobilePage from "./components/MobilePage";
import "./base.css";

function getMobileSessionId() {
  const match = window.location.pathname.match(/^\/m\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

const mobileSessionId = getMobileSessionId();
const root = document.getElementById("root");

ReactDOM.hydrateRoot(
  root,
  <StrictMode>
    {mobileSessionId ? <MobilePage sessionId={mobileSessionId} /> : <App />}
  </StrictMode>,
);
