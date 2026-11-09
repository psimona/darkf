import { fileURLToPath } from 'node:url';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// The docs live in the package (darkf/docs/) and npm ships them via the
// `files` allowlist — the site renders the same files the package ships,
// one source of truth. Starlight's docsLoader() is pinned to
// src/content/docs/, so this is the same glob with a rebased base.
const docsDir = fileURLToPath(new URL('../../darkf/docs/', import.meta.url));

export const collections = {
	docs: defineCollection({
		loader: glob({ base: docsDir, pattern: '**/[^_]*.{md,mdx}' }),
		schema: docsSchema(),
	}),
};
