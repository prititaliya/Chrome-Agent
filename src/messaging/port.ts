// Thin port wiring over `browser.runtime`. Validation happens here so no
// unvalidated message reaches the agent loop or the UI render path.
import { browser } from "wxt/browser";
import { isBackgroundEvent, isPanelCommand, type BackgroundEvent, type PanelCommand } from "./protocol";

export const AGENT_PORT_NAME = "agent";

export type Reply = (event: BackgroundEvent) => void;
export type CommandHandler = (command: PanelCommand, reply: Reply) => void;

/** Background side: route validated panel commands to `onCommand`. */
export function handlePanelPorts(onCommand: CommandHandler): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AGENT_PORT_NAME) return;
    const reply: Reply = (event) => port.postMessage(event);
    port.onMessage.addListener((raw: unknown) => {
      if (!isPanelCommand(raw)) {
        reply({ v: 1, type: "protocolError", reason: "unrecognized command shape" });
        return;
      }
      onCommand(raw, reply);
    });
  });
}

export interface AgentPort {
  send(command: PanelCommand): void;
  disconnect(): void;
}

/** Panel/overlay side: open the agent port; only validated events reach `onEvent`. */
export function openAgentPort(onEvent: (event: BackgroundEvent) => void): AgentPort {
  const port = browser.runtime.connect({ name: AGENT_PORT_NAME });
  port.onMessage.addListener((raw: unknown) => {
    if (isBackgroundEvent(raw)) onEvent(raw);
  });
  return {
    send: (command) => port.postMessage(command),
    disconnect: () => port.disconnect(),
  };
}
