import { z } from 'zod';

export const EndianSchema = z.enum(['be', 'le']);
export type Endian = z.infer<typeof EndianSchema>;
