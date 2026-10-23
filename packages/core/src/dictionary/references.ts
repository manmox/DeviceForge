import type { DeviceConfig, TextCodecConfig } from '../schema/device';

export interface DictionaryReference {
  dictionaryId: string;
  /** 设备配置中的 JSON 路径，例如 codec.messages.0.slots.2.dictionary。 */
  path: string;
  messageName: string;
  repeatName: string;
}

export function collectTextCodecDictionaryReferences(
  codec: TextCodecConfig,
): DictionaryReference[] {
  const references: DictionaryReference[] = [];

  for (let messageIndex = 0; messageIndex < codec.messages.length; messageIndex += 1) {
    const message = codec.messages[messageIndex]!;
    for (let slotIndex = 0; slotIndex < message.slots.length; slotIndex += 1) {
      const slot = message.slots[slotIndex]!;
      if (slot.kind !== 'repeat' || slot.dictionary === undefined) continue;
      references.push({
        dictionaryId: slot.dictionary,
        path: `codec.messages.${messageIndex}.slots.${slotIndex}.dictionary`,
        messageName: message.name,
        repeatName: slot.name,
      });
    }
  }

  return references;
}

export function collectDictionaryReferences(
  config: DeviceConfig,
): DictionaryReference[] {
  return config.codec.type === 'text'
    ? collectTextCodecDictionaryReferences(config.codec)
    : [];
}

/** 返回引用了不存在字典的 repeat；服务端据此生成 422 issue。 */
export function findMissingDictionaryReferences(
  config: DeviceConfig,
  has: (id: string) => boolean,
): DictionaryReference[] {
  return collectDictionaryReferences(config).filter(
    (reference) => !has(reference.dictionaryId),
  );
}
