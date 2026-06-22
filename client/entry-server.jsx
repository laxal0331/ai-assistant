import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./components/App";
import MobilePage from "./components/MobilePage";

function getMobileSessionId(url) {
  const path = (url || "/").split("?")[0];
  const match = path.match(/^\/m\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

export function render(url) {
  const mobileSessionId = getMobileSessionId(url);
  const html = renderToString(
    <StrictMode>
      {mobileSessionId ? <MobilePage sessionId={mobileSessionId} /> : <App />}
    </StrictMode>,
  );
  return { html };
}
