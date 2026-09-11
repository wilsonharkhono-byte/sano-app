/**
 * One printed URL, three navigators. A supervisor lands on the room; office and
 * principal land on the read-only detail. If a container's config drifts, a
 * physical label stops working for that role and nobody finds out until someone
 * is standing in the room, so this asserts the real path against the real
 * resolver rather than just the object shape.
 */
import { getStateFromPath } from '@react-navigation/native';
import { buildLinking, LINKING_PREFIXES, ROOM_PATH } from '../linking';

const SUPERVISOR = { Beranda: '', RoomScan: 'scan', Room: ROOM_PATH };
const OFFICE     = { Home: '', RoomDetail: ROOM_PATH };
const PRINCIPAL  = { Home: '', RoomDetail: ROOM_PATH };

describe('buildLinking', () => {
  it('accepts both the https origin and the custom scheme', () => {
    expect(LINKING_PREFIXES).toEqual(['https://sano-app.vercel.app', 'sano://']);
    expect(buildLinking(SUPERVISOR).prefixes).toEqual(LINKING_PREFIXES);
  });

  it('passes the screen map straight through', () => {
    expect(buildLinking(SUPERVISOR).config).toEqual({ screens: SUPERVISOR });
    expect(buildLinking(OFFICE).config).toEqual({ screens: OFFICE });
  });

  it('gives every container the SAME path pattern', () => {
    expect(SUPERVISOR.Room).toBe(ROOM_PATH);
    expect(OFFICE.RoomDetail).toBe(ROOM_PATH);
    expect(PRINCIPAL.RoomDetail).toBe(ROOM_PATH);
  });
});

describe('getStateFromPath - the printed URL resolves per role', () => {
  const path = '/r/GA17/L2-KM-UTAMA';

  it('routes a supervisor to Room with both params', () => {
    expect(getStateFromPath(path, buildLinking(SUPERVISOR).config)).toEqual({
      routes: [{ name: 'Room', params: { projectCode: 'GA17', roomCode: 'L2-KM-UTAMA' }, path }],
    });
  });

  it('routes office and principal to RoomDetail', () => {
    for (const screens of [OFFICE, PRINCIPAL]) {
      const state = getStateFromPath(path, buildLinking(screens).config) as any;
      expect(state.routes[0].name).toBe('RoomDetail');
      expect(state.routes[0].params).toEqual({ projectCode: 'GA17', roomCode: 'L2-KM-UTAMA' });
    }
  });

  it('resolves the root path to the role home tab', () => {
    expect((getStateFromPath('/', buildLinking(SUPERVISOR).config) as any).routes[0].name).toBe('Beranda');
    expect((getStateFromPath('/', buildLinking(OFFICE).config) as any).routes[0].name).toBe('Home');
  });

  it('resolves the scanner path only for the supervisor', () => {
    expect((getStateFromPath('/scan', buildLinking(SUPERVISOR).config) as any).routes[0].name).toBe('RoomScan');
    expect(getStateFromPath('/scan', buildLinking(OFFICE).config)).toBeUndefined();
  });

  it('does not resolve a path with a missing segment', () => {
    expect(getStateFromPath('/r/GA17', buildLinking(SUPERVISOR).config)).toBeUndefined();
  });
});

describe('getPathFromState - the web address bar only carries declared links', () => {
  // Without the override React Navigation writes /Permintaan, /Home ... into
  // the address bar on every tab switch. Before this plan the bar never changed.
  it('keeps the room path and sends every undeclared tab to the root', () => {
    const linking = buildLinking(SUPERVISOR);
    const room = { index: 0, routes: [{ name: 'Room', params: { projectCode: 'GA17', roomCode: 'L2-KM' } }] };
    const tab  = { index: 0, routes: [{ name: 'Permintaan' }] };
    expect(linking.getPathFromState!(room as any, linking.config as any)).toBe('/r/GA17/L2-KM');
    expect(linking.getPathFromState!(tab as any, linking.config as any)).toBe('/');
  });
});
