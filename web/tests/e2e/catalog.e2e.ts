import { expect, test } from '@playwright/test';

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
	await expect(page.getByRole('status')).toHaveText('2 entries shown');
	await expect(page.locator('[data-catalog-item]:visible')).toHaveCount(2);

	await page.getByLabel('Tool type').selectOption('dataset');
	await expect(page.getByRole('status')).toHaveText('1 entry shown');
	await expect(page.getByRole('heading', { name: 'Agent Tool Failure Dataset' })).toBeVisible();
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
	await page.getByRole('heading', { name: 'Repository Operations MCP' }).getByRole('link').click();

	await expect(page).toHaveURL(/\/catalog\/repository-operations-mcp\/$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Repository Operations MCP' })).toBeVisible();
});
