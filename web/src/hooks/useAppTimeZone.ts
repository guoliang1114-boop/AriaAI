import { useEffect, useState } from "react";
import {
  APP_TIMEZONE_EVENT,
  getStoredAppTimeZone,
  getResolvedAppTimeZone,
} from "../utils/timezone";

export function useAppTimeZone() {
  const [storedTimeZone, setStoredTimeZone] = useState(getStoredAppTimeZone);
  const [resolvedTimeZone, setResolvedTimeZone] = useState(getResolvedAppTimeZone);

  useEffect(() => {
    const sync = () => {
      setStoredTimeZone(getStoredAppTimeZone());
      setResolvedTimeZone(getResolvedAppTimeZone());
    };

    window.addEventListener("storage", sync);
    window.addEventListener(APP_TIMEZONE_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(APP_TIMEZONE_EVENT, sync as EventListener);
    };
  }, []);

  return {
    storedTimeZone,
    resolvedTimeZone,
  };
}
