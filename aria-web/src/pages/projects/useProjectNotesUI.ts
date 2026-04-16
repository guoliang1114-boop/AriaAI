import { useEffect, useRef, useState } from "react";

export function useProjectNotesUI() {
  const [mode, setMode] = useState<"edit" | "preview" | "split">("preview");
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node)
      ) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return {
    mode,
    moreMenuRef,
    setMode,
    setShowMoreMenu,
    showMoreMenu,
  };
}
