/**
 * End-to-end smoke test against a deployed Render service.
 *
 * Opt-in by setting SMOKE_URL to the deployed URL:
 *   SMOKE_URL=https://revenue-metric-api.onrender.com npx vitest run e2e/
 *
 * Skipped by default so the regular `npm test` run doesn't hit production.
 *
 * The headline assertion is the same property the unit-level property
 * test enforces — `total == sum(timeseries.buckets)` — but verified at
 * the HTTP layer against a real deployed service. This catches:
 *   - A routing-level bug where one endpoint calls the wrong handler
 *   - A Render env-var misconfiguration that makes the two endpoints
 *     read from different databases (theoretical, but worth catching)
 *   - Any drift between local and production behavior
 */
import { describe, expect, it } from 'vitest';

const SMOKE_URL = process.env.SMOKE_URL;
const describeIfDeployed = SMOKE_URL ? describe : describe.skip;

describeIfDeployed('e2e smoke — deployed Render service', () => {
  const baseUrl = SMOKE_URL!;

  it('GET /health returns 200', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.db).toBe('ok');
  }, 90_000); // generous timeout to absorb Render cold-start

  it('GET /metrics/revenue/total returns a number', async () => {
    const res = await fetch(
      `${baseUrl}/metrics/revenue/total?from=2024-01-01&to=2027-01-01`,
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.totalCents).toBe('number');
    expect(body.data.currency).toBe('USD');
  }, 30_000);

  it('GET /metrics/revenue/timeseries.totalCents equals /total.totalCents', async () => {
    const params = 'from=2024-01-01&to=2027-01-01&currency=USD';
    const [totalRes, seriesRes] = await Promise.all([
      fetch(`${baseUrl}/metrics/revenue/total?${params}`),
      fetch(`${baseUrl}/metrics/revenue/timeseries?${params}&granularity=month`),
    ]);
    expect(totalRes.ok).toBe(true);
    expect(seriesRes.ok).toBe(true);
    const total = (await totalRes.json()).data.totalCents;
    const series = (await seriesRes.json()).data;
    const summed = series.buckets.reduce(
      (acc: number, b: { totalCents: number }) => acc + b.totalCents,
      0,
    );
    expect(summed).toBe(total);
    expect(series.totalCents).toBe(total);
  }, 30_000);

  it('GET /metrics/status-coverage returns valid shape', async () => {
    const res = await fetch(`${baseUrl}/metrics/status-coverage`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.unknown_statuses)).toBe(true);
  }, 30_000);

  it('POST /ingest/mock without bearer returns 401', async () => {
    const res = await fetch(`${baseUrl}/ingest/mock`, { method: 'POST' });
    expect(res.status).toBe(401);
  }, 30_000);
});
