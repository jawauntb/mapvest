import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type SidebarCtx = {
  open: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
};

const Ctx = createContext<SidebarCtx | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSidebar = useCallback(() => setOpen(true), []);
  const closeSidebar = useCallback(() => setOpen(false), []);
  const toggleSidebar = useCallback(() => setOpen((v) => !v), []);
  const value = useMemo(
    () => ({ open, openSidebar, closeSidebar, toggleSidebar }),
    [open, openSidebar, closeSidebar, toggleSidebar],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSidebar(): SidebarCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
