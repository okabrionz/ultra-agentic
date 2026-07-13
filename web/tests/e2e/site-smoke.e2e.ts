import { expect, test } from '@playwright/test';

const generatedRoutes = [
	{ name: 'home', path: '/', status: 200 },
	{ name: 'catalog', path: '/catalog/', status: 200 },
	{ name: 'blog', path: '/blog/', status: 200 },
	{ name: 'blog mcp primer', path: '/blog/what-is-an-mcp-server/', status: 200 },
	{ name: 'get started', path: '/get-started/', status: 200 },
	{ name: 'sponsors', path: '/sponsors/', status: 200 },
	{ name: 'about', path: '/about/', status: 200 },
	{ name: '404 document', path: '/404.html', status: 200 },
	{ name: 'database context MCP', path: '/catalog/database-context-mcp/', status: 200 },
	{ name: 'deployment readiness skill', path: '/catalog/deployment-readiness-skill/', status: 200 },
	{ name: 'documentation retrieval MCP', path: '/catalog/documentation-retrieval-mcp/', status: 200 },
	{ name: 'observability triage skill', path: '/catalog/observability-triage-skill/', status: 200 },
	{ name: 'repository operations MCP', path: '/catalog/repository-operations-mcp/', status: 200 },
	{ name: 'tool failure dataset', path: '/catalog/tool-failure-dataset/', status: 200 },
] as const;

test('skip link is keyboard-visible and moves focus to main content', async ({ page }) => {
	await page.goto('/');

	await page.keyboard.press('Tab');
	const skipLink = page.getByRole('link', { name: 'Skip to main content' });
	await expect(skipLink).toBeFocused();
	await expect(skipLink).toBeVisible();

	await page.keyboard.press('Enter');
	await expect(page.locator('#main-content')).toBeFocused();
});

test('mobile details navigation opens and navigates by keyboard at 375px', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto('/');

	const mobileNavigation = page.locator('details.mobile-nav');
	const summary = mobileNavigation.locator('summary');
	await summary.focus();
	await expect(summary).toBeFocused();

	await page.keyboard.press('Enter');
	await expect(mobileNavigation).toHaveAttribute('open', '');
	await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();

	await page.keyboard.press('Tab');
	const catalogLink = page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', {
		name: 'Catalog',
	});
	await expect(catalogLink).toBeFocused();
	await page.keyboard.press('Enter');

	await expect(page).toHaveURL(/\/catalog\/$/);
});

for (const viewport of [
	{ name: 'desktop', width: 1280, height: 900 },
	{ name: 'mobile', width: 375, height: 812 },
]) {
	for (const route of generatedRoutes) {
		test(`${route.name} has no horizontal overflow at ${viewport.name} width`, async ({ page }) => {
			await page.setViewportSize(viewport);
			const response = await page.goto(route.path);
			const dimensions = await page.evaluate(() => ({
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
			}));

			expect(response?.status(), route.path).toBe(route.status);
			expect(dimensions.scrollWidth, route.path).toBeLessThanOrEqual(dimensions.clientWidth);
			await expect(page.locator('main')).toBeVisible();
		});
	}
}

test('unknown routes render the custom 404 response', async ({ page }) => {
	const response = await page.goto('/this-route-does-not-exist/');

	expect(response?.status()).toBe(404);
	await expect(
		page.getByRole('heading', { level: 1, name: 'This endpoint is not on the workbench.' }),
	).toBeVisible();
});

test('reduced-motion preference suppresses animation and transitions', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');

	const wireMotion = await page.locator('.wire').first().evaluate((element) => {
		const styles = getComputedStyle(element);
		return {
			durationSeconds: Number.parseFloat(styles.animationDuration),
			iterations: styles.animationIterationCount,
		};
	});
	const skipTransition = await page.locator('.skip-link').evaluate((element) => {
		return Number.parseFloat(getComputedStyle(element).transitionDuration);
	});

	expect(wireMotion.iterations).toBe('1');
	expect(wireMotion.durationSeconds).toBeLessThanOrEqual(0.00001);
	expect(skipTransition).toBeLessThanOrEqual(0.00001);
});
