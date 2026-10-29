// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import rehypeMermaid from 'rehype-mermaid';

// https://astro.build/config
// Project-page subpath for GitHub Pages (<org>.github.io/darkf). Flip to a
// custom domain's "/" base if darkf ever gets one — see
// docs/specs/docs-site/spec.md's open decisions.
const base = '/darkf';

export default defineConfig({
	base,
	server: {
		host: '0.0.0.0',
	},
	// Needed for the sitemap and canonical URLs; the project-page base
	// above makes the deployed URL https://psimona.github.io/darkf.
	site: 'https://psimona.github.io',
	// Diagrams are rendered to real SVGs at build time (Playwright + headless
	// Chromium), not by shipping Mermaid's JS to every reader. img-svg is the
	// one strategy that supports both vector output and dark-mode swapping
	// (via dark: true, a <picture> with a light/dark source pair).
	markdown: {
		rehypePlugins: [[rehypeMermaid, { strategy: 'img-svg', dark: true }]],
	},
	integrations: [
		starlight({
			title: 'darkf',
			description: 'A small, typed workflow engine for agent + script state graphs.',
			customCss: ['./src/styles/custom.css'],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/psimona/darkf',
				},
			],
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Install', slug: 'start-here/install' },
						{ label: 'Quickstart', slug: 'start-here/quickstart' },
					],
				},
				{
					label: 'Concepts',
					items: [
						{ label: 'Node types', slug: 'concepts/node-types' },
						{ label: 'Failure modes', slug: 'concepts/failure-modes' },
						{ label: 'Handoff', slug: 'concepts/handoff' },
						{ label: 'Journal', slug: 'concepts/journal' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Write your first workflow', slug: 'guides/write-your-first-workflow' },
						{ label: 'Pick an agent runner', slug: 'guides/pick-an-agent-runner' },
						{ label: 'Run detached and monitor it', slug: 'guides/run-detached-and-monitor' },
						{ label: 'Render a workflow to mermaid', slug: 'guides/render-to-mermaid' },
						{ label: 'Plan with a task queue', slug: 'guides/plan-with-a-task-queue' },
						{ label: 'Test your workflow', slug: 'guides/test-your-workflow' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI commands', slug: 'reference/cli-commands' },
						{ label: 'Core types', slug: 'reference/core-types' },
						{ label: 'Package map', slug: 'reference/package-map' },
					],
				},
			],
		}),
	],
});
