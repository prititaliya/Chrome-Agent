// Key settings live in the shared SettingsPanel (plan Task 6).
import SettingsPanel from "../../../src/ui/components/SettingsPanel";
import OriginsPanel from "../../../src/ui/components/OriginsPanel";

export default function SettingsTab() {
  return (
    <section>
      <h1>Settings</h1>
      <SettingsPanel />
      <OriginsPanel />
    </section>
  );
}
