import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parentTabFor } from './deep-link-state';

const directory = dirname(fileURLToPath(import.meta.url));
const navigation = readFileSync(resolve(directory, 'AppNavigation.tsx'), 'utf8');
const discovery = readFileSync(
  resolve(directory, '../features/discovery/DiscoveryScreen.tsx'),
  'utf8',
);

describe('Explore tab root restoration', () => {
  it('requests the Explore root on every Explore tab press', () => {
    expect(navigation).toContain('const [exploreRootRequest, setExploreRootRequest] = useState(0)');
    expect(navigation).toContain('tabPress: () => setExploreRootRequest((current) => current + 1)');
    expect(navigation).toContain('exploreRootRequest={exploreRootRequest}');
  });

  it('leaves discovery criteria intact while clearing nested Explore presentation state', () => {
    const resetStart = discovery.indexOf('const handledExploreRootRequest');
    const resetEnd = discovery.indexOf('}, [exploreRootRequest, home]);', resetStart);
    const reset = discovery.slice(resetStart, resetEnd);
    expect(reset).toContain("setMode('form')");
    expect(reset).toContain('setVehicleId(null)');
    expect(reset).toContain('setFullMap(false)');
    expect(reset).not.toMatch(
      /set(?:Place|Pickup|ReturnAt|CategoryId|Powertrain|MinPrice|MaxPrice)\(/,
    );
  });

  it('keeps deep-linked Vehicle Details parented to Explore', () => {
    expect(parentTabFor('VehicleDetails', 'renter')).toBe('Home');
    expect(discovery).toContain("initialVehicleId ? 'detail' : initialMode");
  });
});
