import { z } from 'zod';
import { EndianSchema } from './common';

/** 全局字典 ID：稳定引用键，创建后不再修改。 */
export const DictionaryIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, '字典 ID 只能包含字母、数字、_ 和 -，且必须以字母或数字开头');

export const TextValueFormatSchema = z.object({
  type: z.literal('int16Array'),
  points: z.number().int().min(1).max(65536).default(1024),
  endian: EndianSchema.default('be'),
  encoding: z.enum(['hex', 'base64']).default('hex'),
  crc: z
    .object({
      algo: z.literal('crc16-modbus'),
      endian: EndianSchema.default('le'),
    })
    .optional(),
});

export type TextValueFormat = z.infer<typeof TextValueFormatSchema>;

export const TextDictionaryEntrySchema = z.object({
  name: z.string().optional(),
  unit: z.string().optional(),
  multi: z.boolean().optional(),
  description: z.string().optional(),
  valueFormat: TextValueFormatSchema.optional(),
});

export type TextDictionaryEntry = z.infer<typeof TextDictionaryEntrySchema>;

export const DictionaryEntriesSchema = z.record(
  z.string(),
  TextDictionaryEntrySchema,
);

export type DictionaryEntries = z.infer<typeof DictionaryEntriesSchema>;

/**
 * 全局数据字典。设备配置只保存 `repeat.dictionary = id`，entries 由服务端
 * 的字典仓库统一维护，因此多个设备可以共享同一份码表。
 */
export const GlobalDictionaryDefinitionSchema = z.object({
  id: DictionaryIdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  entries: DictionaryEntriesSchema,
});

export type GlobalDictionaryDefinition = z.infer<
  typeof GlobalDictionaryDefinitionSchema
>;
