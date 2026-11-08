import { useId, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  ChevronDown,
  FileSpreadsheet,
  House,
  Inbox,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../ui";
import { useClearance } from "../../state/clearance";
import { useTheme } from "../../hooks/useTheme";
import { viewers, term } from "../../data/sample";
import { initials } from "../../lib/clearance";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span
      className="logo"
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
      aria-hidden
    >
      <ShieldCheck size={Math.round(size * 0.6)} strokeWidth={2} />
    </span>
  );
}

function useNavItems(): NavItem[] {
  const { viewer, queue, courseById } = useClearance();
  if (viewer.role === "ta") {
    return viewer.courseIds.map((id, i) => ({
      to: i === 0 ? "/class" : `/class/${id}`,
      label: viewer.courseIds.length > 1 ? (courseById(id)?.name ?? id) : "My class",
      icon: Users,
    }));
  }
  return [
    { to: "/", label: "Dashboard", icon: House },
    { to: "/review", label: "Review queue", icon: Inbox, count: queue.length },
    { to: "/students", label: "Students", icon: Users },
    { to: "/roster", label: "Roster", icon: FileSpreadsheet },
    { to: "/settings", label: "Settings", icon: Settings },
  ];
}

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const items = useNavItems();
  return (
    <nav className="nav" aria-label="Main">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end onClick={onNavigate} className="nav-item">
          <item.icon strokeWidth={1.75} />
          {item.label}
          {item.count !== undefined && item.count > 0 && (
            <span className="nav-item__count">{item.count}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The workspace at the top of the sidebar. Its menu opens in place, the way
 * Resend's does. Until sign-in exists it switches between sample viewers, so
 * the admin and TA views can both be checked.
 */
export function WorkspaceSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const { viewer, setViewerId, courseById } = useClearance();
  const [open, setOpen] = useState(false);
  const menu = useId();
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) setOpen(false);
      }}
    >
      <button
        type="button"
        className="workspace"
        aria-expanded={open}
        aria-controls={menu}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="workspace__name">
          <Logo />
          <span>Netter Center</span>
        </span>
        <ChevronDown />
      </button>
      <div id={menu} className="workspace-menu" data-open={open} inert={!open}>
        <div>
          <div className="workspace-menu__panel">
            <p className="workspace-menu__label" title={viewer.email}>
              Viewing as {viewer.name}
            </p>
            <div
              className="workspace-menu__group"
              role="radiogroup"
              aria-label="Sample viewer"
            >
              {viewers.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={v.id === viewer.id}
                  className="menu-item"
                  onClick={() => {
                    setViewerId(v.id);
                    setOpen(false);
                    onSwitch?.();
                  }}
                >
                  <span>{v.name}</span>
                  <span className="subtle">
                    {v.role === "admin"
                      ? "Admin"
                      : v.courseIds
                          .map((id) => courseById(id)?.name.replace("Course ", ""))
                          .join(", ")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      icon={dark ? <Sun /> : <Moon />}
    />
  );
}

export function Sidebar() {
  const { viewer } = useClearance();
  return (
    <aside className="sidebar">
      <div className="sidebar__top">
        <WorkspaceSwitcher />
      </div>
      <div className="sidebar__nav">
        <NavList />
      </div>
      <div className="sidebar__bottom">
        <span className="row subtle">
          <span className="avatar" aria-hidden>
            {initials(viewer.name)}
          </span>
          {term}
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
