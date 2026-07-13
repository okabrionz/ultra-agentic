import { expect, test, type Locator } from '@playwright/test';

const releasedCatalogEntries = [
	{
		title: 'Deployment Readiness Skill',
		download: '/downloads/deployment-readiness-skill-0.1.0.zip',
	},
	{
		title: 'Documentation Retrieval MCP',
		download: '/downloads/documentation-retrieval-mcp-0.1.0.zip',
	},
	{
		title: 'Repository Operations MCP',
		download: '/downloads/repository-operations-mcp-0.1.0.zip',
	},
] as const;

async function expectElementsWithinViewport(locator: Locator) {
	const bounds = await locator.evaluateAll((elements) =>
		elements.map((element) => {
			const rect = element.getBoundingClientRect();
			return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
		}),
	);

	expect(bounds.length).toBeGreaterThan(0);
	for (const bound of bounds) {
		expect(bound.left).toBeGreaterThanOrEqual(-0.5);
		expect(bound.right).toBeLessThanOrEqual(bound.viewportWidth + 0.5);
	}
}

test.beforeEach(async ({ page }) => {
	await page.goto('/catalog/');
});

test('pressing Enter keeps the live catalog search state', async ({ page }) => {
	const search = page.getByLabel('Search the catalog');
	await search.fill('repository');
	await expect(page.getByRole('status')).toHaveText('1 entry shown');

	const urlBeforeEnter = page.url();
	await search.press('Enter');

	await expect(page).toHaveURL(urlBeforeEnter);
	await expect(search).toHaveValue('repository');
	await expect(page.getByRole('status')).toHaveText('1 entry shown');
});

test('filters catalog entries by type and maturity', async ({ page }) => {
	await page.getByLabel('Tool type').selectOption('skill');
	await expect(page.getByRole('status')).toHaveText('2 entries shown');
	await expect(page.locator('[data-catalog-item]:visible')).toHaveCount(2);

	await page.getByLabel('Maturity').selectOption('planned');
	await expect(page.getByRole('status')).toHaveText('1 entry shown');
	await expect(page.locator('[data-catalog-item]:visible')).toHaveCount(1);
	await expect(page.getByRole('heading', { name: 'Observability Triage Skill' })).toBeVisible();

	await page.getByLabel('Tool type').selectOption('dataset');
	await expect(page.getByRole('status')).toHaveText('1 entry shown');
	await expect(page.getByRole('heading', { name: 'Agent Tool Failure Dataset' })).toBeVisible();
});

test('beta filter shows exactly the three downloadable releases', async ({ page }) => {
	await page.getByLabel('Maturity').selectOption('beta');

	await expect(page.getByRole('status')).toHaveText('3 entries shown');
	await expect(page.locator('[data-catalog-item]:visible')).toHaveCount(3);
	for (const release of releasedCatalogEntries) {
		const card = page.locator('[data-catalog-item]').filter({
			has: page.getByRole('heading', { name: release.title, exact: true }),
		});
		await expect(card).toBeVisible();
		await expect(card.getByText('Available v0.1.0', { exact: true })).toBeVisible();
		const download = card.getByRole('link', { name: 'Download ZIP' });
		await expect(download).toHaveAttribute('href', release.download);
		await expect(download).toHaveAttribute('download', '');
	}
});

test('announces no results and returns focus to search after reset', async ({ page }) => {
	const search = page.getByLabel('Search the catalog');
	await search.fill('no-such-catalog-entry');

	await expect(page.getByRole('status')).toHaveText('0 entries shown');
	await expect(page.getByRole('region', { name: 'Try a broader search.' })).toBeVisible();

	await page.getByRole('button', { name: 'Reset all filters' }).click();

	await expect(search).toBeFocused();
	await expect(search).toHaveValue('');
	await expect(page.getByRole('status')).toHaveText('6 entries shown');
});

test('opens catalog details from a card at 375px', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	const repositoryCard = page.locator('[data-catalog-item]').filter({
		has: page.getByRole('heading', { name: 'Repository Operations MCP', exact: true }),
	});
	await expectElementsWithinViewport(repositoryCard.locator('.release-strip-card'));
	await repositoryCard.getByRole('heading').getByRole('link').click();

	await expect(page).toHaveURL(/\/catalog\/repository-operations-mcp\/$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Repository Operations MCP' })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Quick start' })).toBeVisible();
	await expect(page.getByText('cd repository-operations-mcp-0.1.0', { exact: true })).toBeVisible();
	await expect(page.getByText('npm install --omit=dev', { exact: true })).toBeVisible();
	await expect(
		page.getByText('REPO_ROOT=/path/to/repository node dist/index.js', { exact: true }),
	).toBeVisible();
	const download = page.getByRole('link', { name: 'Download v0.1.0' });
	await expect(download).toHaveAttribute(
		'href',
		'/downloads/repository-operations-mcp-0.1.0.zip',
	);
	await expect(download).toHaveAttribute('download', '');
	await expect(page.getByText(/interfaces may change/i)).toBeVisible();
	await expectElementsWithinViewport(page.locator('.release-strip-detail'));
	await expectElementsWithinViewport(page.locator('.quick-start-list'));
	await expectElementsWithinViewport(page.locator('.quick-start-list > li'));
	await expectElementsWithinViewport(page.locator('.quick-start-list pre'));

	const dimensions = await page.evaluate(() => ({
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
	}));
	expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test('planned detail exposes neither release controls nor quick-start commands', async ({ page }) => {
	await page.goto('/catalog/database-context-mcp/');

	await expect(page.getByText('No source artifact published', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Quick start' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0);
});

test('serves every direct release ZIP with a local-file header and meaningful size', async ({
	request,
}) => {
	for (const release of releasedCatalogEntries) {
		const response = await request.get(release.download);
		const bytes = await response.body();

		expect(response.status(), release.download).toBe(200);
		expect([...bytes.subarray(0, 4)], release.download).toEqual([80, 75, 3, 4]);
		expect(bytes.byteLength, release.download).toBeGreaterThan(1_000);
	}
});
