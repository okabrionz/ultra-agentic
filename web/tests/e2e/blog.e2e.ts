import { expect, test } from '@playwright/test';

test('blog index lists six posts and links into a detail page', async ({ page }) => {
	await page.goto('/blog/');

	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(
		page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Blog' })
	).toBeVisible();

	const cards = page.locator('article.blog-card');
	await expect(cards).toHaveCount(6);

	await page.getByRole('link', { name: 'Building in Public Without Overclaiming Artifacts' }).click();
	await expect(page).toHaveURL(/\/blog\/building-in-public-catalog-honesty\/$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'Building in Public Without Overclaiming Artifacts'
	);
	await expect(page.getByRole('link', { name: '← Back to blog' })).toBeVisible();
});
