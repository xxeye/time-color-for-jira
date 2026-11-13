// Type contract tests for the settings channel (settings_broker.js, settings_client.js). Nothing here runs.
import type { Config } from '../types/domain';
import type { BrokerResponse, Delivery, ImportConflict, SettingsContext } from '../types/messages';

const client = globalThis.JptClient;

async function replies() {
  // Each method resolves to its own reply, not a union of all of them.
  const context: SettingsContext = await client.getContext({ projectId: '10001' });
  const draft: Config | null = await client.getDraft();
  const delivery: Delivery = await client.refresh();
  const imported = await client.importConfig({}, { replace: false });
  if (!imported.ok) {
    const conflict: ImportConflict = imported;
    void conflict.conflicts;
  }
  // @ts-expect-error getDraft may be null
  const notNull: Config = await client.getDraft();
  // @ts-expect-error refresh does not return the context
  const wrong: SettingsContext = await client.refresh();
  void [context, draft, delivery, notNull, wrong];
}
void replies;

// Arguments are checked.
// @ts-expect-error unknown setting key
client.savePreferences({ noSuchSetting: true });
// @ts-expect-error a position needs side and ratio
client.savePosition({ side: 'left', ratio: 0.5 });

// The worker's response envelope separates transport failures from replies.
declare const response: BrokerResponse;
if (response.ok) {
  void response.value;
} else {
  const code: 'forbidden' | 'invalid' | 'storage' | 'corrupt' | 'missing' = response.code;
  // @ts-expect-error a failed response has no value
  void response.value;
  void code;
}

// The broker reply type survives serial(): handle() is not Promise<void>.
declare const sender: chrome.runtime.MessageSender;
async function brokerReply() {
  const r: BrokerResponse = await globalThis.JptSettingsBroker.createBroker(chrome).handle({}, sender);
  void r;
}
void brokerReply;
