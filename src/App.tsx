import "normalize.css";
import "./styles.css";

import { useEffect, useState } from "react";
import { Investimentos } from "./pages/investimentos/Investimentos";
import { Vending } from "./pages/vending/Vending";

// New utility = new entry here.
const pages = [
  { path: "vending", title: "Calculadora Vending Machine", Component: Vending },
  { path: "investimentos", title: "Calculadora de Renda Fixa", Component: Investimentos },
];

// Share links from the old standalone investimentos site ("#s=...").
if (window.location.hash.startsWith("#s=")) {
  history.replaceState(null, "", `#/investimentos?${window.location.hash.slice(1)}`);
}

// Hash is "#/<page>?<query>"; the query belongs to the page (e.g. share links).
const currentPath = () => window.location.hash.replace(/^#\/?/, "").split("?")[0];

export const App = () => {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const handler = () => setPath(currentPath());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const page = pages.find((p) => p.path === path);

  return (
    <>
      <header className="topbar">
        <nav className="topbar-inner actions">
          <a className="btn btn-ghost" href="#/">Utilidades</a>
          {pages.map((p) => (
            <a key={p.path} className={`btn ${p === page ? "btn-primary" : ""}`} href={`#/${p.path}`}>
              {p.title}
            </a>
          ))}
        </nav>
      </header>
      {page ? (
        <page.Component key={page.path} />
      ) : (
        <main className="layout">
          <h1>Utilidades</h1>
          <div className="kpis">
            {pages.map((p) => (
              <a key={p.path} className="kpi" href={`#/${p.path}`}>
                <div className="kpi-value">{p.title}</div>
              </a>
            ))}
          </div>
        </main>
      )}
    </>
  );
};
