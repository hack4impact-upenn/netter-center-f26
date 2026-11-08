import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, Mail, Menu, X } from "lucide-react";
import { Button } from "../ui";
import { useClearance } from "../../state/clearance";
import { box } from "../../data/sample";
import { Logo, NavList, Sidebar, ThemeToggle, WorkspaceSwitcher } from "./Sidebar";

/**
 * The app's frame, after Resend's dashboard: a sidebar with the workspace and
 * nav, a quiet top bar, and a page that scrolls on its own so the frame stays
 * put. On a phone the sidebar folds into a menu behind the top bar.
 */
export function Shell() {
  const { viewer, blast } = useClearance();
  const [menuOpen, setMenuOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // A new page starts at its top, as a fresh load would.
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="shell">
      <Sidebar />
      <div className="shell__column">
        <div className="topbar">
          {viewer.role === "admin" ? (
            <>
              <span
                className="status-line"
                title="The reader account lists file names only"
              >
                <span className="status-line__dot" aria-hidden />
                Box connected · checked {box.checkedMinutesAgo} min ago
              </span>
              <a className="topbar__link" href={box.url} target="_blank" rel="noreferrer">
                Box folder
                <ArrowUpRight />
              </a>
            </>
          ) : (
            <a className="topbar__link" href={`mailto:${blast.replyTo}`}>
              <Mail />
              {blast.replyTo}
            </a>
          )}
        </div>

        <div className="mobile-bar">
          <Link to={viewer.role === "admin" ? "/" : "/class"} className="row">
            <Logo size={28} />
            <span className="display" style={{ fontSize: 15 }}>
              Clearance Tracker
            </span>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            icon={menuOpen ? <X /> : <Menu />}
          />
        </div>
        {menuOpen && (
          <div className="mobile-menu">
            <WorkspaceSwitcher onSwitch={() => setMenuOpen(false)} />
            <NavList onNavigate={() => setMenuOpen(false)} />
            <div style={{ marginTop: "auto" }}>
              <ThemeToggle />
            </div>
          </div>
        )}

        <main ref={main} className="main">
          <div className="page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
