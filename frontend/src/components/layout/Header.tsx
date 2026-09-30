import React from 'react';
import { Menu, X, Search, Sun, Moon, ShieldAlert } from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import { BackendStatus } from '../ui/BackendStatus';
import { CommandPalette } from '../ui/CommandPalette';

const navItems: Array<{
  id: 'launch' | 'scan' | 'results';
  num: string;
  label: string;
  desc: string;
}> = [
  { id: 'launch', num: '01', label: 'Launch', desc: 'Ingest & validate' },
  { id: 'scan', num: '02', label: 'Scan', desc: '13-stage pipeline' },
  { id: 'results', num: '03', label: 'Results', desc: 'Verdict & evidence' },
];

export const Header: React.FC = () => {
  const {
    phase,
    setPhase,
    theme,
    toggleTheme,
    sessionId,
    isScanning,
    backendOnline,
  } = useInvestigation();

  // Drawer state is presentation only — no data or API logic is affected.
  const [navOpen, setNavOpen] = React.useState(false);

  // The shortcut hint is cosmetic; the dispatched event below is unchanged.
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/.test(
      (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ||
        navigator.platform ||
        navigator.userAgent
    );
  const shortcutHint = isMac ? '⌘K' : 'Ctrl K';

  const activeItem = navItems.find(i => i.id === phase) ?? navItems[0];

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <button
            type="button"
            className="icon-btn topbar__burger"
            onClick={() => setNavOpen(o => !o)}
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
          >
            {navOpen ? (
              <X size={18} strokeWidth={1.5} />
            ) : (
              <Menu size={18} strokeWidth={1.5} />
            )}
          </button>

          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span className="eyebrow breadcrumb__root">TRUST-CV</span>
            <span className="breadcrumb__sep">/</span>
            <span className="eyebrow">{activeItem.label.toUpperCase()}</span>
          </nav>
        </div>

        <div className="topbar__right">
          <BackendStatus online={backendOnline} />

          <button
            type="button"
            className="search-btn"
            onClick={() =>
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
            }
            aria-label="Open command palette"
            title={`Open command palette (${shortcutHint})`}
          >
            <Search size={15} strokeWidth={1.5} />
            <span className="search-btn__label">Search</span>
            <kbd className="keychip">{shortcutHint}</kbd>
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label="Toggle Light and Dark Theme"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <Sun size={18} strokeWidth={1.5} />
            ) : (
              <Moon size={18} strokeWidth={1.5} />
            )}
          </button>
        </div>
      </header>

      {/* Drawer scrim — mobile only, closes the sidebar on tap */}
      {navOpen && (
        <div
          className="shell__scrim"
          onClick={() => setNavOpen(false)}
          role="presentation"
        />
      )}

      <aside className={`sidebar${navOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <span className="sidebar__mark">
            <ShieldAlert size={16} strokeWidth={1.5} />
          </span>
          <span className="sidebar__wordmark">
            <span className="sidebar__name">TRUST-CV</span>
            <span className="eyebrow">SOC Console</span>
          </span>
        </div>

        {/* Active case — the only facts shown are ones the store already holds */}
        <div className="case-card">
          <span className="eyebrow">Active Case</span>
          <p className="case-card__id font-mono">{sessionId}</p>
          <div className="case-card__meta">
            <span className={`status-dot${isScanning ? ' status-dot--live' : ''}`} />
            <span className="eyebrow">
              {isScanning ? 'Pipeline running' : `Phase ${activeItem.num}`}
            </span>
          </div>
        </div>

        <ul className="sidebar__nav">
          {navItems.map(item => {
            const isActive = item.id === phase;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`nav-row${isActive ? ' nav-row--active' : ''}`}
                  onClick={() => {
                    setPhase(item.id);
                    setNavOpen(false);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="nav-row__num font-mono">{item.num}</span>
                  <span className="nav-row__body">
                    <span className="nav-row__label">{item.label}</span>
                    <span className="nav-row__desc">{item.desc}</span>
                  </span>
                  {item.id === 'scan' && isScanning && (
                    <span className="status-dot status-dot--live" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="sidebar__foot">
          <div className="user-chip">
            <span className="user-chip__dot" aria-hidden="true" />
            <span className="user-chip__body">
              <span className="user-chip__name">SOC Operator</span>
              <span className="eyebrow">
                {backendOnline ? 'Backend online' : 'Air-gapped'}
              </span>
            </span>
          </div>
        </div>
      </aside>

      {/* Global command palette (⌘K / Ctrl+K) */}
      <CommandPalette />
    </>
  );
};