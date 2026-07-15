import { ConfigService } from '@nestjs/config';
import { OpenFoodFactsService } from './open-food-facts.service';

const configWith = (values: Record<string, string>) =>
  ({ get: (key: string, def?: string) => values[key] ?? def }) as unknown as ConfigService;

describe('OpenFoodFactsService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  const hitPayload = {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        status: 1,
        product: {
          product_name: 'Nutella',
          brands: 'Ferrero, Nutella',
          image_front_url: 'https://images.example/nutella.jpg',
        },
      }),
  } as unknown as Response;

  it('maps a hit to the prefill shape (first brand wins)', async () => {
    fetchSpy.mockResolvedValue(hitPayload);
    const service = new OpenFoodFactsService(configWith({}));
    await expect(service.lookup('3017620422003')).resolves.toEqual({
      status: 'hit',
      name: 'Nutella',
      brand: 'Ferrero',
      imageUrl: 'https://images.example/nutella.jpg',
    });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/v2/product/3017620422003.json');
  });

  it('treats 404 and status!==1 as clean misses', async () => {
    const service = new OpenFoodFactsService(configWith({}));
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    await expect(service.lookup('96385074')).resolves.toEqual({ status: 'miss' });

    jest.advanceTimersByTime(2_000);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 0 }),
    } as unknown as Response);
    await expect(service.lookup('96385074')).resolves.toEqual({ status: 'miss' });
  });

  it('is disabled via OFF_ENABLED=false without touching the network', async () => {
    const service = new OpenFoodFactsService(configWith({ OFF_ENABLED: 'false' }));
    await expect(service.lookup('96385074')).resolves.toEqual({ status: 'disabled' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rate-limits back-to-back calls to unavailable (manual entry)', async () => {
    fetchSpy.mockResolvedValue(hitPayload);
    const service = new OpenFoodFactsService(configWith({}));
    await service.lookup('96385074');
    await expect(service.lookup('96385074')).resolves.toEqual({ status: 'unavailable' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit breaker after consecutive failures, closes after cooldown', async () => {
    fetchSpy.mockRejectedValue(new Error('ETIMEDOUT'));
    const service = new OpenFoodFactsService(configWith({}));
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(2_000);
      await expect(service.lookup('96385074')).resolves.toEqual({ status: 'unavailable' });
    }
    // Breaker open — no network call even after the rate-limit window.
    jest.advanceTimersByTime(2_000);
    await expect(service.lookup('96385074')).resolves.toEqual({ status: 'unavailable' });
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Past the cooldown a probe goes through again.
    jest.advanceTimersByTime(61_000);
    fetchSpy.mockResolvedValue(hitPayload);
    await expect(service.lookup('96385074')).resolves.toMatchObject({ status: 'hit' });
  });
});
