import { useState } from "react";

import { Navbar } from "./navbar";
import { PrInbox } from "./pr-inbox";
import { PrDetailView } from "./pr-detail-view";

/**
 * Root layout matching DISPATCH-DESIGN-SYSTEM.md § 4.2:
 *
 *  +--[ Accent Bar (2px) ]--+
 *  |      Navbar (42px)     |
 *  +------+-----------------+
 *  | Side |   Main Content  |
 *  | bar  |   (flex: 1)     |
 *  | 260px|                 |
 *  +------+-----------------+
 */
export function AppLayout() {
  const [selectedPr, setSelectedPr] = useState<number | null>(null);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-root text-text-primary">
      {/* Accent bar — 2px copper gradient at the very top (§ 4.3) */}
      <div
        className="h-[2px] w-full shrink-0"
        style={{
          background: "linear-gradient(90deg, transparent, var(--primary), transparent)",
          opacity: 0.4,
        }}
      />

      {/* Navbar — 40px (42px total with accent bar) */}
      <Navbar />

      {/* Main body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* PR Inbox Sidebar (§ 8.4) — 260px */}
        <PrInbox selectedPr={selectedPr} onSelectPr={setSelectedPr} />

        {/* Main content area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <PrDetailView prNumber={selectedPr} />
        </main>
      </div>
    </div>
  );
}
