import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { getActiveTab, type TabInfo } from "../../browser/tabs";
import type { ProviderConfig } from "../../providers/types";
import {
  DEFAULT_SETTINGS,
  getProviders,
  getSettings,
  watchProviders,
  watchSettings,
  type Settings,
} from "../../storage/settings";

export function useSettings(): Settings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    void getSettings().then(setSettings);
    return watchSettings(setSettings);
  }, []);
  return settings;
}

export function useProviders(): ProviderConfig[] | null {
  const [providers, setProviders] = useState<ProviderConfig[] | null>(null);
  useEffect(() => {
    void getProviders().then(setProviders);
    return watchProviders(setProviders);
  }, []);
  return providers;
}

/** The active tab of the panel's window, kept live as the user switches and navigates. */
export function useActiveTab(): TabInfo | null {
  const [tab, setTab] = useState<TabInfo | null>(null);
  useEffect(() => {
    const refresh = () => void getActiveTab().then(setTab);
    refresh();
    const onUpdated = (_id: number, info: { status?: string; title?: string; url?: string }) => {
      if (info.status === "complete" || info.title || info.url) refresh();
    };
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.windows.onFocusChanged.addListener(refresh);
    return () => {
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.windows.onFocusChanged.removeListener(refresh);
    };
  }, []);
  return tab;
}
